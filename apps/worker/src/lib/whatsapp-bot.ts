import { Redis } from "ioredis";
import { answerSupportMessage } from "@mashupkgrid/ai";
import { prisma } from "@mashupkgrid/database";
import { env } from "@mashupkgrid/config";
import { listHotspotPackages } from "@mashupkgrid/radius";
import { initiateHotspotPurchaseStkPush, initiateStkPushForCustomer } from "@mashupkgrid/payments";
import { createTicket } from "@mashupkgrid/support";
import { sendWhatsAppMessage, type WASocket } from "@mashupkgrid/whatsapp";
import { isAppError } from "@mashupkgrid/shared";
import { formatMoney, formatDuration } from "./format.js";

/**
 * The inbound half of the WhatsApp integration: a numbered self-service menu customers drive by
 * replying with digits, mirroring the flow the marketing site advertises
 * (apps/web's whatsapp-bot-simulator.tsx). Deliberately menu-driven rather than AI-backed — every
 * branch is a fixed, auditable action against real data, with no per-message model cost and no
 * chance of a hallucinated answer about someone's balance or a payment.
 *
 * Conversation state lives in Redis with a short TTL (not the database): a half-finished menu
 * walk is throwaway UI state, and expiring it means a customer who wanders off mid-flow simply
 * gets a fresh menu next time instead of resuming something stale.
 */

const SESSION_TTL_SECONDS = 15 * 60;

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on("error", (err) => console.error("[whatsapp-bot] redis error", err));

type BotState = "main" | "buy_pick_package" | "outage_awaiting_description" | "support_awaiting_message";

interface BotSession {
  state: BotState;
  tenantId?: string;
  /** Package ids in the exact order they were listed, so the customer's "2" maps back to the
   *  package they actually saw at position 2 rather than whatever order a re-query returns. */
  packageIds?: string[];
}

/** Session keys are namespaced by tenant so the same phone messaging two different ISP lines
 *  gets isolated bot state for each — otherwise package lists, menu position and the stored
 *  tenantId bleed across tenants. */
function sessionKey(tenantId: string, phone: string): string {
  return `wa-bot:${tenantId}:${phone}`;
}

async function loadSession(tenantId: string, phone: string): Promise<BotSession> {
  try {
    const raw = await redis.get(sessionKey(tenantId, phone));
    if (raw) return JSON.parse(raw) as BotSession;
  } catch (err) {
    console.error("[whatsapp-bot] failed to load session", err);
  }
  return { state: "main" };
}

async function saveSession(tenantId: string, phone: string, session: BotSession): Promise<void> {
  try {
    await redis.set(sessionKey(tenantId, phone), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
  } catch (err) {
    console.error("[whatsapp-bot] failed to save session", err);
  }
}

/** WhatsApp JIDs carry the full international number ("254703605266@s.whatsapp.net") while
 *  Customer.phone is entered by staff in whatever local shape they like ("0703605266",
 *  "+254 703 605 266"). Matching on the last 9 digits — the part that is actually the subscriber
 *  number, after any country code or trunk "0" — is what makes those line up without forcing a
 *  data migration on every tenant's existing customer list. */
function subscriberDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-9);
}

async function mainMenu(tenantName: string): Promise<string> {
  return [
    `Welcome to *${tenantName}* 👋`,
    "",
    "How can we help today?",
    "",
    "1️⃣  Check balance & renew",
    "2️⃣  Buy Wi-Fi voucher",
    "3️⃣  Report an outage",
    "4️⃣  Talk to support",
    "5️⃣  Pay my bill with M-Pesa",
    "",
    'Reply with a number. Send "menu" anytime to start over.',
    'You can also just type "balance" or "pay".',
  ].join("\n");
}

