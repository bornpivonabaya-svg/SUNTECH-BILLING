import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  setMpesaConfig,
  getMpesaConfigStatus,
  initiateStkPushForCustomer,
  getStkRequestOrThrow,
  queryAndReconcileStkRequest,
  handleStkCallback,
  handleC2BValidation,
  handleC2BConfirmation,
  manuallyReconcileC2BTransaction,
  tryCompleteOnboardingFeeCallback,
  tryCompleteSubscriptionPaymentCallback,
  tryCompleteDonationCallback,
  tryCompleteStoreOrderCallback,
  getPlatformMpesaConfigStatus,
  getPlatformB2BStatus,
  setPlatformMpesaConfig,
  applySettlementResult,
  markSettlementTimedOut,
  handlePlatformC2BConfirmation,
  logWebhookReceived,
  finishWebhookEvent,
  extractStkCheckoutId,
  extractC2BTransId,
  extractResultConversationId,
  initiateStkPush,
  queryStkPushStatus,
  getPlatformMpesaCredentials,
  normalizeKenyanPhone,
  buildMpesaCallbackUrl,
  getDonateConfig,
} from "@mashupkgrid/payments";
import { successResponse, ConflictError, timingSafeStringEqual } from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { settleAfterCollection } from "../lib/settle-after-collection.js";
import { writeAuditLog } from "../lib/audit.js";
import { enqueueSendPaymentConfirmationEmail, enqueueSendWhatsappVoucher } from "../lib/queue.js";
import { emitWebhookEvent } from "../lib/webhooks.js";
import { emailHotspotVoucherOnce } from "../lib/hotspot-voucher-email.js";

const staffPreHandler = [authenticate, resolveTenant, checkMaintenance] as const;

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("M-Pesa is not available at the platform level");
  return tenantId;
}

/** Confirmation email + outbound "payment.received" webhook for a matched paybill payment. */
async function notifyC2BPayment(
  tenantId: string,
  transaction: { amountMinor: number; transactionId: string; matchedCustomerId: string | null }
): Promise<void> {
  const customer = transaction.matchedCustomerId
    ? await prisma.customer.findUnique({ where: { id: transaction.matchedCustomerId } })
    : null;
  if (customer?.email) {
    await enqueueSendPaymentConfirmationEmail({
      email: customer.email,
      customerName: customer.fullName,
      amountMinor: transaction.amountMinor,
      receiptNumber: transaction.transactionId,
      tenantId,
    });
  }
  void emitWebhookEvent(tenantId, "payment.received", {
    method: "MPESA_C2B",
    amountMinor: transaction.amountMinor,
    receiptNumber: transaction.transactionId,
    customerId: transaction.matchedCustomerId,
  });
}

/**
 * Daraja has no signature scheme for its webhooks — anyone who can reach these public URLs can
 * POST a payload that looks exactly like a genuine Safaricom callback. When MPESA_CALLBACK_TOKEN
 * is configured, it's required as a `?token=` query param on the callback/C2B URLs actually
 * handed to Safaricom (see packages/payments/src/mpesa/callback-url.ts); requests missing or
 * failing that check here are silently dropped (acked as if handled, never processed) rather than
 * given a distinguishing error response. Left permissive (returns true) when unconfigured so a
 * fresh/dev install without it set doesn't hard-fail — see the startup warning below.
 */
function hasValidCallbackToken(request: FastifyRequest): boolean {
  if (!env.MPESA_CALLBACK_TOKEN) return true;
  const provided = (request.query as { token?: unknown }).token;
  return typeof provided === "string" && timingSafeStringEqual(provided, env.MPESA_CALLBACK_TOKEN);
}

if (!env.MPESA_CALLBACK_TOKEN) {
  console.warn(
    "[SECURITY] MPESA_CALLBACK_TOKEN is not set — the M-Pesa callback and C2B webhook endpoints " +
      "will accept a payment-completion payload from anyone who can reach them, not just Safaricom. " +
      "Set MPESA_CALLBACK_TOKEN before handling real payments."
  );
}

