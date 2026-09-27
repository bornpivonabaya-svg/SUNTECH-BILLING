import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  initiateSubscriptionChargeStkPush,
  getTenantSubscriptionPayments,
  assertNoUnpaidSubscriptionCharge,
} from "@mashupkgrid/payments";
import { successResponse, ConflictError, NotFoundError } from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance, requirePermission("settings.manage")];

const renewSchema = z.object({ phone: z.string().min(9) });
const choosePlanSchema = z.object({ planId: z.string().uuid(), billingCycle: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY") });

/** Plans an ISP can pick for itself: active ones, in the platform's order. */
function listPlans() {
  return prisma.tenantPlan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { monthlyPriceMinor: "asc" }],
    select: { id: true, name: true, description: true, monthlyPriceMinor: true, annualPriceMinor: true, maxCustomers: true, maxRouters: true, features: true },
  });
}

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("Subscription billing is not available at the platform level");
  return tenantId;
}

/** Tenant-facing "My Subscription" routes — self-service, one level below the super-admin
 *  /platform/plans catalog and /platform/tenants/:id/subscription assignment. Registered at
 *  /api/v1/billing, deliberately not /api/v1/subscriptions (already the ISP's own
 *  customer-subscription routes — see the multi-tenant-domains plan's naming-collision note). */
export async function tenantBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);

    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });

    const [customerCount, routerCount, payments, plans] = await Promise.all([
      prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      prisma.router.count({ where: { tenantId, deletedAt: null } }),
      getTenantSubscriptionPayments(tenantId),
      listPlans(),
    ]);

    reply.send(
      successResponse(
        {
          // Null for an ISP that signed up on a trial and hasn't picked a plan yet: the page then
          // shows `plans` to choose from instead of an error with nothing to pay for.
          subscription,
          usage: {
            customers: { used: customerCount, limit: subscription?.plan.maxCustomers ?? null },
            routers: { used: routerCount, limit: subscription?.plan.maxRouters ?? null },
          },
          payments,
          plans,
        },
        request.id
      )
    );
  });

  /** Picks (or changes) the plan to pay for. Only while nothing is paid up: an ACTIVE plan is
   *  changed by the platform, so a paid period is never silently swapped. The new plan starts
   *  unpaid (EXPIRED, period ending now); /renew then charges it and the M-Pesa callback makes
   *  it ACTIVE. A running trial keeps its status and end date. */
  app.post("/choose-plan", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { planId, billingCycle } = choosePlanSchema.parse(request.body);
    const plan = await prisma.tenantPlan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw new NotFoundError("Plan");
    const existing = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (existing?.status === "ACTIVE") {
      throw new ConflictError("Your plan is paid up. To change it, contact support and it will be switched at your next renewal.");
    }
    await assertNoUnpaidSubscriptionCharge(tenantId);

    const now = new Date();
    const subscription = existing
      ? await prisma.tenantSubscription.update({
          where: { tenantId },
          data: { planId, billingCycle, ...(existing.status === "TRIALING" && existing.currentPeriodEnd > now ? {} : { status: "EXPIRED", currentPeriodStart: now, currentPeriodEnd: now }) },
          include: { plan: true },
        })
      : await prisma.tenantSubscription.create({
          data: { tenantId, planId, billingCycle, status: "EXPIRED", currentPeriodStart: now, currentPeriodEnd: now },
          include: { plan: true },
        });

    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "subscription.plan_chosen",
      resourceType: "TenantSubscription",
      resourceId: subscription.id,
      before: existing ? { planId: existing.planId, billingCycle: existing.billingCycle, status: existing.status } : undefined,
      after: { planId, billingCycle, status: subscription.status },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    reply.send(successResponse(subscription, request.id));
  });

  app.post("/renew", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { phone } = renewSchema.parse(request.body);

    await assertNoUnpaidSubscriptionCharge(tenantId);
    const payment = await initiateSubscriptionChargeStkPush(tenantId, phone);

    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "subscription.renewal_charged",
      resourceType: "TenantSubscriptionPayment",
      resourceId: payment.id,
      after: { checkoutRequestId: payment.checkoutRequestId, amountMinor: payment.amountMinor },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    reply.status(201).send(successResponse(payment, request.id));
  });
}
