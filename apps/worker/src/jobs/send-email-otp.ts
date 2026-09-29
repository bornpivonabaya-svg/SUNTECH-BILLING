import { sendEmailOtpJobSchema } from "@mashupkgrid/shared";
import { sendEmail } from "../lib/email.js";

export async function handleSendEmailOtp(payload: unknown): Promise<void> {
  const data = sendEmailOtpJobSchema.parse(payload);

  const subject = `Your Suntech Billing Verification Code: ${data.code}`;
  const text = [
    `Your verification code is: ${data.code}`,
    "",
    "This code will expire in 10 minutes.",
    "Do not share this code with anyone.",
    "",
    "If you did not request this verification, please ignore this email.",
    "",
    "— The MASHUPKGRID Team"
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
      <h3 style="color: #6366f1; margin-top: 0;">Verification Code</h3>
      <p style="font-size: 14px; color: #475569;">Please use the following 6-digit verification code to complete your verification:</p>
      <div style="text-align: center; margin: 24px 0; background-color: #f1f5f9; padding: 18px; border-radius: 8px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; font-family: monospace; color: #0f172a;">${data.code}</span>
      </div>
      <p style="font-size: 13px; color: #64748b;">This code is valid for 10 minutes. If you did not request this code, no action is required.</p>
    </div>
  `;

  await sendEmail({
    to: data.email,
    subject,
    text,
    html,
  });
}
