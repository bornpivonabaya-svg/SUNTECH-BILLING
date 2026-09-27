import Anthropic from "@anthropic-ai/sdk";
import { prisma, type SupportChat } from "@mashupkgrid/database";
import { ConflictError, NotFoundError, isAppError } from "@mashupkgrid/shared";
import { addTicketMessage, createTicket } from "@mashupkgrid/support";
import { getAiAssistantApiKey } from "./config.service.js";

/**
 * The customer support assistant, in the customer app's Help tab and on WhatsApp. It answers
 * from the customer's own account (plans, bills, payments, planned maintenance) through
 * read-only tools that only ever see that one customer, in English or Swahili. When it can't
 * help, or the customer asks for a person, it hands over: the whole conversation goes onto a
 * support ticket, and from then on the customer's messages go to that ticket for staff.
 */

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 5;
const HISTORY_MESSAGES = 30;

export type SupportChannel = "APP" | "WHATSAPP";

export interface SupportReply {
  chatId: string;
  reply: string;
  handedOver: boolean;
  ticketNumber: string | null;
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_account",
    description:
      "The customer's account right now: name, account number, each internet plan (speed, price, status, when it renews, whether it is paused), wallet credit, and every unpaid bill with its amount and due date. Call this before answering anything about their service or money.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_recent_payments",
    description: "The customer's last few payments: date, amount, method (M-Pesa, cash, ...) and receipt reference. Use when they ask whether a payment arrived.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_service_notices",
    description: "Planned network maintenance happening now or in the next two days. Use when the customer reports the internet being down or slow.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "hand_over_to_staff",
    description:
      "Pass the conversation to the ISP's staff as a support ticket. Use when the customer asks for a person, when the problem needs someone to act (a technician visit, a refund, a billing correction, a fault you can't explain from the account), or when you aren't sure. The customer's messages go to staff after this.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "A short title for staff, e.g. \"No internet since Monday, Kasarani\"" },
        summary: { type: "string", description: "What the customer needs and what you already checked, in English, for staff." },
        urgent: { type: "boolean", description: "True when the customer has no service at all." },
      },
      required: ["subject", "summary", "urgent"],
      additionalProperties: false,
    },
  },
];

/** What the customer quotes to staff: the start of the ticket id, as shown in the dashboard. */
export const ticketRef = (ticketId: string) => ticketId.slice(0, 8).toUpperCase();

