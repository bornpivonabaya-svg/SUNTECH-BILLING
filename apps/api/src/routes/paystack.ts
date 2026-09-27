import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  setPaystackConfig,
  getPaystackConfigStatus,
  initiatePaystackTransactionForCustomer,
  getPaystackTransactionOrThrow,
  verifyAndReconcilePaystackTransaction,
  isValidPaystackSignature,
  getPaystackCredentials,
  handlePaystackWebhook,
} from "@mashupkgrid/payments";
import { successResponse, ConflictError } from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";
import { enqueueSendPaymentConfirmationEmail, enqueueSendWhatsappVoucher } from "../lib/queue.js";
import { emailHotspotVoucherOnce } from "../lib/hotspot-voucher-email.js";
import { emitWebhookEvent } from "../lib/webhooks.js";

const staffPreHandler = [authenticate, resolveTenant, checkMaintenance] as const;

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("Paystack is not available at the platform level");
  return tenantId;
}

const setConfigSchema = z.object({
  secretKey: z.string().min(1),
  publicKey: z.string().optional(),
});

const initializeSchema = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).optional(),
});

export async function paystackRoutes(app: FastifyInstance): Promise<void> {
  // --- Staff-facing, authenticated ---------------------------------------------------------

  app.get(
    "/config",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("settings.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      reply.send(successResponse(await getPaystackConfigStatus(tenantId), request.id));
    }
  );

  app.put(
    "/config",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("settings.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = setConfigSchema.parse(request.body);
      await setPaystackConfig(tenantId, body);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "paystack_config.updated",
        resourceType: "PaymentProviderConfig",
        after: { publicKey: body.publicKey ?? null },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(await getPaystackConfigStatus(tenantId), request.id));
    }
  );

  app.post(
    "/initialize",
    {
      config: { audience: "staff", maintenanceCategory: "payment" },
      preHandler: [...staffPreHandler, requirePermission("payments.create")],
    },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = initializeSchema.parse(request.body);

      const result = await initiatePaystackTransactionForCustomer(tenantId, {
        customerId: body.customerId,
        invoiceId: body.invoiceId ?? null,
        amountMinor: body.amountMinor,
        currency: body.currency,
        initiatedByUserId: request.user!.id,
      });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "paystack.transaction_initiated",
        resourceType: "PaystackTransaction",
        resourceId: result.transaction.id,
        after: { customerId: body.customerId, invoiceId: body.invoiceId, amountMinor: body.amountMinor },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(successResponse(result, request.id));
    }
  );

  app.get(
    "/transactions/:reference",
    { config: { audience: "staff" }, preHandler: [...staffPreHandler, requirePermission("payments.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { reference } = z.object({ reference: z.string() }).parse(request.params);

      const current = await getPaystackTransactionOrThrow(tenantId, reference);
      if (current.status !== "PENDING") {
        reply.send(successResponse(current, request.id));
        return;
      }

      // Still pending from our side — actively verify with Paystack rather than making the
      // client poll forever against stale local state (defensive against a lost webhook).
      const refreshed = await verifyAndReconcilePaystackTransaction(tenantId, reference);
      reply.send(successResponse(refreshed, request.id));
    }
  );

  // --- Public webhook (Paystack) — audience "system-critical" bypasses maintenance mode
  // entirely, same reasoning as the M-Pesa callback: dropping a webhook for an already-completed
  // transaction is a data-loss risk. Unlike M-Pesa, Paystack signs every webhook, so this one
  // *does* carry verification — a request without a valid signature is rejected outright. ------

  app.post("/webhook", { config: { audience: "system-critical" } }, async (request, reply) => {
    const payload = request.body as { event?: string; data?: { reference?: string } } | undefined;
    const reference = payload?.data?.reference;

    // We need the tenant to look up which secret key signed this — resolve it from the
    // transaction row itself (created with a globally-unique reference) before verifying,
    // exactly the same "look up first, verify second" order the M-Pesa callback uses implicitly
    // by trusting Safaricom's IP allowlist instead of a signature.
    const transaction = reference ? await prisma.paystackTransaction.findUnique({ where: { reference } }) : null;
    if (!transaction) {
      // Unrecognized reference — ack anyway so Paystack doesn't retry forever, but do nothing.
      reply.status(200).send({ received: true });
      return;
    }

    const credentials = await getPaystackCredentials(transaction.tenantId);
    const signature = request.headers["x-paystack-signature"] as string | undefined;
    if (!request.rawBody || !isValidPaystackSignature(request.rawBody, signature, credentials.secretKey)) {
      reply.status(401).send({ received: false, error: "Invalid signature" });
      return;
    }

    const outcome = await handlePaystackWebhook(transaction.tenantId, payload as never);
    if (outcome.handled && outcome.reference) {
      const completed = await prisma.paystackTransaction.findUnique({
        where: { reference: outcome.reference },
        include: { customer: true, hotspotPackage: true, tenant: true },
      });
      if (completed?.status === "COMPLETED") {
        if (completed.customer?.email) {
          await enqueueSendPaymentConfirmationEmail({
            email: completed.customer.email,
            customerName: completed.customer.fullName,
            amountMinor: completed.amountMinor,
            receiptNumber: completed.reference,
            tenantId: completed.tenantId ?? undefined,
          });
        }
        // Same anonymous-walk-in case as the M-Pesa callback: no Customer row, so the phone given
        // at checkout is the only way to reach the buyer with what they paid for.
        if (completed.hotspotVoucherCode && completed.hotspotPhone) {
          await enqueueSendWhatsappVoucher({
            tenantId: completed.tenantId,
            phone: completed.hotspotPhone,
            voucherCode: completed.hotspotVoucherCode,
            tenantName: completed.tenant.name,
            packageName: completed.hotspotPackage?.name ?? null,
            amountMinor: completed.amountMinor,
            currency: completed.currency,
            durationMinutes: completed.hotspotPackage?.durationMinutes ?? null,
            dataCapMb: completed.hotspotPackage?.dataCapMb ?? null,
          });
        }
        await emailHotspotVoucherOnce(completed.tenantId, completed.hotspotEmail, completed.hotspotVoucherCode);
        if (completed.customerId) {
          void emitWebhookEvent(completed.tenantId, "payment.received", {
            method: "PAYSTACK",
            amountMinor: completed.amountMinor,
            receiptNumber: completed.reference,
            customerId: completed.customerId,
          });
        }
      }
    }

    reply.status(200).send({ received: true });
  });

  // --- Public return URL — where the customer's browser lands after paying on Paystack's
  // checkout page. Carries no signature (it's a plain browser redirect, not a server-to-server
  // call), so it's a UX hint to verify, never a payment confirmation on its own — the actual
  // reconciliation is the same verifyAndReconcilePaystackTransaction the webhook uses. ---------

  app.get("/return", { config: { audience: "customer" } }, async (request, reply) => {
    const { reference, trxref } = z
      .object({ reference: z.string().optional(), trxref: z.string().optional() })
      .parse(request.query);
    const ref = reference ?? trxref;
    if (!ref) {
      reply.redirect(`${env.APP_WEB_URL}/login`);
      return;
    }

    const transaction = await prisma.paystackTransaction.findUnique({
      where: { reference: ref },
      include: { tenant: true },
    });
    if (!transaction) {
      reply.redirect(`${env.APP_WEB_URL}/login`);
      return;
    }

    await verifyAndReconcilePaystackTransaction(transaction.tenantId, ref);

    let destination = `${env.APP_WEB_URL}/dashboard`;
    let extraParams = "";
    if (transaction.hotspotPackageId && transaction.tenant?.slug) {
      destination = `${env.APP_WEB_URL}/hotspot/${transaction.tenant.slug}`;
      // Without this, the browser lands back on the captive portal with no memory of the
      // router's link-login-only URL (Paystack's checkout wiped the original query string) —
      // the page would show "here's your voucher" instead of actually connecting the customer.
      if (transaction.hotspotLinkLoginOnly) {
        extraParams = `&link-login-only=${encodeURIComponent(transaction.hotspotLinkLoginOnly)}`;
      }
    } else if (transaction.invoiceId) {
      destination = `${env.APP_WEB_URL}/invoices/${transaction.invoiceId}`;
    } else if (transaction.customerId) {
      destination = `${env.APP_WEB_URL}/customers/${transaction.customerId}`;
    }
    reply.redirect(`${destination}?paystack=${encodeURIComponent(ref)}${extraParams}`);
  });
}
