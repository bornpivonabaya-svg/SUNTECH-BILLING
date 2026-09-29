import { prisma, type TenantOnboardingFee } from "@mashupkgrid/database";
import { ConflictError, NotFoundError } from "@mashupkgrid/shared";
import { getPlatformMpesaCredentials } from "./platform-config.service.js";
import { initiateStkPush } from "./daraja-client.js";
import { normalizeKenyanPhone } from "./phone.js";
import { parseCallbackMetadata } from "./callback.service.js";
import { buildMpesaCallbackUrl } from "./callback-url.js";

const DEFAULT_ONBOARDING_FEE_MINOR = 45000; // KES 450.00

/** Creates (or re-triggers) the STK push for a tenant's one-time onboarding fee — called right
 *  after a super admin creates the tenant. A tenant with no phone given at creation simply has
 *  no fee row (nothing to charge yet); a super admin can trigger it later once they have one. */
export async function initiateOnboardingFeeStkPush(
  tenantId: string,
  phone: string
): Promise<TenantOnboardingFee> {
  const existing = await prisma.tenantOnboardingFee.findUnique({ where: { tenantId } });
  if (existing?.status === "COMPLETED") {
    throw new ConflictError("This tenant's onboarding fee is already paid");
  }

  const credentials = await getPlatformMpesaCredentials();
  const normalizedPhone = normalizeKenyanPhone(phone);
  const amountMinor = existing?.amountMinor ?? DEFAULT_ONBOARDING_FEE_MINOR;
  const callbackUrl = buildMpesaCallbackUrl();

  const response = await initiateStkPush({
    credentials,
    phone: normalizedPhone,
    amountMinor,
    accountReference: "ONBOARDING",
    transactionDesc: "Suntech Billing onboarding fee",
    callbackUrl,
  });

  return prisma.tenantOnboardingFee.upsert({
    where: { tenantId },
    create: {
      tenantId,
      amountMinor,
      phone: normalizedPhone,
      status: "PENDING",
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
    },
    update: {
      phone: normalizedPhone,
      status: "PENDING",
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
    },
  });
}

export async function getOnboardingFeeStatus(tenantId: string): Promise<TenantOnboardingFee | null> {
  return prisma.tenantOnboardingFee.findUnique({ where: { tenantId } });
}

/** The onboarding-fee counterpart to handleStkCallback (callback.service.ts) — tried as a
 *  fallback by the shared /payments/mpesa/callback route whenever the checkoutRequestId doesn't
 *  match any tenant-scoped MpesaStkRequest, since a CheckoutRequestID is globally unique across
 *  both tables (Safaricom mints it once, we choose which of our own two tables to look in). */
export async function tryCompleteOnboardingFeeCallback(rawPayload: unknown): Promise<boolean> {
  const body = rawPayload as {
    Body?: {
      stkCallback?: {
        CheckoutRequestID?: string;
        ResultCode?: number;
        ResultDesc?: string;
        CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
      };
    };
  };
  const stkCallback = body.Body?.stkCallback;
  if (!stkCallback?.CheckoutRequestID || typeof stkCallback.ResultCode !== "number") return false;

  const existing = await prisma.tenantOnboardingFee.findUnique({
    where: { checkoutRequestId: stkCallback.CheckoutRequestID },
  });
  if (!existing) return false;
  if (existing.status !== "PENDING") return true; // already resolved, nothing to do — but it was ours

  const metadata = parseCallbackMetadata(stkCallback.CallbackMetadata?.Item);
  const resultCode = stkCallback.ResultCode;

  await prisma.tenantOnboardingFee.update({
    where: { id: existing.id },
    data: {
      status: resultCode === 0 ? "COMPLETED" : resultCode === 1032 ? "CANCELLED" : "FAILED",
      resultDesc: stkCallback.ResultDesc ?? null,
      mpesaReceiptNumber: metadata?.mpesaReceiptNumber ?? null,
      paidAt: resultCode === 0 ? new Date() : null,
      rawCallback: rawPayload as object,
    },
  });

  return true;
}

export async function getOnboardingFeeOrThrow(tenantId: string): Promise<TenantOnboardingFee> {
  const fee = await prisma.tenantOnboardingFee.findUnique({ where: { tenantId } });
  if (!fee) throw new NotFoundError("Onboarding fee");
  return fee;
}