async function handleBalance(tenantId: string, phone: string): Promise<string> {
  const tail = subscriberDigits(phone);
  const customer = await prisma.customer.findFirst({
    where: { tenantId, phone: { endsWith: tail }, deletedAt: null },
    include: {
      services: { where: { status: "ACTIVE" }, include: { package: true }, take: 1 },
    },
  });

  if (!customer) {
    return [
      "We couldn't find a subscriber account for this number.",
      "",
      'If you use our Wi-Fi hotspot, reply "2" to buy a voucher instead.',
      'Reply "4" if you think this is a mistake and want to talk to support.',
    ].join("\n");
  }

  const unpaid = await prisma.invoice.findMany({
    where: { tenantId, customerId: customer.id, status: { in: ["PENDING", "PARTIALLY_PAID", "OVERDUE"] } },
    orderBy: { dueDate: "asc" },
  });
  const outstandingMinor = unpaid.reduce((sum, inv) => sum + (inv.totalMinor - inv.amountPaidMinor), 0);
  const service = customer.services[0];

  const lines = [`👤 *${customer.fullName}* (${customer.customerNumber})`, `Status: ${customer.status}`];
  if (service) {
    lines.push(`📦 Plan: ${service.package.name}`);
    lines.push(`📅 Next billing: ${service.nextBillingAt.toDateString()}`);
  }
  lines.push("");
  if (outstandingMinor > 0) {
    const currency = unpaid[0]?.currency ?? "KES";
    lines.push(`💰 Outstanding: *${formatMoney(outstandingMinor, currency)}* across ${unpaid.length} invoice(s).`);
    lines.push("");
    lines.push(`Reply "pay" and we'll send an M-Pesa prompt for ${formatMoney(unpaid[0]!.totalMinor - unpaid[0]!.amountPaidMinor, currency)} (invoice ${unpaid[0]!.invoiceNumber}) to this phone.`);
  } else {
    lines.push("✅ You have no outstanding balance. Thank you!");
  }
  lines.push("", 'Send "menu" to go back.');
  return lines.join("\n");
}

/** Words customers actually type instead of menu numbers, in English and Swahili. */
const BALANCE_WORDS = new Set(["balance", "bal", "my balance", "check balance", "salio", "deni"]);
const PAY_WORDS = new Set(["pay", "pay now", "pay bill", "lipa", "lipia", "renew", "mpesa", "m-pesa"]);

/** At most one M-Pesa prompt per customer a minute: a second "pay" while the first prompt is
 *  still on their screen would only make Safaricom reject one of them. */
const PAY_COOLDOWN_SECONDS = 60;

/**
 * Sends an M-Pesa prompt to the customer's own phone for the oldest unpaid invoice. The amount
 * and invoice come from the account, never from the message, so the only thing a sender can do
 * is ask their own bill to be put in front of them.
 */
