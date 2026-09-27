import { sendTenantWelcomeEmailJobSchema, type SendTenantWelcomeEmailJob } from "@mashupkgrid/shared";
import { sendEmail } from "../lib/email.js";

/**
 * The three emails an ISP owner gets while onboarding: "we have your application" the moment
 * they register, the real welcome (with working links) when a super admin approves them, and a
 * plain "not approved" with the reason otherwise. One handler because they share the frame and
 * the data; the copy is what differs.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function frame(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
      <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">${title}</h2>
      ${bodyHtml}
      <p style="font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px;">
        Suntech Billing · This is an automated message about your account. Reply to reach the team.
      </p>
    </div>
  `;
}

function pendingEmail(data: SendTenantWelcomeEmailJob) {
  const subject = `We received your application for ${data.companyName}`;
  const text = [
    `Hi ${data.ownerName},`,
    "",
    `Thanks for registering "${data.companyName}" on Suntech Billing.`,
    "",
    "Your application is now with our team for approval. Nothing more is needed from you: you will get another email the moment it is approved, with your sign-in link.",
    "",
    `Your username will be ${data.email}, and your dashboard address will be ${data.dashboardUrl}.`,
    "",
    "The Suntech Billing Team",
  ].join("\n");
  const html = frame(
    `Thanks, ${escapeHtml(data.ownerName)} — we have your application`,
    `<p style="font-size: 15px; line-height: 1.5;">Thanks for registering <strong>${escapeHtml(data.companyName)}</strong> on Suntech Billing.</p>
     <p style="font-size: 15px; line-height: 1.5;">Your application is with our team for approval. Nothing more is needed from you — you'll get another email the moment it's approved, with your sign-in link.</p>
     <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin: 20px 0; font-size: 14px;">
       <div style="color:#64748b">Username</div><div style="font-weight:600; margin-bottom: 8px;">${escapeHtml(data.email)}</div>
       <div style="color:#64748b">Dashboard (once approved)</div><div style="font-weight:600; font-family: monospace;">${escapeHtml(data.dashboardUrl)}</div>
     </div>`
  );
  return { subject, text, html };
}

function approvedEmail(data: SendTenantWelcomeEmailJob) {
  const subject = `${data.companyName} is approved — sign in to Suntech Billing`;
  const text = [
    `Hi ${data.ownerName},`,
    "",
    `Good news: "${data.companyName}" has been approved and is live on Suntech Billing.`,
    "",
    "--- YOUR ACCOUNT & SUBDOMAIN DETAILS ---",
    `• Organization: ${data.companyName}`,
    `• Subdomain: ${data.subdomain}`,
    `• Login Email / Username: ${data.email}`,
    ...(data.temporaryPassword ? [`• Temporary Password: ${data.temporaryPassword}`] : []),
    `• Dashboard Login URL: ${data.dashboardUrl}`,
    `• Captive Portal URL: ${data.portalUrl}`,
    "",
    "Sign in to your dashboard to link your routers, set up hotspot packages and connect M-Pesa.",
    data.temporaryPassword
      ? "You received a temporary password: change it under Settings > Password after your first sign-in."
      : "Sign in with the password you created when you registered. Use \"Forgot password\" on the sign-in page if you need to reset it.",
    "",
    "Welcome aboard,",
    "The Suntech Billing Team",
  ].join("\n");

  const html = frame(
    `Welcome, ${escapeHtml(data.ownerName)} — ${escapeHtml(data.companyName)} is approved`,
    `<p style="font-size: 15px; line-height: 1.5;">Your ISP <strong>${escapeHtml(data.companyName)}</strong> is now live on the platform.</p>
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px;">Your account</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #64748b;">Subdomain</td><td style="padding: 6px 0; font-weight: 600; font-family: monospace;">${escapeHtml(data.subdomain)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Username</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(data.email)}</td></tr>
          ${
            data.temporaryPassword
              ? `<tr><td style="padding: 6px 0; color: #64748b;">Temporary password</td><td style="padding: 6px 0; font-weight: 600; font-family: monospace;">${escapeHtml(data.temporaryPassword)}</td></tr>`
              : ""
          }
          <tr><td style="padding: 6px 0; color: #64748b;">Dashboard</td><td style="padding: 6px 0;"><a href="${escapeHtml(data.dashboardUrl)}" style="color: #0284c7;">${escapeHtml(data.dashboardUrl)}</a></td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Hotspot portal</td><td style="padding: 6px 0;"><a href="${escapeHtml(data.portalUrl)}" style="color: #0284c7;">${escapeHtml(data.portalUrl)}</a></td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${escapeHtml(data.dashboardUrl)}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Sign in to your dashboard</a>
      </div>
      <p style="font-size: 14px; color: #475569;">${
        data.temporaryPassword
          ? "Change the temporary password under Settings › Password after your first sign-in."
          : "Sign in with the password you created when you registered. For your security we never send passwords by email."
      }</p>`
  );
  return { subject, text, html };
}

function rejectedEmail(data: SendTenantWelcomeEmailJob) {
  const subject = `Your application for ${data.companyName} was not approved`;
  const reasonLine = data.reason ? `Reason: ${data.reason}` : "";
  const text = [
    `Hi ${data.ownerName},`,
    "",
    `We reviewed your application for "${data.companyName}" and could not approve it at this time.`,
    ...(reasonLine ? ["", reasonLine] : []),
    "",
    "If you think this is a mistake, or you would like to reapply with more details, reply to this email.",
    "",
    "The Suntech Billing Team",
  ].join("\n");
  const html = frame(
    "Your application was not approved",
    `<p style="font-size: 15px; line-height: 1.5;">We reviewed your application for <strong>${escapeHtml(data.companyName)}</strong> and could not approve it at this time.</p>
     ${data.reason ? `<p style="font-size: 15px; line-height: 1.5;"><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ""}
     <p style="font-size: 15px; line-height: 1.5;">If you think this is a mistake, or would like to reapply with more details, reply to this email.</p>`
  );
  return { subject, text, html };
}

export function buildTenantOnboardingEmail(data: SendTenantWelcomeEmailJob): { subject: string; text: string; html: string } {
  if (data.stage === "pending") return pendingEmail(data);
  if (data.stage === "rejected") return rejectedEmail(data);
  return approvedEmail(data);
}

export async function handleSendTenantWelcomeEmail(payload: unknown): Promise<void> {
  const data = sendTenantWelcomeEmailJobSchema.parse(payload);
  await sendEmail({ to: data.email, ...buildTenantOnboardingEmail(data) });
}
