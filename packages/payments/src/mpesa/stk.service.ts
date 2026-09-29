import { prisma, type MpesaStkRequest } from "@mashupkgrid/database";
import { ConflictError, NotFoundError, ValidationError } from "@mashupkgrid/shared";
import { getMpesaCredentials, type MpesaCredentials } from "./config.service.js";
import { getPlatformMpesaCredentials } from "./platform-config.service.js";
import { initiateStkPush, queryStkPushStatus } from "./daraja-client.js";
import { normalizeKenyanPhone } from "./phone.js";
import { completeStkRequest, isStkRequestOpen, isStkStillProcessing } from "./callback.service.js";
import { buildMpesaCallbackUrl } from "./callback-url.js";
import { getSettlementSettings } from "../gateway/settings.service.js";
import { getOrCreateCustomerReference, getOrCreateInvoiceReference } from "../gateway/payment-reference.service.js";

/**
 * Whose M-Pesa account collects this payment.
 *
 * This is the switch that makes the aggregator model safe. A tenant on OWN mode is charged
 * through their own credentials and the money reaches them directly — no ledger entry is created
 * for them, and none should be. A tenant on PLATFORM mode is charged through the platform's
 * paybill, which is why the ledger then owes them the balance.
 *
 * Getting this wrong in either direction is a money bug: collect with the tenant's credentials
 * while crediting the ledger and they are paid twice; collect with the platform's while skipping
 * the credit and they are never paid at all. collectionMode is read once, here, when the push is
 * initiated, and stamped on the request as `collectedBy`; the callback credits the ledger from that
 * stamp, so a tenant switching modes while a payment is in flight cannot misattribute it.
 */
async function resolveCollectingCredentials(
  tenantId: string
): Promise<{ credentials: MpesaCredentials; collectedByPlatform: boolean; tenantSlug: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { collectionMode: true, slug: true },
  });
  const collectedByPlatform = tenant?.collectionMode === "PLATFORM";
  if (collectedByPlatform) {
    const settings = await getSettlementSettings();
    if (!settings.gatewayEnabled) {
      throw new ConflictError(
        "Online payments are temporarily unavailable — the Suntech payment gateway is switched off. Please try again later."
      );
    }
  }
  return {
    credentials: collectedByPlatform
      ? await getPlatformMpesaCredentials()
      : await getMpesaCredentials(tenantId),
    collectedByPlatform,
    tenantSlug: tenant?.slug ?? "",
  };
}

/**
 * What the payer sees on their M-Pesa statement, and what the receiving statement is grouped by.
 *
 * When one paybill collects for many tenants, the reference has to say WHICH tenant the money
 * belongs to — otherwise a statement is an undifferentiated list and manual reconciliation is
 * impossible. When a tenant collects on their own paybill every payment is already theirs, so
 * the more useful thing to show the customer is what they bought.
 *
 * Daraja truncates this to 12 characters, so the slug is trimmed rather than the label, keeping
 * the tenant identifiable even for a long slug.
 */
function buildAccountReference(
  collectedByPlatform: boolean,
  tenantSlug: string,
  fallback: string
): string {
  return collectedByPlatform && tenantSlug ? tenantSlug.slice(0, 12) : fallback;
}

export interface InitiateStkPushInput {
  customerId: string;
  invoiceId?: string | null;
  phone: string;
  amountMinor: number;
  /** Null for a customer paying through the public checkout page. */
  initiatedByUserId: string | null;
}

/**
 * Initiates an STK Push. Creates the `MpesaStkRequest` row as PENDING — it is only ever moved
 * to COMPLETED/FAILED by the verified callback or a status query, never by this function
 * returning successfully (project instruction §13: never trust the frontend/initiating request
 * to mark a payment successful).
 */
export async function initiateStkPushForCustomer(
  tenantId: string,
  input: InitiateStkPushInput
): Promise<MpesaStkRequest> {
  if (input.amountMinor <= 0) throw new ValidationError("Amount must be positive");

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, tenantId, deletedAt: null },
  });
  if (!customer) throw new NotFoundError("Customer");

  let accountReference = customer.customerNumber;
  if (input.invoiceId) {
    const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId, tenantId } });
    if (!invoice) throw new NotFoundError("Invoice");
    if (invoice.customerId !== customer.id) {
      throw new ConflictError("Invoice does not belong to this customer");
    }
    if (invoice.status === "PAID") throw new ConflictError("Invoice is already fully paid");
    accountReference = invoice.invoiceNumber;
  }

  const collection = await resolveCollectingCredentials(tenantId);
  const phone = normalizeKenyanPhone(input.phone);
  const callbackUrl = buildMpesaCallbackUrl();

  // On the platform paybill the account reference must say whose money this is. A payment
  // reference identifies tenant, customer and invoice on its own, and it is what reconciliation
  // matches on.
  const paymentReference = collection.collectedByPlatform
    ? input.invoiceId
      ? await getOrCreateInvoiceReference(tenantId, input.invoiceId)
      : await getOrCreateCustomerReference(tenantId, customer.id)
    : null;
  if (paymentReference) accountReference = paymentReference.reference;

  const response = await initiateStkPush({
    credentials: collection.credentials,
    phone,
    amountMinor: input.amountMinor,
    accountReference,
    transactionDesc: "Internet Payment",
    callbackUrl,
  });

  return prisma.mpesaStkRequest.create({
    data: {
      tenantId,
      customerId: customer.id,
      invoiceId: input.invoiceId ?? null,
      initiatedByUserId: input.initiatedByUserId,
      phone,
      amountMinor: input.amountMinor,
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
      status: "PENDING",
      collectedBy: collection.collectedByPlatform ? "PLATFORM" : "OWN",
      paymentReferenceId: paymentReference?.id ?? null,
    },
  });
}

