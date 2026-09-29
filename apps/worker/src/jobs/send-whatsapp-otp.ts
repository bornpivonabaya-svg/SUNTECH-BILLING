import { sendWhatsappOtpJobSchema } from "@mashupkgrid/shared";
import { sendWhatsAppMessage } from "@mashupkgrid/whatsapp";
import { resolveSocket } from "../lib/whatsapp-runtime.js";

export async function handleSendWhatsappOtp(payload: unknown): Promise<void> {
  const data = sendWhatsappOtpJobSchema.parse(payload);
  const sock = resolveSocket(data.tenantId);
  if (!sock) {
    // Must actually fail (not silently no-op) so BullMQ retries it and so an undelivered code is
    // visible in the failed-jobs queue rather than a customer just never receiving one.
    throw new Error("No connected WhatsApp session available — cannot send OTP");
  }
  await sendWhatsAppMessage(
    sock,
    data.phone,
    `Your Suntech Billing verification code is: ${data.code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`
  );
}