const setConfigSchema = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  shortcode: z.string().min(1),
  passkey: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
});

/** Tenant config additionally carries the Paybill/Till distinction. The PLATFORM config (the
 *  account tenants pay their SaaS fees into) deliberately keeps the plain schema above — it is a
 *  single paybill this platform controls, not something an operator picks per deployment. */
/** The platform's own paybill, B2B initiator for tenant payouts, and public donate gateway settings. */
const platformConfigSchema = z.object({
  consumerKey: z.string().min(1).optional(),
  consumerSecret: z.string().min(1).optional(),
  shortcode: z.string().min(5).max(10).optional(),
  passkey: z.string().min(1).optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  isActive: z.boolean().optional(),
  initiatorName: z.string().max(64).optional().or(z.literal("")),
  // Safaricom's certificate-encrypted blob is long; it is stored encrypted again at rest and
  // never returned to any client.
  initiatorCredential: z.string().max(2048).optional().or(z.literal("")),
  payoutMinimumMinor: z.coerce.number().int().min(1).optional(),
  // --- Donate / "Buy Me a Coffee" M-Pesa gateway ---
  donateEnabled: z.boolean().optional(),
  donatePaybill: z.string().max(20).optional().or(z.literal("")),
  donateAccountReference: z.string().max(12).optional().or(z.literal("")),
});

const setTenantConfigSchema = setConfigSchema.extend({
  shortcodeType: z.enum(["PAYBILL", "TILL"]).default("PAYBILL"),
  // Optional even for TILL: Safaricom sometimes issues a till whose store number is the same
  // value, and darajaBusinessShortCode falls back to the shortcode when this is absent.
  storeNumber: z.string().max(20).optional(),
});

const stkPushSchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  phone: z.string().min(9),
  amountMinor: z.number().int().positive(),
});

const reconcileSchema = z
  .object({ invoiceId: z.string().uuid().optional(), customerId: z.string().uuid().optional() })
  .refine((v) => v.invoiceId ?? v.customerId, "Provide either invoiceId or customerId");