export interface InitiateHotspotStkPushInput {
  hotspotPackageId: string;
  phone: string;
  /** Where to email the voucher once the payment completes. */
  email?: string | null;
}

export async function initiateHotspotPurchaseStkPush(
  tenantId: string,
  input: InitiateHotspotStkPushInput
): Promise<MpesaStkRequest> {
  const pkg = await prisma.hotspotPackage.findFirst({
    where: { id: input.hotspotPackageId, tenantId, isActive: true },
  });
  if (!pkg) throw new NotFoundError("HotspotPackage");

  const collection = await resolveCollectingCredentials(tenantId);
  const phone = normalizeKenyanPhone(input.phone);
  const callbackUrl = buildMpesaCallbackUrl();

  const response = await initiateStkPush({
    credentials: collection.credentials,
    phone,
    amountMinor: pkg.priceMinor,
    accountReference: buildAccountReference(
      collection.collectedByPlatform,
      collection.tenantSlug,
      `WiFi-${pkg.name.slice(0, 7)}`
    ),
    transactionDesc: `WiFi ${pkg.name}`,
    callbackUrl,
  });

  return prisma.mpesaStkRequest.create({
    data: {
      tenantId,
      hotspotPackageId: pkg.id,
      hotspotEmail: input.email?.trim().toLowerCase() || null,
      phone,
      amountMinor: pkg.priceMinor,
      merchantRequestId: response.MerchantRequestID,
      checkoutRequestId: response.CheckoutRequestID,
      status: "PENDING",
      collectedBy: collection.collectedByPlatform ? "PLATFORM" : "OWN",
    },
  });
}

export async function getStkRequestOrThrow(tenantId: string, checkoutRequestId: string): Promise<MpesaStkRequest> {
  const request = await prisma.mpesaStkRequest.findFirst({ where: { tenantId, checkoutRequestId } });
  if (!request) throw new NotFoundError("STK push request");
  return request;
}

/**
 * Server-initiated status check — the defensive fallback for a lost/delayed callback
 * (docs/architecture/10-phase3-plan.md, project instruction's "delayed callback" test case).
 *
 * Real limitation of Safaricom's STK Push Query API: unlike the callback, it never returns
 * `CallbackMetadata` (no MpesaReceiptNumber) even when `ResultCode` is 0. Without a receipt
 * number we cannot safely create an idempotent Payment record, so a query result of "success"
 * deliberately does **not** auto-complete the request here — it's left PENDING for the real
 * callback (or manual reconciliation) to finish, and the caller is expected to log this case
 * for operator visibility. A definitive failure/cancellation, by contrast, needs no receipt
 * number and is safe to apply immediately.
 */
export async function queryAndReconcileStkRequest(
  tenantId: string,
  checkoutRequestId: string
): Promise<{ request: MpesaStkRequest; unresolvedSuccess: boolean }> {
  const request = await getStkRequestOrThrow(tenantId, checkoutRequestId);
  if (!isStkRequestOpen(request)) return { request, unresolvedSuccess: false };

  // Same account that pushed it — recorded on the request, not re-derived from the tenant's current
  // mode: a status query signed by a different shortcode cannot find it.
  const credentials =
    request.collectedBy === "PLATFORM" ? await getPlatformMpesaCredentials() : await getMpesaCredentials(tenantId);
  const result = await queryStkPushStatus(credentials, checkoutRequestId);
  const resultCode = Number(result.ResultCode);

  // Still pending: no code yet, or Safaricom's "still under processing" (the PIN prompt is open).
  if (Number.isNaN(resultCode) || isStkStillProcessing(resultCode, result.ResultDesc)) {
    return { request, unresolvedSuccess: false };
  }

  if (resultCode === 0) {
    const provisionalReceipt = `PRV-${checkoutRequestId.replace(/[^A-Za-z0-9]/g, "").slice(-12).toUpperCase()}`;
    const updated = await completeStkRequest(tenantId, checkoutRequestId, {
      resultCode: 0,
      resultDesc: result.ResultDesc || "The service request is processed successfully.",
      metadata: {
        mpesaReceiptNumber: provisionalReceipt,
        amountMinor: request.amountMinor,
        phone: request.phone,
      },
      raw: result,
    });
    return { request: updated, unresolvedSuccess: false };
  }

  const updated = await completeStkRequest(tenantId, checkoutRequestId, {
    resultCode,
    resultDesc: result.ResultDesc,
    metadata: null,
    raw: result,
  });
  return { request: updated, unresolvedSuccess: false };
}