const money = (minor: number, currency = "KES") => `${currency} ${(minor / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function getAccount(tenantId: string, customerId: string) {
  const c = await prisma.customer.findFirstOrThrow({
    where: { id: customerId, tenantId },
    include: {
      services: { where: { status: { not: "CANCELLED" } }, include: { package: { select: { name: true, downloadKbps: true, uploadKbps: true, priceMinor: true, currency: true, billingCycle: true } } } },
      wallet: { select: { balanceMinor: true } },
      invoices: { where: { status: { in: ["PENDING", "PARTIALLY_PAID", "OVERDUE"] } }, orderBy: { dueDate: "asc" }, select: { invoiceNumber: true, totalMinor: true, amountPaidMinor: true, dueDate: true, status: true, currency: true } },
    },
  });
  return {
    name: c.fullName,
    accountNumber: c.customerNumber,
    plans: c.services.map((s) => ({
      plan: s.package.name,
      speed: `${Math.round(s.package.downloadKbps / 1000)} Mbps down / ${Math.round(s.package.uploadKbps / 1000)} Mbps up`,
      price: `${money(s.priceOverrideMinor ?? s.package.priceMinor, s.package.currency)} ${s.package.billingCycle.toLowerCase()}`,
      status: s.pausedUntil ? "PAUSED" : s.status,
      pausedUntil: day(s.pausedUntil),
      nextBill: day(s.nextBillingAt),
    })),
    walletCredit: money(c.wallet?.balanceMinor ?? 0),
    unpaidBills: c.invoices.map((i) => ({ number: i.invoiceNumber, owed: money(i.totalMinor - i.amountPaidMinor, i.currency), due: day(i.dueDate), status: i.status })),
  };
}

async function getRecentPayments(tenantId: string, customerId: string) {
  const payments = await prisma.payment.findMany({
    where: { tenantId, customerId, method: { not: "WALLET" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, amountMinor: true, currency: true, method: true, reference: true, status: true },
  });
  return payments.map((p) => ({ date: p.createdAt.toISOString().slice(0, 16).replace("T", " "), amount: money(p.amountMinor, p.currency), method: p.method, reference: p.reference, status: p.status }));
}

async function getServiceNotices(tenantId: string) {
  const now = new Date();
  const notices = await prisma.networkMaintenance.findMany({
    where: { tenantId, status: { not: "CANCELLED" }, endsAt: { gte: now }, startsAt: { lte: new Date(now.getTime() + 2 * 86_400_000) } },
    select: { title: true, message: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
  });
  return notices.length ? notices.map((n) => ({ title: n.title, detail: n.message, from: n.startsAt.toISOString(), until: n.endsAt.toISOString() })) : "No planned maintenance right now.";
}

async function transcriptOf(chatId: string): Promise<string> {
  const messages = await prisma.supportChatMessage.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
  return messages.map((m) => `${m.role === "user" ? "Customer" : m.role === "assistant" ? "Assistant" : "Staff"}: ${m.content}`).join("\n\n");
}

/** Opens the ticket, with the whole conversation on it, and switches the chat to staff. */
async function handOver(chat: SupportChat, subject: string, summary: string, urgent: boolean): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: chat.customerId }, select: { fullName: true, phone: true } });
  const ticket = await createTicket(chat.tenantId, {
    customerId: chat.customerId,
    contactName: customer.fullName,
    contactPhone: customer.phone,
    subject: subject.slice(0, 200),
    body: `${summary}\n\n--- Conversation with the support assistant (${chat.channel === "WHATSAPP" ? "WhatsApp" : "app"}) ---\n\n${await transcriptOf(chat.id)}`.slice(0, 20_000),
    source: chat.channel === "WHATSAPP" ? "WHATSAPP" : "CUSTOMER_PORTAL",
    priority: urgent ? "HIGH" : "NORMAL",
  });
  await prisma.supportChat.update({ where: { id: chat.id }, data: { status: "HANDED_OVER", ticketId: ticket.id } });
  return ticketRef(ticket.id);
}

function systemPrompt(isp: string, paybill: string | null, channel: SupportChannel): string {
  return [
    `You are the support assistant for ${isp}, an internet provider in Kenya, chatting with one of its customers ${channel === "WHATSAPP" ? "on WhatsApp" : "in the provider's app"}.`,
    "Reply in the language the customer writes in: English, Swahili, or a mix of both (Sheng is fine). Keep replies short and plain, the way a helpful person at the shop would talk: a few sentences, no headings or tables.",
    "Answer from the customer's own account using the tools; don't guess amounts, dates or plan details. Never invent a policy, price or promise.",
    paybill
      ? `Customers pay by M-Pesa Paybill ${paybill} using their account number, or with the Pay button in the app. Service comes back on by itself within a few minutes of paying an overdue bill.`
      : "Customers pay with the Pay button in the app. Service comes back on by itself within a few minutes of paying an overdue bill.",
    "For no internet or slow internet: check the account (a suspended or paused plan, or an unpaid bill, explains it) and planned maintenance first. If neither explains it, suggest restarting the router (unplug for 30 seconds), and if that doesn't fix it, hand over to staff.",
    "Hand over to staff when the customer asks for a person, when something needs a person to act (a technician visit, refund, bill correction, moving house, cancelling), or when you are unsure. Tell the customer a person will reply, and give them the ticket number.",
    "You can't change anything on the account yourself: no payments, refunds, plan changes or reconnections. Point the customer to the app for what they can do themselves (pay, pause a plan, see bills), and hand over for the rest.",
  ].join("\n\n");
}

/** Customer-facing replies for when the assistant itself can't answer. */
const FALLBACK = {
  refused: "Samahani, I can't help with that here. I've passed your message to our team and someone will reply soon.",
  error: "Sorry, I'm having trouble right now. Please try again in a few minutes, or ask for a person and our team will reply.",
};

async function findOrOpenChat(tenantId: string, customerId: string, channel: SupportChannel): Promise<SupportChat> {
  // A conversation idle for a day starts fresh, so old context doesn't leak into a new problem.
  const recent = await prisma.supportChat.findFirst({
    where: { tenantId, customerId, channel, status: { not: "CLOSED" }, updatedAt: { gte: new Date(Date.now() - 86_400_000) } },
    orderBy: { updatedAt: "desc" },
  });
  return recent ?? prisma.supportChat.create({ data: { tenantId, customerId, channel } });
}

/**
 * One customer message in, one reply out. A chat already handed over sends the message to the
 * ticket instead. Throws ConflictError when the ISP hasn't set up the assistant, so the caller
 * can fall back to its old path (a ticket form, or the WhatsApp menu).
 */
export async function answerSupportMessage(input: { tenantId: string; customerId: string; channel: SupportChannel; message: string; authorUserId?: string | null }): Promise<SupportReply> {
  let apiKey: string;
  try {
    apiKey = await getAiAssistantApiKey(input.tenantId);
  } catch (err) {
    if (isAppError(err) && (err instanceof NotFoundError || err.statusCode === 422 || err.statusCode === 400)) throw new ConflictError("The support assistant is not set up for this provider");
    throw err;
  }
  const text = input.message.trim().slice(0, 4000);
  const chat = await findOrOpenChat(input.tenantId, input.customerId, input.channel);
  await prisma.supportChatMessage.create({ data: { chatId: chat.id, role: "user", content: text } });

  if (chat.status === "HANDED_OVER" && chat.ticketId) {
    await addTicketMessage(input.tenantId, chat.ticketId, { body: text, authorUserId: input.authorUserId ?? null, authorLabel: input.authorUserId ? null : "Customer (WhatsApp)" });
    await prisma.supportChat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
    return { chatId: chat.id, reply: "", handedOver: true, ticketNumber: ticketRef(chat.ticketId) };
  }

  const [tenant, mpesa] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { name: true } }),
    prisma.paymentProviderConfig.findFirst({ where: { tenantId: input.tenantId, provider: "MPESA", isActive: true }, select: { shortcode: true } }),
  ]);
  const history = await prisma.supportChatMessage.findMany({ where: { chatId: chat.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES });
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.reverse()) {
    const role = m.role === "user" ? "user" : "assistant";
    // Earlier turns go back as plain text; consecutive same-role turns are merged by the API.
    if (messages.length === 0 && role === "assistant") continue;
    messages.push({ role, content: m.content });
  }

  const client = new Anthropic({ apiKey });
  let ticketNumber: string | null = null;
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // A support chat wants a quick, accurate answer from a lookup, not long deliberation.
        output_config: { effort: "medium" },
        // If a safety classifier declines, Anthropic retries on its recommended model instead.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The prompt and tools are the same on every turn for this ISP, so they are cached.
        system: [{ type: "text", text: systemPrompt(tenant.name, mpesa?.shortcode ?? null, input.channel), cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.error(`[support-assistant] Anthropic API error ${err.status ?? ""}`, err.message);
        reply = FALLBACK.error;
        break;
      }
      throw err;
    }

    if (response.stop_reason === "refusal") {
      ticketNumber = await handOver(chat, "Message for the support team", "The assistant couldn't answer this message; please reply to the customer.", false);
      reply = `${FALLBACK.refused} (Ticket ${ticketNumber})`;
      break;
    }

    if (response.stop_reason !== "tool_use") {
      reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let result: unknown;
      try {
        if (block.name === "get_account") result = await getAccount(input.tenantId, input.customerId);
        else if (block.name === "get_recent_payments") result = await getRecentPayments(input.tenantId, input.customerId);
        else if (block.name === "get_service_notices") result = await getServiceNotices(input.tenantId);
        else if (block.name === "hand_over_to_staff") {
          const args = block.input as { subject?: string; summary?: string; urgent?: boolean };
          if (!ticketNumber) ticketNumber = await handOver(chat, args.subject || "Customer needs help", args.summary || "See the conversation below.", Boolean(args.urgent));
          result = { ticketNumber, note: "Tell the customer a person from the team will reply here, and give them the ticket number." };
        } else result = { error: `Unknown tool ${block.name}` };
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Lookup failed: ${err instanceof Error ? err.message : String(err)}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) reply = ticketNumber ? `I've passed this to our team (ticket ${ticketNumber}). Someone will reply soon.` : FALLBACK.error;
  await prisma.supportChatMessage.create({ data: { chatId: chat.id, role: "assistant", content: reply } });
  // The reply belongs on the ticket too, so staff see the full exchange.
  if (ticketNumber) {
    const fresh = await prisma.supportChat.findUniqueOrThrow({ where: { id: chat.id }, select: { ticketId: true } });
    if (fresh.ticketId) await addTicketMessage(input.tenantId, fresh.ticketId, { body: reply, authorLabel: "Support assistant" }).catch(() => null);
  }
  return { chatId: chat.id, reply, handedOver: Boolean(ticketNumber), ticketNumber };
}

