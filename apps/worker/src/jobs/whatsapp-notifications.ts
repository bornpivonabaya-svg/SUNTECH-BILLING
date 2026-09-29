import {
  sendWhatsappVoucherJobSchema,
  sendWhatsappTenantWelcomeJobSchema,
  sendWhatsappServiceStatusJobSchema,
} from "@mashupkgrid/shared";
import { sendWhatsAppMessage, type WASocket } from "@mashupkgrid/whatsapp";
import { resolveSocket } from "../lib/whatsapp-runtime.js";
import { formatMoney, formatDuration } from "../lib/format.js";

/** Same contract as send-whatsapp-otp.ts: a missing session is a real failure (retried with
 *  backoff) rather than a silent no-op, so an undelivered message is visible instead of lost. */
function requireSocket(tenantId: string | null): WASocket {
  const sock = resolveSocket(tenantId);
  if (!sock) {
    throw new Error("No connected WhatsApp session available — cannot send notification");
  }
  return sock;
}

/**
 * Delivers a freshly-purchased hotspot voucher to the customer who just paid. Branded with the
 * ISP's own company name rather than this platform's: the customer bought Wi-Fi from that ISP and
 * has no relationship with (or awareness of) the billing platform underneath.
 */
export async function handleSendWhatsappVoucher(payload: unknown): Promise<void> {
  const data = sendWhatsappVoucherJobSchema.parse(payload);
  const socket = requireSocket(data.tenantId);

  const lines = [
    `🎉 Thank you for choosing *${data.tenantName}*!`,
    "",
    "Your Wi-Fi voucher is ready:",
    "",
    `🔑 Code: *${data.voucherCode}*`,
  ];
  if (data.packageName) lines.push(`📦 Plan: ${data.packageName}`);
  if (data.durationMinutes) lines.push(`⏱️ Valid for: ${formatDuration(data.durationMinutes)}`);
  if (data.dataCapMb) lines.push(`📶 Data: ${data.dataCapMb} MB`);
  lines.push(`💰 Paid: ${formatMoney(data.amountMinor, data.currency)}`);
  lines.push(
    "",
    "Connect to the Wi-Fi network and enter this code to get online.",
    "",
    `We appreciate your business — enjoy your browsing! 🚀`
  );

  await sendWhatsAppMessage(socket, data.phone, lines.join("\n"));
}

/**
 * Welcomes a new ISP owner right after their tenant is provisioned, with the username they'll
 * sign in with and where to sign in.
 *
 * Deliberately does NOT include their password. The plaintext is only ever briefly in memory
 * during registration (it's Argon2-hashed before storage, so it is not retrievable afterwards
 * even if we wanted it), and putting a live credential into a WhatsApp thread would persist it
 * in the phone's chat history and its cloud backups, and in this job's payload sitting in Redis —
 * turning a password the owner alone knows into one that leaks with any of those. The owner just
 * chose that password moments earlier, and the reset link covers forgetting it.
 */
export async function handleSendWhatsappTenantWelcome(payload: unknown): Promise<void> {
  const data = sendWhatsappTenantWelcomeJobSchema.parse(payload);
  const socket = requireSocket(data.tenantId);

  if (data.stage === "pending") {
    await sendWhatsAppMessage(
      socket,
      data.phone,
      [
        `Hi ${data.ownerName}, thanks for registering *${data.companyName}* on Suntech Billing.`,
        "",
        "Your application is with our team for approval. You will get a message here and by email the moment it is approved, with your sign-in link.",
        "",
        `Username: ${data.username}`,
      ].join("\n")
    );
    return;
  }
  if (data.stage === "rejected") {
    await sendWhatsAppMessage(
      socket,
      data.phone,
      [
        `Hi ${data.ownerName}, we could not approve *${data.companyName}* on Suntech Billing.`,
        ...(data.reason ? ["", `Reason: ${data.reason}`] : []),
        "",
        "Reply to this message if you think this is a mistake or want to reapply.",
      ].join("\n")
    );
    return;
  }

  const message = [
    `🎉 Welcome aboard, ${data.ownerName}!`,
    "",
    `*${data.companyName}* has been approved and is now live on Suntech Billing.`,
    "",
    `👤 Username: ${data.username}`,
    `🔗 Your dashboard: ${data.dashboardUrl}`,
    `🌐 Your captive portal: ${data.portalUrl}`,
    "",
    "🔐 Sign in with the password you just created. For your security we never send passwords over WhatsApp — use \"Forgot password\" on the sign-in page if you ever need to reset it.",
    "",
    "Thank you for trusting us to power your network. Let's get your subscribers online! 🚀",
  ].join("\n");

  await sendWhatsAppMessage(socket, data.phone, message);
}

/** Kbps -> the "20 Mbps" an ISP actually advertises. Integer division on purpose: a plan is sold
 *  in whole megabits and "19.53 Mbps" would just look like a mistake to the customer. */
function formatSpeed(kbps: number | null): string | null {
  if (!kbps) return null;
  return `${Math.round(kbps / 1000)} Mbps`;
}

/**
 * Tells a subscriber what happened to their service (spec section 20).
 *
 * Only ever called once a provisioning job reached a terminal state, so every message here
 * describes something a device confirmed. The FAILED case deliberately does NOT tell the customer
 * their internet is on or off — the honest thing to say is that something went wrong and a human
 * is needed, since at that point the system genuinely does not know what state the router is in.
 */
export async function handleSendWhatsappServiceStatus(payload: unknown): Promise<void> {
  const data = sendWhatsappServiceStatusJobSchema.parse(payload);
  const socket = requireSocket(data.tenantId);

  const speed = formatSpeed(data.downloadKbps);
  const plan = data.packageName ? `${data.packageName}${speed ? ` (${speed})` : ""}` : speed;
  const lines: string[] = [];

  switch (data.event) {
    case "ACTIVATED":
      lines.push(
        `✅ Hi ${data.customerName}, your internet is now *active*.`,
        "",
        ...(plan ? [`📦 Plan: ${plan}`, ""] : []),
        `Thank you for choosing *${data.tenantName}*. Enjoy your browsing! 🚀`
      );
      break;
    case "RESTORED":
      lines.push(
        `✅ Hi ${data.customerName}, your payment is confirmed and your internet is *back on*.`,
        "",
        ...(plan ? [`📦 Plan: ${plan}`, ""] : []),
        `Thank you from *${data.tenantName}*.`
      );
      break;
    case "SUSPENDED":
      lines.push(
        `⚠️ Hi ${data.customerName}, your internet has been *suspended* because your subscription has expired.`,
        "",
        "Your account and settings are safe — renewing restores your service automatically.",
        "",
        `— *${data.tenantName}*`
      );
      break;
    case "DEPROVISIONED":
      lines.push(
        `Hi ${data.customerName}, your internet service with *${data.tenantName}* has been closed.`,
        "",
        "Your account details are retained should you wish to return.",
        ...(data.supportPhone ? ["", `Questions? Call ${data.supportPhone}.`] : [])
      );
      break;
    case "FAILED":
      // Never claims a state. The router did not confirm anything, so neither does this.
      lines.push(
        `⚠️ Hi ${data.customerName}, we hit a problem setting up your internet connection.`,
        "",
        "Our team has been alerted and is looking into it.",
        ...(data.supportPhone ? ["", `Need it urgently? Call ${data.supportPhone}.`] : []),
        "",
        `— *${data.tenantName}*`
      );
      break;
  }

  await sendWhatsAppMessage(socket, data.phone, lines.join("\n"));
}
