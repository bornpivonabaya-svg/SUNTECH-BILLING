import { prisma } from "@mashupkgrid/database";
import { env } from "@mashupkgrid/config";
import { sendHotspotVoucherEmailJobSchema } from "@mashupkgrid/shared";
import { sendEmail } from "../lib/email.js";
import { formatDuration, formatMoney } from "../lib/format.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Emails a hotspot voucher: the code, the plan, and how to use it. Branded with the ISP's name,
 * like the WhatsApp voucher, since that is who the customer bought Wi-Fi from.
 */
export async function handleSendHotspotVoucherEmail(payload: unknown): Promise<void> {
  const data = sendHotspotVoucherEmailJobSchema.parse(payload);
  const voucher = await prisma.hotspotVoucher.findUnique({
    where: { tenantId_code: { tenantId: data.tenantId, code: data.voucherCode } },
    include: { hotspotPackage: true, tenant: { select: { name: true, slug: true } } },
  });
  if (!voucher) {
    console.warn(`[hotspot] voucher email skipped: no voucher ${data.voucherCode} for tenant ${data.tenantId}`);
    return;
  }

  const isp = voucher.tenant.name;
  const pkg = voucher.hotspotPackage;
  const duration = voucher.durationMinutes ?? pkg?.durationMinutes ?? null;
  const dataCap = voucher.dataCapMb ?? pkg?.dataCapMb ?? null;
  const details: [string, string][] = [];
  if (pkg?.name) details.push(["Plan", pkg.name]);
  if (duration) details.push(["Valid for", formatDuration(duration)]);
  details.push(["Data", dataCap ? `${dataCap} MB` : "Unlimited"]);
  if (pkg) details.push(["Price", formatMoney(pkg.priceMinor, pkg.currency)]);
  if (voucher.expiresAt) details.push(["Expires", voucher.expiresAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })]);

  const portalUrl = `${env.APP_PORTAL_URL.replace(/\/$/, "")}/hotspot/${voucher.tenant.slug}`;
  const steps = [
    `Connect to ${isp}'s Wi-Fi.`,
    "Wait for the sign-in page to open (or open any website).",
    "Tap Voucher, enter the code below and tap Connect.",
  ];

  const text = [
    `Your ${isp} Wi-Fi voucher`,
    "",
    `Code: ${voucher.code}`,
    ...details.map(([k, v]) => `${k}: ${v}`),
    "",
    "How to use it:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Sign-in page: ${portalUrl}`,
    "",
    "Keep this email: the code is all you need to get back online if you disconnect.",
    `Thank you for choosing ${isp}!`,
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b;">${escapeHtml(isp)}</p>
    <h2 style="margin:0 0 16px;font-size:20px;">Your Wi-Fi voucher</h2>
    <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:16px;text-align:center;margin:0 0 16px;">
      <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Voucher code</div>
      <div style="font-size:30px;font-weight:700;letter-spacing:4px;font-family:'Courier New',monospace;margin-top:6px;">${escapeHtml(voucher.code)}</div>
    </div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin:0 0 16px;">
      ${details.map(([k, v]) => `<tr><td style="padding:4px 0;color:#64748b;">${escapeHtml(k)}</td><td style="padding:4px 0;text-align:right;font-weight:600;">${escapeHtml(v)}</td></tr>`).join("")}
    </table>
    <p style="font-size:15px;font-weight:600;margin:0 0 6px;">How to use it</p>
    <ol style="font-size:14px;line-height:1.6;margin:0 0 16px;padding-left:20px;">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
    <p style="font-size:14px;margin:0 0 16px;">Sign-in page: <a href="${escapeHtml(portalUrl)}">${escapeHtml(portalUrl)}</a></p>
    <p style="font-size:13px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;">Keep this email: the code is all you need to get back online if you disconnect. Thank you for choosing ${escapeHtml(isp)}!</p>
  </div>`;

  await sendEmail({ to: data.email, subject: `Your ${isp} Wi-Fi voucher: ${voucher.code}`, text, html });
}