/** The customer's current conversation, for the app to show on open. */
export async function getSupportChat(tenantId: string, customerId: string) {
  const chat = await prisma.supportChat.findFirst({
    where: { tenantId, customerId, channel: "APP", status: { not: "CLOSED" }, updatedAt: { gte: new Date(Date.now() - 86_400_000) } },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 100 }, ticket: { select: { id: true, status: true } } },
  });
  return chat;
}

/** "Talk to a person": hands the conversation over without asking the assistant. */
export async function requestHumanHandover(tenantId: string, customerId: string, channel: SupportChannel): Promise<{ ticketNumber: string }> {
  const chat = await findOrOpenChat(tenantId, customerId, channel);
  if (chat.status === "HANDED_OVER" && chat.ticketId) return { ticketNumber: ticketRef(chat.ticketId) };
  const count = await prisma.supportChatMessage.count({ where: { chatId: chat.id } });
  if (count === 0) await prisma.supportChatMessage.create({ data: { chatId: chat.id, role: "user", content: "I'd like to talk to a person." } });
  return { ticketNumber: await handOver(chat, "Customer asked for a person", "The customer asked to talk to someone from the team.", false) };
}

/** Starts a new conversation (the old one is closed). */
export async function closeSupportChat(tenantId: string, customerId: string, channel: SupportChannel): Promise<void> {
  await prisma.supportChat.updateMany({ where: { tenantId, customerId, channel, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
}
