import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import { env } from "@mashupkgrid/config";
import { successResponse, ConflictError, NotFoundError, TENANT_FEATURES } from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { ensureDefaultPlans } from "../lib/default-plans.js";
import { writeAuditLog } from "../lib/audit.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

const planSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
  monthlyPriceMinor: z.number().int().nonnegative(),
  annualPriceMinor: z.number().int().nonnegative().nullable().optional(),
  trialDays: z.number().int().min(0).default(7),
  maxCustomers: z.number().int().positive().nullable().optional(),
  maxRouters: z.number().int().positive().nullable().optional(),
  features: z.array(z.enum(TENANT_FEATURES)).default([]),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const updatePlanSchema = planSchema.partial().omit({ slug: true });

const idParamsSchema = z.object({ planId: z.string().uuid() });

/** Un-sets any other default plan first, in a transaction — mirrors Domain.isPrimary's pattern
 *  (Phase 2) so tenant creation's `findFirst({ isDefault: true })` fallback never sees more than
 *  one candidate. */
async function setAsDefaultPlan(planId: string): Promise<void> {
  await prisma.$transaction([
    prisma.tenantPlan.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.tenantPlan.update({ where: { id: planId }, data: { isDefault: true } }),
  ]);
}

export async function planRoutes(app: FastifyInstance): Promise<void> {
  /** Broad read, narrow write — both super admins (managing the catalog) and tenant staff
   *  (choosing an upgrade on the billing page) need to see active plans, matching the existing
   *  packages.read-style convention of "anyone authenticated can browse the catalog." */
  app.get(
    "/",
    { config: { audience: "staff" }, preHandler: [...preHandler] },
    async (request, reply) => {
      // A new platform starts with the default plans rather than an empty list.
      await ensureDefaultPlans().catch(() => 0);
      const plans = await prisma.tenantPlan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      });
      reply.send(successResponse(plans, request.id));
    }
  );

  app.post(
    "/",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("plans.manage")] },
    async (request, reply) => {
      const body = planSchema.parse(request.body);
      const existing = await prisma.tenantPlan.findUnique({ where: { slug: body.slug } });
      if (existing) throw new ConflictError(`A plan with slug "${body.slug}" already exists`);

      const plan = await prisma.tenantPlan.create({ data: body });
      if (body.isDefault) await setAsDefaultPlan(plan.id);

      await writeAuditLog({
        actorUserId: request.user!.id,
        action: "plan.created",
        resourceType: "TenantPlan",
        resourceId: plan.id,
        after: plan,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(successResponse(plan, request.id));
    }
  );

  app.patch(
    "/:planId",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("plans.manage")] },
    async (request, reply) => {
      const { planId } = idParamsSchema.parse(request.params);
      const { isDefault, ...body } = updatePlanSchema.parse(request.body);
      const before = await prisma.tenantPlan.findUnique({ where: { id: planId } });
      if (!before) throw new NotFoundError("Plan");

      const after = await prisma.tenantPlan.update({ where: { id: planId }, data: body });
      if (isDefault) await setAsDefaultPlan(planId);

      await writeAuditLog({
        actorUserId: request.user!.id,
        action: "plan.updated",
        resourceType: "TenantPlan",
        resourceId: planId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(after, request.id));
    }
  );

  /** Soft delete (isActive: false) — never hard-deletes, since existing TenantSubscription rows
   *  reference a plan via a required FK; a deactivated plan simply stops appearing in GET / and
   *  can no longer be newly assigned. */
  app.delete(
    "/:planId",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("plans.manage")] },
    async (request, reply) => {
      const { planId } = idParamsSchema.parse(request.params);
      const before = await prisma.tenantPlan.findUnique({ where: { id: planId } });
      if (!before) throw new NotFoundError("Plan");
      if (before.isDefault) {
        throw new ConflictError("Cannot deactivate the default plan — set a different plan as default first");
      }

      const after = await prisma.tenantPlan.update({ where: { id: planId }, data: { isActive: false } });

      await writeAuditLog({
        actorUserId: request.user!.id,
        action: "plan.deactivated",
        resourceType: "TenantPlan",
        resourceId: planId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(after, request.id));
    }
  );
}

/** The active plans for the public pricing section on the landing page: names, prices, limits
 *  and trial length only. The same catalogue ISPs subscribe to, so the website never shows a
 *  price the platform doesn't charge. */
export async function publicPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { config: { audience: "public" } }, async (request, reply) => {
    await ensureDefaultPlans().catch(() => 0);
    const plans = await prisma.tenantPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { monthlyPriceMinor: "asc" }],
      select: { id: true, name: true, description: true, monthlyPriceMinor: true, annualPriceMinor: true, trialDays: true, maxCustomers: true, maxRouters: true, isDefault: true },
    });
    reply.header("Cache-Control", "public, max-age=60").send(successResponse(plans, request.id));
  });
}

/** Public settings the website needs at run time rather than build time: the captive portal's
 *  address (APP_PORTAL_URL), shown to ISPs as their customers' sign-in link. */
export async function publicConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { config: { audience: "public" } }, async (request, reply) => {
    const portalUrl = ((env as { APP_PORTAL_URL?: string }).APP_PORTAL_URL || env.APP_WEB_URL || "").replace(/\/+$/, "");
    reply.header("Cache-Control", "public, max-age=300").send(successResponse({ portalUrl }, request.id));
  });
}
