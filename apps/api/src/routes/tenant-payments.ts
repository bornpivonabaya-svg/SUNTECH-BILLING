import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  getTenantPaymentsOverview,
  listGatewayTransactions,
  getGatewayTransactionDetail,
  listSettlements,
  getSettlementDetail,
  requestSettlement,
  listTenantLedger,
  getTenantBalance,
  getActiveDestination,
  listDestinations,
  presentDestination,
  setActiveDestination,
  getSettlementSettings,
  getOrCreateCustomerReference,
  getOrCreateInvoiceReference,
} from "@mashupkgrid/payments";
import { successResponse, ConflictError, ForbiddenError, ValidationError } from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";

/**
 * Tenant Dashboard → Payments. The tenant is ALWAYS the one on the caller's own token — no route
 * here accepts a tenant id from the request — and every read below filters by it in the query
 * itself, so one tenant cannot see another's transactions, balance, settlements or destination
 * however the request is crafted.
 */

const base = [authenticate, resolveTenant, checkMaintenance] as const;

function tenantOf(request: FastifyRequest): string {
  const tenantId = request.user?.tenantId;
  if (!tenantId) throw new ForbiddenError("Payments are a tenant feature — sign in to an ISP account.");
  return tenantId;
}

const dateParam = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .transform((v) => new Date(v))
  .optional();
const idParams = z.object({ id: z.string().uuid() });

const destinationBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MPESA_PHONE"), accountName: z.string().trim().min(2).max(120), phone: z.string().trim().min(9).max(20) }),
  z.object({
    type: z.literal("BANK_ACCOUNT"),
    accountName: z.string().trim().min(2).max(120),
    bankName: z.string().trim().min(2).max(80),
    bankBranch: z.string().trim().max(80).optional(),
    bankAccountNumber: z.string().trim().min(6).max(30),
  }),
  z.object({ type: z.literal("TILL"), accountName: z.string().trim().min(2).max(120), tillNumber: z.string().trim().min(5).max(10) }),
  z.object({
    type: z.literal("PAYBILL"),
    accountName: z.string().trim().min(2).max(120),
    paybillNumber: z.string().trim().min(5).max(10),
    paybillAccountReference: z.string().trim().max(20).optional(),
  }),
]);

export async function tenantPaymentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/overview",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      reply.send(successResponse(await getTenantPaymentsOverview(tenantOf(request)), request.id));
    }
  );

  app.get(
    "/transactions",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const query = z
        .object({
          from: dateParam,
          to: dateParam,
          status: z.enum(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED", "REVERSED"]).optional(),
          settlementStatus: z.enum(["UNSETTLED", "SETTLEMENT_PENDING", "SETTLED"]).optional(),
          channel: z.enum(["MPESA_STK", "MPESA_C2B"]).optional(),
          search: z.string().max(64).optional(),
          customer: z.string().max(64).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
        })
        .parse(request.query);
      reply.send(successResponse(await listGatewayTransactions({ ...query, tenantId: tenantOf(request) }), request.id));
    }
  );

  app.get(
    "/transactions/:id",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      reply.send(successResponse(await getGatewayTransactionDetail(id, tenantOf(request)), request.id));
    }
  );

  app.get(
    "/ledger",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const { limit, cursor } = z
        .object({ limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().uuid().optional() })
        .parse(request.query);
      const [balance, entries] = await Promise.all([getTenantBalance(tenantId), listTenantLedger(tenantId, { limit, cursor })]);
      reply.send(successResponse({ balance, entries, nextCursor: entries.length === (limit ?? 100) ? entries.at(-1)?.id ?? null : null }, request.id));
    }
  );

  app.get(
    "/settlements",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const query = z
        .object({
          status: z.enum(["REQUESTED", "AWAITING_APPROVAL", "PROCESSING", "SETTLED", "FAILED", "CANCELLED"]).optional(),
          from: dateParam,
          to: dateParam,
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
        })
        .parse(request.query);
      reply.send(successResponse(await listSettlements({ ...query, tenantId: tenantOf(request) }), request.id));
    }
  );

  app.get(
    "/settlements/:id",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      reply.send(successResponse(await getSettlementDetail(id, tenantOf(request)), request.id));
    }
  );

  app.post(
    "/settlements",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("settlements.request")] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const settlement = await requestSettlement({
        tenantId,
        trigger: "TENANT_REQUEST",
        requestedByUserId: request.user!.id,
        enforceMinimum: true,
      });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "settlement.requested",
        resourceType: "Settlement",
        resourceId: settlement.id,
        after: { settlementNumber: settlement.settlementNumber, amountMinor: settlement.amountMinor, status: settlement.status },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.status(201).send(successResponse(settlement, request.id));
    }
  );

  app.get(
    "/destination",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const [active, history] = await Promise.all([getActiveDestination(tenantId), listDestinations(tenantId)]);
      reply.send(
        successResponse(
          { active: active ? presentDestination(active) : null, history: history.map(presentDestination) },
          request.id
        )
      );
    }
  );

  app.put(
    "/destination",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("settlement_destinations.manage")] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const body = destinationBody.parse(request.body);
      const { before, after } = await setActiveDestination(tenantId, body, request.user!.id);
      // Where a business's money goes is exactly the change worth being able to prove.
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "settlement_destination.changed",
        resourceType: "SettlementDestination",
        resourceId: after.id,
        before: before ? presentDestination(before) : null,
        after: presentDestination(after),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse(presentDestination(after), request.id));
    }
  );

  /**
   * Connect this ISP to the Suntech gateway. Deliberately one-way from the tenant side:
   * disconnecting while the platform may still owe them money, or while payments are in flight,
   * is a platform decision (Super Admin → Payments → Tenants).
   */
  app.post(
    "/gateway/connect",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("settlement_destinations.manage")] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const settings = await getSettlementSettings();
      if (!settings.gatewayEnabled) throw new ConflictError("The Suntech payment gateway is not accepting new ISPs right now.");
      const destination = await getActiveDestination(tenantId);
      if (!destination) throw new ValidationError("Add a settlement destination first, so we know where to send your money.");
      const before = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { collectionMode: true } });
      if (before.collectionMode === "PLATFORM") throw new ConflictError("Already connected to the Suntech gateway.");
      const after = await prisma.tenant.update({ where: { id: tenantId }, data: { collectionMode: "PLATFORM" }, select: { collectionMode: true } });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.gateway_connected",
        resourceType: "Tenant",
        resourceId: tenantId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse(after, request.id));
    }
  );

  /** A customer's standing paybill account number, or an invoice's pay link. Both are created on
   *  first request and stable afterwards. */
  app.get(
    "/references/customers/:id",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const reference = await getOrCreateCustomerReference(tenantOf(request), id);
      reply.send(successResponse({ reference: reference.reference, payUrl: `${env.APP_WEB_URL.replace(/\/+$/, "")}/pay/${reference.reference}` }, request.id));
    }
  );

  app.get(
    "/references/invoices/:id",
    { config: { audience: "staff" }, preHandler: [...base, requirePermission("payments.read")] },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const reference = await getOrCreateInvoiceReference(tenantOf(request), id);
      reply.send(successResponse({ reference: reference.reference, payUrl: `${env.APP_WEB_URL.replace(/\/+$/, "")}/pay/${reference.reference}` }, request.id));
    }
  );
}