export async function mpesaRoutes(app: FastifyInstance): Promise<void> {
  // --- Staff-facing, authenticated ---------------------------------------------------------

  app.get(
    "/config",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("settings.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      reply.send(successResponse(await getMpesaConfigStatus(tenantId), request.id));
    }
  );

  app.put(
    "/config",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("settings.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = setTenantConfigSchema.parse(request.body);
      await setMpesaConfig(tenantId, body);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "mpesa_config.updated",
        resourceType: "PaymentProviderConfig",
        // Never log the secrets themselves — only that a change happened and by whom.
        after: {
          shortcode: body.shortcode,
          shortcodeType: body.shortcodeType,
          environment: body.environment,
        },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(await getMpesaConfigStatus(tenantId), request.id));
    }
  );

  app.post(
    "/stk-push",
    {
      config: { audience: "staff", maintenanceCategory: "payment" },
      preHandler: [...staffPreHandler, requirePermission("payments.create")],
    },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = stkPushSchema.parse(request.body);

      const stkRequest = await initiateStkPushForCustomer(tenantId, {
        customerId: body.customerId,
        invoiceId: body.invoiceId ?? null,
        phone: body.phone,
        amountMinor: body.amountMinor,
        initiatedByUserId: request.user!.id,
      });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "mpesa.stk_push_initiated",
        resourceType: "MpesaStkRequest",
        resourceId: stkRequest.id,
        after: { customerId: body.customerId, invoiceId: body.invoiceId, amountMinor: body.amountMinor },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(successResponse(stkRequest, request.id));
    }
  );

  app.get(
    "/stk-push/:checkoutRequestId",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("payments.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { checkoutRequestId } = z.object({ checkoutRequestId: z.string() }).parse(request.params);

      const current = await getStkRequestOrThrow(tenantId, checkoutRequestId);
      if (current.status !== "PENDING") {
        reply.send(successResponse(current, request.id));
        return;
      }

      // Still pending from our side — actively ask Safaricom rather than making the client poll
      // forever against stale local state (defensive against a lost callback).
      const { request: refreshed, unresolvedSuccess } = await queryAndReconcileStkRequest(
        tenantId,
        checkoutRequestId
      );
      reply.send(successResponse({ ...refreshed, unresolvedSuccess }, request.id));
    }
  );

  app.get(
    "/reconciliation",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("payments.reconcile")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const transactions = await prisma.mpesaC2BTransaction.findMany({
        where: { tenantId, reconciled: false },
        orderBy: { createdAt: "desc" },
      });
      reply.send(successResponse(transactions, request.id));
    }
  );

  app.post(
    "/reconciliation/:transactionId/match",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("payments.reconcile")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { transactionId } = z.object({ transactionId: z.string() }).parse(request.params);
      const body = reconcileSchema.parse(request.body);

      const result = await manuallyReconcileC2BTransaction(tenantId, transactionId, body);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "mpesa.c2b_reconciled",
        resourceType: "MpesaC2BTransaction",
        resourceId: result.id,
        after: body,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

  // --- Public webhooks (Safaricom) — audience "system-critical" bypasses maintenance mode
  // entirely (docs/architecture/05-maintenance-and-queues.md §44/45) and carries no auth, since
  // Safaricom cannot send our bearer tokens. -------------------------------------------------

  // The tenant-facing settlement endpoints that used to live here (GET /settlement, PATCH
  // /settlement/destination, and the platform /settlement/owed|payouts|:tenantId/payout) are
  // replaced by /api/v1/tenant-payments and /api/v1/platform/payments, which add fees, settlement
  // destinations of every type, approvals, audit trails and an immutable ledger.

  /**
   * Daraja's asynchronous result for a B2B or B2C settlement — the ONLY thing that can say a
   * tenant's money actually moved. Always answers 200 (Daraja retries anything else); idempotency
   * is enforced in applySettlementResult, which row-locks the settlement and refuses to touch one
   * that is already final.
   */
  app.post("/payout/result", { config: { audience: "system-critical" } }, async (request, reply) => {
    const eventId = await logWebhookReceived({
      provider: "MPESA",
      eventType: "SETTLEMENT_RESULT",
      externalId: extractResultConversationId(request.body),
      payload: request.body,
      sourceIp: request.ip,
    });
    if (!hasValidCallbackToken(request)) {
      await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: "Missing or invalid callback token" });
      reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const result = (request.body as {
      Result?: { ResultCode?: number | string; ResultDesc?: string; OriginatorConversationID?: string; TransactionID?: string };
    })?.Result;

    if (!result?.OriginatorConversationID) {
      await finishWebhookEvent(eventId, { status: "IGNORED", errorMessage: "No OriginatorConversationID" });
    } else {
      try {
        const { outcome, settlement } = await applySettlementResult({
          originatorConversationId: result.OriginatorConversationID,
          resultCode: Number(result.ResultCode ?? -1),
          resultDesc: String(result.ResultDesc ?? ""),
          transactionId: result.TransactionID ?? null,
        });
        await finishWebhookEvent(eventId, {
          status: outcome,
          tenantId: settlement?.tenantId ?? null,
          transactionReference: settlement?.settlementNumber ?? null,
          response: { status: settlement?.status ?? null },
        });
      } catch (err) {
        // Logged, never surfaced: an error response makes Daraja retry, and this is money.
        request.log.error({ err }, "Failed to apply M-Pesa settlement result");
        await finishWebhookEvent(eventId, { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) });
      }
    }
    reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
  });

  /**
   * Daraja's queue-timeout callback. The request sat too long in Safaricom's queue — which does NOT
   * prove the money didn't move — so the settlement is flagged for review with its balance still
   * reserved, rather than being failed (which, if it had in fact gone through, would let the same
   * balance be paid out again).
   */
  app.post("/payout/timeout", { config: { audience: "system-critical" } }, async (request, reply) => {
    const eventId = await logWebhookReceived({
      provider: "MPESA",
      eventType: "SETTLEMENT_TIMEOUT",
      externalId: extractResultConversationId(request.body),
      payload: request.body,
      sourceIp: request.ip,
    });
    if (!hasValidCallbackToken(request)) {
      await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: "Missing or invalid callback token" });
      reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }
    const id = extractResultConversationId(request.body);
    if (!id) {
      await finishWebhookEvent(eventId, { status: "IGNORED", errorMessage: "No OriginatorConversationID" });
    } else {
      try {
        const { outcome, settlement } = await markSettlementTimedOut(id);
        await finishWebhookEvent(eventId, {
          status: outcome,
          tenantId: settlement?.tenantId ?? null,
          transactionReference: settlement?.settlementNumber ?? null,
        });
      } catch (err) {
        request.log.error({ err }, "Failed to apply M-Pesa settlement timeout");
        await finishWebhookEvent(eventId, { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) });
      }
    }
    reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
  });

  app.post("/callback", { config: { audience: "system-critical" } }, async (request, reply) => {
    const eventId = await logWebhookReceived({
      provider: "MPESA",
      eventType: "STK_CALLBACK",
      externalId: extractStkCheckoutId(request.body),
      payload: request.body,
      sourceIp: request.ip,
    });
    if (!hasValidCallbackToken(request)) {
      // Ack as if handled — never distinguish "wrong token" from "handled" in the response, and
      // never process a payload that failed this check.
      await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: "Missing or invalid callback token" });
      reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    let outcome;
    try {
      outcome = await handleStkCallback(request.body);
    } catch (err) {
      // Nothing was committed (the whole resolution is one transaction). Answer 200 regardless —
      // a retry storm helps no one — and leave the request PENDING for the status-query poller to
      // resolve; the failure is visible in the webhook log.
      request.log.error({ err }, "Failed to process M-Pesa STK callback");
      await finishWebhookEvent(eventId, { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) });
      reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    if (outcome.handled && outcome.checkoutRequestId) {
      const stkRequest = await prisma.mpesaStkRequest.findUnique({
        where: { checkoutRequestId: outcome.checkoutRequestId },
        include: { customer: true, hotspotPackage: true, tenant: true },
      });
      await finishWebhookEvent(eventId, {
        status: outcome.duplicate ? "DUPLICATE" : "PROCESSED",
        tenantId: stkRequest?.tenantId ?? null,
        transactionReference: stkRequest?.mpesaReceiptNumber ?? null,
        response: { status: stkRequest?.status ?? null },
      });
      // Notifications only for the first delivery — a duplicate must not re-send a voucher.
      if (stkRequest?.status === "COMPLETED" && !outcome.duplicate) {
        if (stkRequest.collectedBy === "PLATFORM") settleAfterCollection(stkRequest.tenantId, request.log);
        if (stkRequest.customer?.email) {
          await enqueueSendPaymentConfirmationEmail({
            email: stkRequest.customer.email,
            customerName: stkRequest.customer.fullName,
            amountMinor: stkRequest.amountMinor,
            receiptNumber: stkRequest.mpesaReceiptNumber ?? "",
            tenantId: stkRequest.tenantId ?? undefined,
          });
        }
        // A hotspot purchase has no Customer row at all (it's an anonymous walk-in buy), so the
        // confirmation email above never fires for one — the phone that paid is the only contact
        // detail we have, and it's exactly the WhatsApp number to send the voucher to.
        if (stkRequest.hotspotVoucherCode) {
          await enqueueSendWhatsappVoucher({
            tenantId: stkRequest.tenantId,
            phone: stkRequest.phone,
            voucherCode: stkRequest.hotspotVoucherCode,
            tenantName: stkRequest.tenant.name,
            packageName: stkRequest.hotspotPackage?.name ?? null,
            amountMinor: stkRequest.amountMinor,
            currency: stkRequest.hotspotPackage?.currency ?? "KES",
            durationMinutes: stkRequest.hotspotPackage?.durationMinutes ?? null,
            dataCapMb: stkRequest.hotspotPackage?.dataCapMb ?? null,
          });
          await emailHotspotVoucherOnce(stkRequest.tenantId, stkRequest.hotspotEmail, stkRequest.hotspotVoucherCode);
        }
        void emitWebhookEvent(stkRequest.tenantId, "payment.received", {
          method: "MPESA_STK",
          amountMinor: stkRequest.amountMinor,
          receiptNumber: stkRequest.mpesaReceiptNumber,
          customerId: stkRequest.customerId,
        });
      }
    } else {
      // Not a tenant-scoped payment (customer/hotspot) — same globally-unique CheckoutRequestID
      // could still belong to a tenant's own onboarding fee or a recurring subscription charge
      // (two more separate tables by design, see TenantOnboardingFee/TenantSubscriptionPayment's
      // schema comments), so try each before giving up.
      const matched =
        (await tryCompleteOnboardingFeeCallback(request.body)) ||
        (await tryCompleteSubscriptionPaymentCallback(request.body)) ||
        // A hardware order from the public store.
        (await tryCompleteStoreOrderCallback(request.body)) ||
        // Last resort: could be a donation from the public "Buy Me a Coffee" page.
        (await tryCompleteDonationCallback(request.body));
      await finishWebhookEvent(eventId, {
        status: matched ? "PROCESSED" : "IGNORED",
        ...(matched ? {} : { errorMessage: "CheckoutRequestID matched no payment this platform initiated" }),
      });
    }
    // Always ack 200 — Safaricom retries aggressively on non-200, and we've already durably
    // stored everything we could parse (project instruction §13: idempotent, safe response).
    reply.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
  });

  app.post(
    "/c2b/:tenantSlug/validation",
    { config: { audience: "system-critical" } },
    async (request, reply) => {
      const { tenantSlug } = z.object({ tenantSlug: z.string() }).parse(request.params);
      if (!hasValidCallbackToken(request)) {
        reply.status(200).send({ ResultCode: "C2B00012", ResultDesc: "Rejected" });
        return;
      }
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) {
        reply.status(200).send({ ResultCode: "C2B00012", ResultDesc: "Unknown tenant" });
        return;
      }
      reply.status(200).send(handleC2BValidation(tenant.id, request.body));
    }
  );

  app.post(
    "/c2b/:tenantSlug/confirmation",
    { config: { audience: "system-critical" } },
    async (request, reply) => {
      const { tenantSlug } = z.object({ tenantSlug: z.string() }).parse(request.params);
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      const eventId = await logWebhookReceived({
        provider: "MPESA",
        eventType: "C2B_CONFIRMATION",
        externalId: extractC2BTransId(request.body),
        tenantId: tenant?.id ?? null,
        payload: request.body,
        sourceIp: request.ip,
      });
      if (!hasValidCallbackToken(request)) {
        await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: "Missing or invalid callback token" });
        reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
        return;
      }
      if (!tenant) {
        // Nothing we can attribute this to — ack anyway (money already moved on Safaricom's
        // side; rejecting the webhook doesn't undo that) but do not fabricate a tenant.
        await finishWebhookEvent(eventId, { status: "IGNORED", errorMessage: `Unknown tenant slug "${tenantSlug}"` });
        reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
        return;
      }

      // Any rejection here (malformed payload, BusinessShortCode mismatch — see c2b.service.ts)
      // must still ack cleanly rather than surface as an error response: Safaricom retries
      // aggressively on non-200, and a forged/mismatched payload retried forever helps no one.
      let result;
      try {
        result = await handleC2BConfirmation(tenant.id, request.body);
      } catch (err) {
        request.log.warn({ err, tenantSlug }, "C2B confirmation rejected");
        await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: err instanceof Error ? err.message : String(err) });
        reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
        return;
      }
      const { transaction, duplicate } = result;
      await finishWebhookEvent(eventId, {
        status: duplicate ? "DUPLICATE" : "PROCESSED",
        transactionReference: transaction.transactionId,
        response: { reconciled: transaction.reconciled },
      });

      if (!duplicate && transaction.reconciled && transaction.paymentId) {
        await notifyC2BPayment(tenant.id, transaction);
      }

      reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
    }
  );

  // --- The Suntech Payment Gateway's own paybill. Customers of every tenant on PLATFORM
  // collection pay here, with a payment reference (MH…) as the account number; the reference is
  // what decides which tenant the money belongs to. -----------------------------------------------

  app.post("/platform/c2b/validation", { config: { audience: "system-critical" } }, async (request, reply) => {
    if (!hasValidCallbackToken(request)) {
      reply.status(200).send({ ResultCode: "C2B00012", ResultDesc: "Rejected" });
      return;
    }
    // Accept everything: an unrecognised reference is still held (and assignable), never bounced
    // after the customer has typed their PIN.
    reply.status(200).send(handleC2BValidation(null, request.body));
  });

  app.post("/platform/c2b/confirmation", { config: { audience: "system-critical" } }, async (request, reply) => {
    const eventId = await logWebhookReceived({
      provider: "MPESA",
      eventType: "PLATFORM_C2B_CONFIRMATION",
      externalId: extractC2BTransId(request.body),
      payload: request.body,
      sourceIp: request.ip,
    });
    if (!hasValidCallbackToken(request)) {
      await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: "Missing or invalid callback token" });
      reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
      return;
    }
    try {
      const { transaction, duplicate } = await handlePlatformC2BConfirmation(request.body);
      await finishWebhookEvent(eventId, {
        status: duplicate ? "DUPLICATE" : "PROCESSED",
        tenantId: transaction.tenantId,
        transactionReference: transaction.transactionId,
        response: { reconciled: transaction.reconciled, assignedToTenant: Boolean(transaction.tenantId) },
      });
      if (!duplicate && transaction.tenantId && transaction.reconciled && transaction.paymentId) {
        await notifyC2BPayment(transaction.tenantId, transaction);
      }
      if (!duplicate && transaction.tenantId) settleAfterCollection(transaction.tenantId, request.log);
    } catch (err) {
      request.log.warn({ err }, "Platform C2B confirmation rejected");
      await finishWebhookEvent(eventId, { status: "REJECTED", errorMessage: err instanceof Error ? err.message : String(err) });
    }
    reply.status(200).send({ ResultCode: "0", ResultDesc: "Accepted" });
  });

  // --- Platform-level (super admin only) — the platform's OWN Daraja credentials, used to
  // collect the 450 KSH onboarding fee from tenants. Never confuse with the tenant-scoped
  // /config routes above, which are each ISP's own paybill for billing their own customers.

  app.get(
    "/platform-config",
    { config: { audience: "platform" }, preHandler: [...staffPreHandler, requirePermission("tenants.create")] },
    async (request, reply) => {
      const [config, b2b] = await Promise.all([getPlatformMpesaConfigStatus(), getPlatformB2BStatus()]);
      reply.send(successResponse({ ...config, b2b }, request.id));
    }
  );

  app.put(
    "/platform-config",
    { config: { audience: "platform" }, preHandler: [...staffPreHandler, requirePermission("tenants.create")] },
    async (request, reply) => {
      const body = platformConfigSchema.parse(request.body);
      await setPlatformMpesaConfig(body);

      await writeAuditLog({
        tenantId: null,
        actorUserId: request.user!.id,
        action: "platform_mpesa_config.updated",
        resourceType: "PlatformMpesaConfig",
        // The credential itself is never logged — only that payouts became possible and by whom.
        after: {
          shortcode: body.shortcode,
          environment: body.environment,
          b2bInitiatorSet: Boolean(body.initiatorName),
        },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      const [config, b2b] = await Promise.all([getPlatformMpesaConfigStatus(), getPlatformB2BStatus()]);
      reply.send(successResponse({ ...config, b2b }, request.id));
    }
  );

  // --- Public Buy Me a Coffee / Donation Routes ---

  /** Returns the donate M-Pesa gateway config (Paybill, account reference, enabled state) for
   *  the public donate page to display. No auth required — this is public info. */
  app.get(
    "/donate/config",
    { config: { audience: "customer" } },
    async (request, reply) => {
      const config = await getDonateConfig();
      reply.send(successResponse(config, request.id));
    }
  );

  /** The public supporters wall: the latest completed donations. Names and messages only for
   *  donors who ticked "show my name"; phone numbers never leave the server. */
  app.get(
    "/donate/supporters",
    { config: { audience: "customer" } },
    async (request, reply) => {
      const [recent, supporterCount] = await Promise.all([
        prisma.donation.findMany({
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 12,
          select: { id: true, amountMinor: true, donorName: true, donorMessage: true, showPublicly: true, createdAt: true },
        }),
        prisma.donation.count({ where: { status: "COMPLETED" } }),
      ]);
      reply.send(
        successResponse(
          {
            supporterCount,
            recent: recent.map((d) => ({
              id: d.id,
              amount: Math.round(d.amountMinor / 100),
              name: d.showPublicly ? d.donorName : null,
              message: d.showPublicly ? d.donorMessage : null,
              createdAt: d.createdAt,
            })),
          },
          request.id
        )
      );
    }
  );

  app.post(
    "/donate",
    {
      config: { audience: "customer" },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const donateBodySchema = z.object({
        phone: z.string().min(9),
        amount: z.number().int().positive(), // in KES
        name: z.string().max(100).optional(),
        message: z.string().max(280).optional(),
        /** The donor chose to show their name and message on the public supporters wall. */
        showPublicly: z.boolean().optional(),
      });
      const body = donateBodySchema.parse(request.body);
      const normalizedPhone = normalizeKenyanPhone(body.phone);
      const amountMinor = body.amount * 100;

      // Load config & credentials in parallel
      const [donateConfig, credentials] = await Promise.all([
        getDonateConfig(),
        getPlatformMpesaCredentials(),
      ]);
      const accountRef = donateConfig.accountReference;

      try {
        const callbackUrl = buildMpesaCallbackUrl();
        const response = await initiateStkPush({
          credentials,
          phone: normalizedPhone,
          amountMinor,
          accountReference: accountRef,
          transactionDesc: `Coffee from ${body.name || "Supporter"}`,
          callbackUrl,
        });

        // Persist donation record immediately so callback can find it
        const donationPromise = prisma.donation.create({
          data: {
            phone: normalizedPhone,
            amountMinor,
            donorName: body.name?.trim() || null,
            donorMessage: body.message?.trim() || null,
            showPublicly: body.showPublicly === true,
            merchantRequestId: response.MerchantRequestID,
            checkoutRequestId: response.CheckoutRequestID,
            status: "PENDING",
          },
        }).catch((err) => {
          request.log.error({ err }, "Failed to persist donation record");
        });

        reply.status(201).send(
          successResponse(
            {
              merchantRequestId: response.MerchantRequestID,
              checkoutRequestId: response.CheckoutRequestID,
              status: "PENDING",
              phone: normalizedPhone,
              amount: body.amount,
              paybill: donateConfig.paybill,
              account: accountRef,
            },
            request.id
          )
        );

        await donationPromise;
      } catch (err: any) {
        // Never report a prompt that was not sent: the donor would wait for a PIN request that
        // is never coming. Say so, and give the Paybill route when there is one.
        request.log.warn({ err: err?.message }, "Donation STK push could not be sent");
        throw new ConflictError(
          donateConfig.paybill
            ? `We couldn't send the M-Pesa prompt right now. You can still pay with Paybill ${donateConfig.paybill}, account ${accountRef}.`
            : "We couldn't send the M-Pesa prompt right now. Please try again in a minute."
        );
      }
    }
  );

  app.get(
    "/donate/:checkoutRequestId/status",
    {
      config: { audience: "customer" },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { checkoutRequestId } = request.params as { checkoutRequestId: string };
      const { verify } = (request.query || {}) as { verify?: string };
      const shouldVerify = verify === "true" || verify === "1";

      // Check the donations table first.
      const donation = await prisma.donation.findFirst({
        where: { checkoutRequestId },
      });

      if (donation) {
        if (donation.status === "COMPLETED") {
          reply.send(
            successResponse(
              {
                status: donation.status,
                receiptNumber: donation.mpesaReceiptNumber,
                resultDesc: donation.resultDesc,
              },
              request.id
            )
          );
          return;
        }

        // Only actively query Safaricom Daraja when explicitly requested (e.g. user clicks
        // "I Have Entered My PIN"), NOT on routine background interval polling.
        if (shouldVerify) {
          try {
            const credentials = await getPlatformMpesaCredentials();
            const queryRes = await queryStkPushStatus(credentials, checkoutRequestId);
            const resultCode = Number(queryRes.ResultCode);
            const resDesc = queryRes.ResultDesc || queryRes.ResponseDescription || "";

            if (resultCode === 0) {
              const provisionalReceipt = `DON-${checkoutRequestId.replace(/[^A-Za-z0-9]/g, "").slice(-12).toUpperCase()}`;
              const updated = await prisma.donation.update({
                where: { id: donation.id },
                data: {
                  status: "COMPLETED",
                  resultCode: 0,
                  resultDesc: resDesc || "The service request is processed successfully.",
                  mpesaReceiptNumber: donation.mpesaReceiptNumber || provisionalReceipt,
                },
              });
              reply.send(
                successResponse(
                  {
                    status: updated.status,
                    receiptNumber: updated.mpesaReceiptNumber,
                    resultDesc: updated.resultDesc,
                  },
                  request.id
                )
              );
              return;
            } else if (resultCode === 1032) {
              const updated = await prisma.donation.update({
                where: { id: donation.id },
                data: {
                  status: "CANCELLED",
                  resultCode: 1032,
                  resultDesc: resDesc || "Request Cancelled by user.",
                },
              });
              reply.send(
                successResponse(
                  { status: updated.status, resultDesc: updated.resultDesc },
                  request.id
                )
              );
              return;
            } else if (
              resDesc.toLowerCase().includes("being processed") ||
              resDesc.toLowerCase().includes("in progress") ||
              Number.isNaN(resultCode)
            ) {
              // Safaricom is still waiting for user handset PIN — remain PENDING, do NOT fail!
              reply.send(
                successResponse(
                  { status: "PENDING", resultDesc: "Transaction is being processed on your handset." },
                  request.id
                )
              );
              return;
            } else if (resultCode > 0) {
              const updated = await prisma.donation.update({
                where: { id: donation.id },
                data: {
                  status: "FAILED",
                  resultCode,
                  resultDesc: resDesc,
                },
              });
              reply.send(
                successResponse(
                  { status: updated.status, resultDesc: updated.resultDesc },
                  request.id
                )
              );
              return;
            }
          } catch {
            // Keep pending if query threw (e.g. handset prompt still open, Daraja processing in-flight)
          }
        }

        reply.send(
          successResponse(
            {
              status: donation.status,
              receiptNumber: donation.mpesaReceiptNumber,
              resultDesc: donation.resultDesc,
            },
            request.id
          )
        );
        return;
      }

      // Also check MpesaStkRequest for backwards compat (shouldn't normally match for donations).
      const stk = await prisma.mpesaStkRequest.findFirst({
        where: { checkoutRequestId },
      });
      if (stk) {
        reply.send(successResponse({ status: stk.status }, request.id));
        return;
      }

      reply.send(successResponse({ status: "PENDING" }, request.id));
    }
  );
}

