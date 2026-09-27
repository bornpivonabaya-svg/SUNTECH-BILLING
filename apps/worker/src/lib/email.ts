import nodemailer, { type Transporter } from "nodemailer";
import { env, emailTransportConfigured } from "@mashupkgrid/config";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/**
 * Sends transactional email via Resend API (priority) or SMTP.
 *
 * If RESEND_API_KEY is configured (e.g. re_123...), it uses Resend's REST API for instant,
 * high-reputation delivery. If SMTP is configured, it falls back to nodemailer.
 * When neither is configured, logs clearly to console.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ delivered: boolean; id?: string }> {
  // 1. Resend API Priority
  if (env.RESEND_API_KEY) {
    try {
      const from = env.RESEND_FROM || env.SMTP_FROM || "Suntech Billing <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text: params.text,
          ...(params.attachments?.length
            ? { attachments: params.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) }
            : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`[email] Resend API error (${res.status}):`, data);
        throw new Error((data as any).message || `Resend API returned status ${res.status}`);
      }

      console.log(`[email] Resend successfully sent email to ${params.to} (id: ${(data as any).id})`);
      return { delivered: true, id: (data as any).id };
    } catch (err) {
      console.error(`[email] Resend send failed:`, err);
      // Fall through to SMTP if available
      if (!env.SMTP_HOST) throw err;
    }
  }

  // 2. SMTP Transport
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    await getTransporter().sendMail({
      from: env.SMTP_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      ...(params.attachments?.length
        ? { attachments: params.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType ?? "application/pdf" })) }
        : {}),
    });
    console.log(`[email] SMTP sent email to ${params.to}`);
    return { delivered: true };
  }

  // 3. Fallback / Dev Warning
  if (!emailTransportConfigured) {
    console.warn(
      `[email] Neither Resend nor SMTP is configured — email NOT sent. To: ${params.to} | Subject: ${params.subject}\n` +
        `${params.text}`
    );
    return { delivered: false };
  }

  return { delivered: false };
}