export async function handlePayInvoice(tenantId: string, phone: string): Promise<string> {
  const customer = await prisma.customer.findFirst({
    where: { tenantId, phone: { endsWith: subscriberDigits(phone) }, deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!customer) {
    return [
      "We couldn't find a subscriber account for this number.",
      "",
      'If you use our Wi-Fi hotspot, reply "2" to buy a voucher instead.',
    ].join("\n");
  }
  const invoice = await prisma.invoice.findFirst({
    where: { tenantId, customerId: customer.id, status: { in: ["OVERDUE", "PARTIALLY_PAID", "PENDING"] } },
    orderBy: { dueDate: "asc" },
  });
  const remaining = invoice ? invoice.totalMinor - invoice.amountPaidMinor : 0;
  if (!invoice || remaining <= 0) return '✅ You have nothing to pay right now. Thank you!\n\nSend "menu" to go back.';

  const claimed = await redis.set(`wa-bot:pay:${tenantId}:${customer.id}`, "1", "EX", PAY_COOLDOWN_SECONDS, "NX");
  if (claimed !== "OK") return "An M-Pesa prompt was just sent to your phone. Please check it, or wait a minute and reply \"pay\" again.";

  try {
    await initiateStkPushForCustomer(tenantId, {
      customerId: customer.id,
      invoiceId: invoice.id,
      phone,
      amountMinor: remaining,
      initiatedByUserId: null,
    });
  } catch (err) {
    await redis.del(`wa-bot:pay:${tenantId}:${customer.id}`).catch(() => {});
    console.error(`[whatsapp-bot] STK for invoice ${invoice.id} failed`, err);
    return 'Sorry, we could not send the M-Pesa prompt right now. Please try again in a few minutes, or reply "4" to talk to support.';
  }
  return [
    `📲 Check your phone: an M-Pesa prompt for *${formatMoney(remaining, invoice.currency)}* (invoice ${invoice.invoiceNumber}) is on its way.`,
    "",
    "Enter your M-Pesa PIN to pay. You'll get a confirmation, and your service is restored automatically if it was off.",
  ].join("\n");
}

async function handleBuyList(tenantId: string, session: BotSession): Promise<string> {
  const packages = (await listHotspotPackages(tenantId)).filter((p) => p.isActive);
  if (packages.length === 0) {
    return 'No Wi-Fi packages are available right now. Send "menu" to go back.';
  }

  session.state = "buy_pick_package";
  session.packageIds = packages.map((p) => p.id);

  const lines = ["📶 *Choose a Wi-Fi plan:*", ""];
  packages.forEach((p, i) => {
    const bits = [formatMoney(p.priceMinor, p.currency), formatDuration(p.durationMinutes)];
    if (p.dataCapMb) bits.push(`${p.dataCapMb} MB`);
    lines.push(`${i + 1}. *${p.name}* — ${bits.join(" · ")}`);
  });
  lines.push("", 'Reply with the plan number to pay via M-Pesa, or "menu" to go back.');
  return lines.join("\n");
}

async function handleBuyPick(tenantId: string, phone: string, session: BotSession, choice: number): Promise<string> {
  const packageId = session.packageIds?.[choice - 1];
  if (!packageId) {
    return 'That plan number isn\'t on the list. Reply with a number from the list above, or send "menu" to start over.';
  }

  try {
    await initiateHotspotPurchaseStkPush(tenantId, { hotspotPackageId: packageId, phone });
  } catch (err) {
    console.error("[whatsapp-bot] STK push failed", err);
    return [
      "⚠️ We couldn't start the M-Pesa payment just now.",
      "",
      'Please try again in a moment, or reply "4" to talk to support.',
    ].join("\n");
  }

  session.state = "main";
  session.packageIds = undefined;
  return [
    "📲 An M-Pesa payment request has been sent to this number.",
    "",
    "Enter your M-Pesa PIN to complete the purchase — your voucher code will arrive here automatically the moment payment confirms.",
  ].join("\n");
}

async function handleTicket(
  tenantId: string,
  phone: string | null,
  text: string,
  kind: "outage" | "support"
): Promise<string> {
  const customer = phone
    ? await prisma.customer.findFirst({
        where: { tenantId, phone: { endsWith: subscriberDigits(phone) }, deletedAt: null },
        select: { id: true, fullName: true },
      })
    : null;

  const ticket = await createTicket(tenantId, {
    customerId: customer?.id ?? null,
    contactName: customer?.fullName ?? "WhatsApp customer",
    contactPhone: phone,
    subject: kind === "outage" ? "Outage reported via WhatsApp" : "Support request via WhatsApp",
    body: text,
    source: "whatsapp",
    // An outage is a service-down report, which is what the HIGH tier exists for; a general
    // question rides the default so it doesn't jump ahead of genuinely broken connections.
    ...(kind === "outage" ? { priority: "HIGH" as const } : {}),
  });

  // Tickets have no human-facing number column — they're keyed by UUID, which is unreadable to
  // quote over the phone. The leading 8 characters are enough for a customer to reference and for
  // staff to find the row by prefix, the same way a short commit hash works.
  const reference = ticket.id.slice(0, 8).toUpperCase();

  return [
    kind === "outage" ? "🛠️ Outage reported — thank you." : "✅ Message received — thank you.",
    "",
    `Your reference is *${reference}*.`,
    "Our team will get back to you here.",
    "",
    'Send "menu" to go back.',
  ].join("\n");
}

/**
 * The support assistant's answer to a free-text message, or null when it doesn't apply (no AI
 * set up for this ISP, or the number isn't a customer's), so the menu is shown as before.
 */
async function tryAssistant(tenantId: string, phone: string, text: string): Promise<string | null> {
  if (!tenantId || tenantId === "platform") return null;
  const customer = await prisma.customer.findFirst({ where: { tenantId, phone: { endsWith: subscriberDigits(phone) }, deletedAt: null }, select: { id: true } });
  if (!customer) return null;
  try {
    const res = await answerSupportMessage({ tenantId, customerId: customer.id, channel: "WHATSAPP", message: text });
    if (res.reply) return res.reply;
    // Already with staff: the message went onto the ticket.
    return `Thanks, we've added this to your support ticket ${res.ticketNumber ?? ""}. Someone from the team will reply here. Send "menu" for other options.`;
  } catch (err) {
    if (isAppError(err) && err.statusCode === 409) return null;
    console.error("[whatsapp-bot] support assistant failed", err);
    return null;
  }
}

/**
 * Entry point wired to the socket's inbound-message event. Never throws: an unhandled rejection
 * here would surface as an unhandled promise rejection in the worker rather than anything the
 * customer or an operator can act on, so every failure is logged and answered with a plain
 * apology instead.
 */
export async function handleIncomingWhatsAppMessage(
  sock: WASocket | null,
  tenantId: string,
  fromJid: string,
  text: string,
  /** The sender's `<digits>@s.whatsapp.net`; null when WhatsApp hid their number behind a LID. */
  senderPhoneJid: string | null = fromJid.endsWith("@s.whatsapp.net") ? fromJid : null
): Promise<void> {
  // Groups, channels/newsletters and status broadcasts all arrive on this same event — a bot
  // that answered those would spam every group the paired account belongs to.
  if (fromJid.endsWith("@g.us") || fromJid.endsWith("@broadcast") || fromJid.endsWith("@newsletter")) return;
  if (!sock) {
    console.warn(`[whatsapp-bot] cannot reply: socket is null for tenant ${tenantId}`);
    return;
  }

  // The sender's own number — never the ISP's: it picks whose balance is shown and which phone
  // gets the M-Pesa prompt. Unknown (a LID WhatsApp wouldn't map) means those steps are refused.
  const phoneDigits = senderPhoneJid?.split("@")[0]?.replace(/\D/g, "") ?? "";
  const phone: string | null = phoneDigits ? `+${phoneDigits}` : null;
  // Conversation state is per chat; a hidden-number sender is keyed by their LID.
  const sessionId = phone ?? fromJid;
  const replyTarget = fromJid;
  const noPhoneReply =
    'Sorry, WhatsApp didn\'t share your phone number with us, so we can\'t look up your account or send an M-Pesa request from here. Please use the Wi-Fi sign-in page, or reply "4" to talk to support.';
  const input = text.trim();
  const lower = input.toLowerCase();

  console.log(`[whatsapp-bot] processing incoming message from=${fromJid} (resolved phone=${phone}) tenant=${tenantId}: "${input}"`);

  try {
    // The tenant is no longer inferred — the message arrived on that ISP's own WhatsApp session,
    // so it is known for certain. This is what removed the old "which internet provider are you
    // with?" prompt, which existed only because one shared line could not tell.
    const session = await loadSession(tenantId, sessionId);
    const isReset = ["menu", "0", "hi", "hello", "hey", "start", "help"].includes(lower);
    if (isReset) session.state = "main";
    session.tenantId = tenantId;

    const tenant =
      tenantId && tenantId !== "platform"
        ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }).catch(() => null)
        : await prisma.tenant.findFirst({ where: { status: "ACTIVE" }, select: { name: true } }).catch(() => null);
    const tenantName = tenant?.name ?? "our network";

    // A free-text step (outage/support description) consumes whatever was typed, unless the
    // customer explicitly asked for the menu — otherwise a description that happens to be "2"
    // would silently become a menu choice.
    if (!isReset && session.state === "outage_awaiting_description") {
      const reply = await handleTicket(tenantId, phone, input, "outage");
      session.state = "main";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }
    if (!isReset && session.state === "support_awaiting_message") {
      const reply = await handleTicket(tenantId, phone, input, "support");
      session.state = "main";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }

    if (!isReset && session.state === "buy_pick_package" && /^\d+$/.test(input)) {
      const reply = phone ? await handleBuyPick(tenantId, phone, session, Number(input)) : noPhoneReply;
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }

    if (!isReset && (input === "5" || PAY_WORDS.has(lower))) {
      const reply = phone ? await handlePayInvoice(tenantId, phone) : noPhoneReply;
      session.state = "main";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }
    if (!isReset && BALANCE_WORDS.has(lower)) {
      const reply = phone ? await handleBalance(tenantId, phone) : noPhoneReply;
      session.state = "main";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }
    if (!isReset && input === "1") {
      const reply = phone ? await handleBalance(tenantId, phone) : noPhoneReply;
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }
    if (!isReset && input === "2") {
      const reply = await handleBuyList(tenantId, session);
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, reply);
      return;
    }
    if (!isReset && input === "3") {
      session.state = "outage_awaiting_description";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(
        sock,
        replyTarget,
        "🛠️ Sorry about that. Please describe the problem (and your location if you can) and we'll log it right away."
      );
      return;
    }
    if (!isReset && input === "4") {
      session.state = "support_awaiting_message";
      await saveSession(tenantId, sessionId, session);
      await sendWhatsAppMessage(sock, replyTarget, "💬 Please type your message and our support team will get back to you.");
      return;
    }

    // Free text from a known customer goes to the support assistant, when the ISP has one set up.
    if (!isReset && phone) {
      const aiReply = await tryAssistant(tenantId, phone, input);
      if (aiReply) {
        session.state = "main";
        await saveSession(tenantId, sessionId, session);
        await sendWhatsAppMessage(sock, replyTarget, aiReply);
        return;
      }
    }

    // If the customer sent something we don't recognise (not a menu number, not a reset keyword),
    // tell them so before re-showing the menu — a silent re-display makes them think their
    // message was processed.
    const menuText = await mainMenu(tenantName);
    const replyText = isReset
      ? menuText
      : `Sorry, I didn't understand "${input.slice(0, 40)}". Please reply with a number from the menu below.\n\n${menuText}`;

    session.state = "main";
    await saveSession(tenantId, sessionId, session);
    console.log(`[whatsapp-bot] sending main menu reply to ${replyTarget}`);
    await sendWhatsAppMessage(sock, replyTarget, replyText);
  } catch (err) {
    console.error("[whatsapp-bot] failed handling message from", phone, err);
    await sendWhatsAppMessage(
      sock,
      replyTarget,
      'Sorry — something went wrong on our side. Please send "menu" to try again.'
    ).catch(() => {});
  }
}
