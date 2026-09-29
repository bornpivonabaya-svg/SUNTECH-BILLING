import { prisma, type TenantSubscriptionPayment } from "@mashupkgrid/database";
import { ConflictError, NotFoundError } from "@mashupkgrid/shared";
import { getPlatformMpesaCredentials } from "./platform-config.service.js";
import { initiateStkPush } from "./daraja-client.js";
import { normalizeKenyanPhone } from "./phone.js";
import { parseCallbackMetadata } from "./callback.service.js";
import { buildMpesaCallbackUrl } from "./callback-url.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Triggers a fresh STK push for the tenant's OWN current plan/cycle — self-service renewal, no
 * super admin involved (the ISP owner pays for their own subscription). Mirrors
 * onboarding-fee.service.ts's structure: creates a TenantSubscriptionPayment row as PENDING,
 * only ever moved to COMPLETED/FAILED by the verified callback below, never by this function
 * returning successfully.
 */
export async function initiateSubscriptionChargeStkPush(
  tenantId: string,
  phone: string
): Promise<TenantSubscriptionPayment> {
  const subscription = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!subscription) throw new NotFoundError("Subscription");

  const amountMinor =
    subscription.billingCycle === "ANNUAL"
      ? (subscription.plan.annualPriceMinor ?? subscription.plan.monthlyPriceMinor * 12)
      : subscription.plan.monthlyPriceMinor;

  const credentials = await getPlatformMpesaCredentials();
  const normalizedPhone = normalizeKenyanPhone(phone);
  const callbackUrl = buildMpesaCallbackUrl();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + (subscription.billingCycle === "ANNUAL" ? YEAR_MS : MONTH_MS));

  const response = await initiateStkPush({
    credentials,
    phone: normalizedPhone,
    amountMinor,
    accountReference: "SUBSCRIPTION",
    transactionDesc: `Suntech Billing ${subscription.plan.name} subscription`,
    callbackUrl,
  });

  return prisma.tenantSubscriptionPayment.create({
    data: {
      tenantId,
      subscriptionId: subscription.id,
      amountMinor,
      billingCycle: subscription.billingCycle,
      periodStart: now,
      periodEnd,
      phone: normalizedPhone,
      status: "PENDING",
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
    },
  });
}

/**
 * The subscription-payment counterpart to tryCompleteOnboardingFeeCallback — tried as a further
 * fallback by the shared /payments/mpesa/callback route after both handleStkCallback (customer
 * payments) and tryCompleteOnboardingFeeCallback have failed to match, since a CheckoutRequestID
 * is globally unique across all three tables. On success, also advances the TenantSubscription
 * itself into its new paid period.
 */
export async function tryCompleteSubscriptionPaymentCallback(rawPayload: unknown): Promise<boolean> {
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

  const existing = await prisma.tenantSubscriptionPayment.findUnique({
    where: { checkoutRequestId: stkCallback.CheckoutRequestID },
  });
  if (!existing) return false;
  if (existing.status !== "PENDING") return true;

  const metadata = parseCallbackMetadata(stkCallback.CallbackMetadata?.Item);
  const resultCode = stkCallback.ResultCode;
  const succeeded = resultCode === 0;

  await prisma.$transaction([
    prisma.tenantSubscriptionPayment.update({
      where: { id: existing.id },
      data: {
        status: succeeded ? "COMPLETED" : resultCode === 1032 ? "CANCELLED" : "FAILED",
        resultDesc: stkCallback.ResultDesc ?? null,
        mpesaReceiptNumber: metadata?.mpesaReceiptNumber ?? null,
        paidAt: succeeded ? new Date() : null,
        rawCallback: rawPayload as object,
      },
    }),
    ...(succeeded
      ? [
          prisma.tenantSubscription.update({
            where: { id: existing.subscriptionId },
            data: {
              status: "ACTIVE" as const,
              currentPeriodStart: existing.periodStart,
              currentPeriodEnd: existing.periodEnd,
              gracePeriodEndsAt: null,
            },
          }),
          prisma.tenant.update({ where: { id: existing.tenantId }, data: { trialEndsAt: null } }),
        ]
      : []),
  ]);

  return true;
}

export async function getTenantSubscriptionPayments(tenantId: string): Promise<TenantSubscriptionPayment[]> {
  return prisma.tenantSubscriptionPayment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}

export async function assertNoUnpaidSubscriptionCharge(tenantId: string): Promise<void> {
  const pending = await prisma.tenantSubscriptionPayment.findFirst({ where: { tenantId, status: "PENDING" } });
  if (pending) {
    throw new ConflictError("A renewal payment is already in progress for this account — please wait or check your phone.");
  }
}
