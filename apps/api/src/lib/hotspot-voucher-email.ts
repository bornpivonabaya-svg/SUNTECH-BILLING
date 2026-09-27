import { enqueueSendHotspotVoucherEmail } from "./queue.js";

/** The placeholder a guest card purchase is charged under when the buyer gave no email. */
export function isRealBuyerEmail(email: string | null | undefined): email is string {
  return !!email && email.includes("@") && !email.toLowerCase().endsWith("@hotspot.local");
}

/**
 * Emails a completed purchase's voucher to the address given at checkout, once: the payment
 * callback and the portal's status poll can both see the same purchase complete. Never throws,
 * since a queue hiccup must not fail the payment path that calls it.
 */
export async function emailHotspotVoucherOnce(
  tenantId: string,
  email: string | null | undefined,
  voucherCode: string | null | undefined
): Promise<void> {
  if (!voucherCode || !isRealBuyerEmail(email)) return;
  try {
    await enqueueSendHotspotVoucherEmail({ tenantId, email, voucherCode }, `${voucherCode}-${email.toLowerCase()}`);
  } catch (err) {
    console.warn(`[hotspot] could not queue the voucher email for ${voucherCode}`, err);
  }
}
