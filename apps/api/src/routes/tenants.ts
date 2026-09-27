import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Tenant } from "@mashupkgrid/database";
import { initiateOnboardingFeeStkPush, getOnboardingFeeStatus } from "@mashupkgrid/payments";
import { env } from "@mashupkgrid/config";
import {
  successResponse,
  NotFoundError,
  ConflictError,
  paginationQuerySchema,
  paginate,
  toSkipTake,
  buildSafeOrderBy,
  buildKeywordSearchWhere,
  TENANT_FEATURES,
  isReservedSubdomain,
  hashPassword,
  type TenantOnboardingStage,
} from "@mashupkgrid/shared";
import { getActiveDestination, setActiveDestination, presentDestination } from "@mashupkgrid/payments";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";
import { enqueueSendWhatsappTenantWelcome, enqueueSendTenantWelcomeEmail } from "../lib/queue.js";
import { normalizePhoneForOtp } from "../lib/whatsapp-otp.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

/** A tenant's slug already IS its automatic platform subdomain — no separate column, see the
 *  multi-tenant-domains plan. This just computes the display URL from it; actually making
 *  `{slug}.{PLATFORM_BASE_DOMAIN}` resolve to the tenant's dashboard is a separate,
 *  not-yet-built hostname-routing layer. */
function platformUrlFor(slug: string): string {
  return `https://${slug}.${env.PLATFORM_BASE_DOMAIN}`;
}

function withPlatformUrl<T extends Tenant>(tenant: T): T & { platformUrl: string } {
  return { ...tenant, platformUrl: platformUrlFor(tenant.slug) };
}

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  timezone: z.string().default("Africa/Nairobi"),
  currency: z.string().default("KES"),
  planTier: z.string().default("standard"),
  /** Which TenantPlan to start the tenant's trial on — defaults to the platform's default plan
   *  when omitted. Drives trialEndsAt (plan.trialDays) instead of a hardcoded constant. */
  planId: z.string().uuid().optional(),
  /** Only used to kick off the onboarding-fee STK push right away — never stored on the tenant
   *  itself (a tenant's real billing contact is whichever staff account signs in first). */
  ownerPhone: z.string().min(8).optional(),
  ownerName: z.string().min(2).optional(),
  ownerEmail: z.string().email().optional(),
  ownerPassword: z.string().min(8).optional(),
});

const settlementSchema = z.object({
  /** OWN keeps a tenant collecting on their own M-Pesa account; PLATFORM routes their customers'
   *  payments into this platform's paybill and creates a balance owed to them. */
  collectionMode: z.enum(["OWN", "PLATFORM"]).optional(),
  payoutShortcode: z.string().max(20).optional().or(z.literal("")),
  payoutShortcodeType: z.enum(["PAYBILL", "TILL"]).optional(),
});

const updateTenantSchema = createTenantSchema.partial().omit({ slug: true, ownerPhone: true }).extend({
  disabledFeatures: z.array(z.enum(TENANT_FEATURES)).optional(),
  // ISO datetime string, or null to clear the trial entirely (treat as never having had one) —
  // lets a super admin extend a trial ("+3 more days") or mark a tenant as paid/exempt.
  trialEndsAt: z.string().datetime().nullable().optional(),
});

const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "CANCELLED", "PENDING_APPROVAL"]).optional(),
});

const idParamsSchema = z.object({ tenantId: z.string().uuid() });

const SORTABLE_FIELDS = ["name", "slug", "createdAt", "status"] as const;
const SEARCHABLE_FIELDS = ["name", "slug"];

/**
 * Tells the ISP's owner about an approval decision on every channel they gave us: email always
 * (it is the username), WhatsApp when they registered a phone. The owner is the earliest user of
 * the tenant, which is the account registration created. Best-effort: the decision is already
 * committed, so a queue hiccup is logged, not thrown.
 */
async function notifyTenantOwner(
  tenant: Tenant,
  stage: TenantOnboardingStage,
  reason?: string
): Promise<{ email: boolean; whatsapp: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, phone: true },
  });
  if (!owner) return { email: false, whatsapp: false };

  const dashboardUrl = `https://${tenant.slug}.${env.PLATFORM_BASE_DOMAIN}/login`;
  const portalUrl = `${env.APP_WEB_URL}/hotspot/${tenant.slug}`;
  const ownerName = owner.name?.split(" ")[0] || owner.email.split("@")[0] || "there";
  const notified = { email: false, whatsapp: false };

  try {
    await enqueueSendTenantWelcomeEmail({
      email: owner.email,
      ownerName,
      companyName: tenant.name,
      subdomain: tenant.slug,
      dashboardUrl,
      portalUrl,
      stage,
      reason,
    });
    notified.email = true;
  } catch (err) {
    console.error(`[tenants] could not enqueue ${stage} email for tenant ${tenant.id}`, err);
  }

  if (owner.phone) {
    try {
      await enqueueSendWhatsappTenantWelcome({
        tenantId: null,
        phone: owner.phone,
        ownerName,
        companyName: tenant.name,
        username: owner.email,
        dashboardUrl,
        portalUrl,
        stage,
        reason,
      });
      notified.whatsapp = true;
    } catch (err) {
      console.error(`[tenants] could not enqueue ${stage} WhatsApp for tenant ${tenant.id}`, err);
    }
  }
  return notified;
}

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
/**
 * Per-tenant usage for the platform tenant list.
 *
 * The list previously showed only administrative state — plan, status, trial dates — which
 * cannot answer the question a platform operator actually has: is this tenant LIVE? A tenant who
 * signed up, never linked a router and has taken no money looks identical to a thriving one, and
 * a trial ending in two days is worth a call only if there is a real network behind it.
 *
 * Three grouped queries scoped to the page's tenant ids, not one query per tenant: the aggregate
 * cost stays flat whether the page shows 10 tenants or 100.
 */
async function loadTenantUsage(tenantIds: string[]): Promise<Map<string, TenantUsage>> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [routers, customers, revenue] = await Promise.all([
    prisma.router.findMany({
      where: { tenantId: { in: tenantIds }, deletedAt: null },
      select: { tenantId: true, status: true, lastSeenAt: true },
    }),
    prisma.customer.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds } },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["tenantId"],
      where: { tenantId: { in: tenantIds }, status: "COMPLETED", createdAt: { gte: since } },
      _sum: { amountMinor: true },
    }),
  ]);

  const usage = new Map<string, TenantUsage>();
  const blank = (): TenantUsage => ({
    routerCount: 0,
    routersOnline: 0,
    customerCount: 0,
    revenue30dMinor: 0,
  });

  for (const id of tenantIds) usage.set(id, blank());
  const nowMs = Date.now();
  for (const row of routers) {
    const entry = usage.get(row.tenantId)!;
    entry.routerCount += 1;
    const isReallyOnline =
      row.status === "ONLINE" &&
      row.lastSeenAt !== null &&
      nowMs - new Date(row.lastSeenAt).getTime() <= 150_000;
    if (isReallyOnline) entry.routersOnline += 1;
  }
  for (const row of customers) usage.get(row.tenantId)!.customerCount = row._count._all;
  for (const row of revenue) usage.get(row.tenantId)!.revenue30dMinor = row._sum.amountMinor ?? 0;

  return usage;
}

interface TenantOwner {
  name: string | null;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  lastLoginAt: Date | null;
}

/** Each tenant's owner: its earliest user, the account sign-up created (same rule as
 *  notifyTenantOwner). One query for the whole page. */
async function loadTenantOwners(tenantIds: string[]): Promise<Map<string, TenantOwner>> {
  const users = await prisma.user.findMany({
    where: { tenantId: { in: tenantIds }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    distinct: ["tenantId"],
    select: { tenantId: true, name: true, email: true, phone: true, emailVerifiedAt: true, lastLoginAt: true },
  });
  return new Map(
    users.map((u) => [u.tenantId!, { name: u.name, email: u.email, phone: u.phone || null, emailVerified: Boolean(u.emailVerifiedAt), lastLoginAt: u.lastLoginAt }])
  );
}

interface TenantUsage {
  routerCount: number;
  routersOnline: number;
  customerCount: number;
  revenue30dMinor: number;
}

  app.get(
    "/",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.read")] },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const keyword = buildKeywordSearchWhere(query.search, SEARCHABLE_FIELDS) as { OR: object[] } | undefined;
      const where = {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        // Also finds a tenant by its owner's name, email or phone — what support usually has.
        ...(keyword && query.search
          ? {
              OR: [
                ...keyword.OR,
                { users: { some: { deletedAt: null, OR: (["name", "email", "phone"] as const).map((f) => ({ [f]: { contains: query.search, mode: "insensitive" as const } })) } } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.tenant.findMany({
          where,
          ...toSkipTake(query),
          orderBy: buildSafeOrderBy(query.sortBy, query.sortOrder, SORTABLE_FIELDS, "createdAt"),
          include: { subscription: { include: { plan: true } } },
        }),
        prisma.tenant.count({ where }),
      ]);

      const ids = items.map((tenant) => tenant.id);
      const [usage, owners] = await Promise.all([loadTenantUsage(ids), loadTenantOwners(ids)]);
      // platformBaseDomain rides along here (not a separate request) so the "Provision New
      // Tenant" form's live URL preview can show the real configured domain instead of a
      // hardcoded guess — this list is already fetched on page load regardless.
      reply.send(
        successResponse(
          {
            ...paginate(
              items.map((tenant) => ({ ...withPlatformUrl(tenant), usage: usage.get(tenant.id)!, owner: owners.get(tenant.id) ?? null })),
              total,
              query
            ),
            platformBaseDomain: env.PLATFORM_BASE_DOMAIN,
          },
          request.id
        )
      );
    }
  );

  app.post(
    "/",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.create")] },
    async (request, reply) => {
      const {
        ownerPhone,
        ownerName,
        ownerEmail,
        ownerPassword,
        planId: requestedPlanId,
        ...tenantFields
      } = createTenantSchema.parse(request.body);

      const cleanSlug = tenantFields.slug.trim().toLowerCase();
      if (isReservedSubdomain(cleanSlug)) {
        throw new ConflictError(`"${cleanSlug}" is a reserved subdomain — choose a different tenant slug`);
      }

      const existingTenant = await prisma.tenant.findUnique({ where: { slug: cleanSlug } });
      if (existingTenant) {
        throw new ConflictError(`The address "${cleanSlug}" is already taken. Please pick another name.`);
      }

      const cleanEmail = ownerEmail ? ownerEmail.trim().toLowerCase() : undefined;
      if (cleanEmail) {
        const existingUser = await prisma.user.findFirst({ where: { email: cleanEmail } });
        if (existingUser) {
          throw new ConflictError(`An account with email "${cleanEmail}" already exists in the system.`);
        }
      }

      const plan = requestedPlanId
        ? await prisma.tenantPlan.findUnique({ where: { id: requestedPlanId } })
        : await prisma.tenantPlan.findFirst({ where: { isDefault: true, isActive: true } });
      if (!plan) {
        throw new ConflictError(
          requestedPlanId ? "The requested plan does not exist" : "No default plan is configured — create one first"
        );
      }

      const trialEndsAt = new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000);
      const tenant = await prisma.tenant.create({
        data: {
          ...tenantFields,
          slug: cleanSlug,
          collectionMode: "PLATFORM",
          trialEndsAt,
          subscription: {
            create: { planId: plan.id, status: "TRIALING", currentPeriodEnd: trialEndsAt },
          },
        },
      });

      let createdUser = null;
      let temporaryPassword = null;
      const normalizedPhone = ownerPhone ? normalizePhoneForOtp(ownerPhone) : undefined;

      if (cleanEmail) {
        // Generate or use provided password
        temporaryPassword = ownerPassword?.trim() || `ISP-${Math.random().toString(36).slice(2, 6).toUpperCase()}!${Math.floor(1000 + Math.random() * 9000)}`;
        const passwordHash = await hashPassword(temporaryPassword);

        createdUser = await prisma.user.create({
          data: {
            tenantId: tenant.id,
            name: ownerName?.trim() || null,
            email: cleanEmail,
            phone: normalizedPhone || "",
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        });

        const ownerRole =
          (await prisma.role.findFirst({ where: { name: "ISP_OWNER", tenantId: null } })) ??
          (await prisma.role.findFirst({ where: { name: "OWNER", tenantId: null } })) ??
          (await prisma.role.findFirst({ where: { isSystem: true, tenantId: null } }));

        if (ownerRole) {
          await prisma.userRole.upsert({
            where: { userId_roleId_tenantId: { userId: createdUser.id, roleId: ownerRole.id, tenantId: tenant.id } },
            update: {},
            create: { userId: createdUser.id, roleId: ownerRole.id, tenantId: tenant.id },
          });
        }

        const dashboardUrl = `https://${cleanSlug}.${env.PLATFORM_BASE_DOMAIN}/login`;
        const portalUrl = `${env.APP_WEB_URL}/hotspot/${cleanSlug}`;

        // Send Welcome via WhatsApp if phone is available
        if (normalizedPhone) {
          await enqueueSendWhatsappTenantWelcome({
            tenantId: null,
            phone: normalizedPhone,
            ownerName: ownerName?.trim() || tenant.name,
            companyName: tenant.name,
            username: cleanEmail,
            dashboardUrl,
            portalUrl,
          }).catch((err) => request.log.warn({ err, tenantId: tenant.id }, "Failed to enqueue welcome WhatsApp"));
        }

        // Send Welcome Email containing subdomain, credentials, and dashboard links
        await enqueueSendTenantWelcomeEmail({
          email: cleanEmail,
          ownerName: ownerName?.trim() || tenant.name,
          companyName: tenant.name,
          subdomain: cleanSlug,
          dashboardUrl,
          portalUrl,
          temporaryPassword,
        }).catch((err) => request.log.warn({ err, tenantId: tenant.id }, "Failed to enqueue welcome Email"));
      }

      // Best-effort onboarding STK push
      if (normalizedPhone) {
        try {
          await initiateOnboardingFeeStkPush(tenant.id, normalizedPhone);
        } catch (err) {
          request.log.warn({ err, tenantId: tenant.id }, "Onboarding-fee STK push failed at tenant creation");
        }
      }

      await writeAuditLog({
        tenantId: tenant.id,
        actorUserId: request.user!.id,
        action: "tenant.created",
        resourceType: "Tenant",
        resourceId: tenant.id,
        after: tenant,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(
        successResponse(
          {
            ...withPlatformUrl(tenant),
            owner: createdUser
              ? {
                  id: createdUser.id,
                  email: createdUser.email,
                  name: ownerName?.trim() || tenant.name,
                  phone: normalizedPhone,
                  temporaryPassword,
                }
              : null,
            subdomainUrl: `https://${cleanSlug}.${env.PLATFORM_BASE_DOMAIN}`,
            dashboardLoginUrl: `https://${cleanSlug}.${env.PLATFORM_BASE_DOMAIN}/login`,
          },
          request.id
        )
      );
    }
  );

  app.get(
    "/:tenantId",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.read")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { subscription: { include: { plan: true } } },
      });
      if (!tenant || tenant.deletedAt) throw new NotFoundError("Tenant");
      reply.send(successResponse(withPlatformUrl(tenant), request.id));
    }
  );

  /**
   * Where a tenant's customer money goes, and where their settlement is sent.
   *
   * Separate from the general tenant PATCH on purpose: this decides whose bank account the
   * public's payments land in, and it is audit-logged with before/after so a change of
   * collection mode is always attributable to a person.
   */
  app.patch(
    "/:tenantId/settlement",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const body = settlementSchema.parse(request.body);

      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");

      // A paybill/till entered here becomes the tenant's active settlement destination — the
      // record the settlement system actually pays to (packages/payments destination.service).
      const shortcode = body.payoutShortcode?.trim();
      const destinationBefore = await getActiveDestination(tenantId);
      if (shortcode) {
        const type = (body.payoutShortcodeType ?? before.payoutShortcodeType) === "TILL" ? "TILL" : "PAYBILL";
        await setActiveDestination(
          tenantId,
          type === "TILL"
            ? { type, accountName: before.name, tillNumber: shortcode }
            : { type, accountName: before.name, paybillNumber: shortcode, paybillAccountReference: before.slug.slice(0, 20) },
          request.user!.id
        );
      }

      // Refusing this is the difference between "we owe you and cannot pay you" and a support
      // ticket after the money is already collected.
      if (body.collectionMode === "PLATFORM" && !(await getActiveDestination(tenantId))) {
        throw new ConflictError(
          "Set this tenant's settlement destination before collecting on their behalf — otherwise their money accumulates with no way to send it."
        );
      }

      // The payoutShortcode columns are no longer read by settlements; they are mirrored only so
      // older screens that display them stay accurate.
      const after = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(body.collectionMode ? { collectionMode: body.collectionMode } : {}),
          ...(body.payoutShortcode !== undefined
            ? { payoutShortcode: body.payoutShortcode.trim() || null }
            : {}),
          ...(body.payoutShortcodeType ? { payoutShortcodeType: body.payoutShortcodeType } : {}),
        },
      });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.settlement_updated",
        resourceType: "Tenant",
        resourceId: tenantId,
        before: {
          collectionMode: before.collectionMode,
          payoutShortcode: before.payoutShortcode,
          payoutShortcodeType: before.payoutShortcodeType,
        },
        after: {
          collectionMode: after.collectionMode,
          payoutShortcode: after.payoutShortcode,
          payoutShortcodeType: after.payoutShortcodeType,
          settlementDestinationChanged: Boolean(shortcode),
          previousDestination: destinationBefore ? presentDestination(destinationBefore).label : null,
        },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(withPlatformUrl(after), request.id));
    }
  );

  app.patch(
    "/:tenantId",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const { trialEndsAt, ...body } = updateTenantSchema.parse(request.body);
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");

      const after = await prisma.tenant.update({
        where: { id: tenantId },
        data: { ...body, ...(trialEndsAt !== undefined ? { trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null } : {}) },
      });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.updated",
        resourceType: "Tenant",
        resourceId: tenantId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse(withPlatformUrl(after), request.id));
    }
  );

  app.post(
    "/:tenantId/suspend",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.suspend")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");

      const after = await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.suspended",
        resourceType: "Tenant",
        resourceId: tenantId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse(withPlatformUrl(after), request.id));
    }
  );

  /**
   * Approval of a self-registered ISP. Registration leaves the tenant PENDING_APPROVAL (its owner
   * cannot sign in, its captive portal refuses customers) and tells the owner to wait; this is
   * the moment they are told they are live, on both channels they gave us, with the links that
   * now work. Idempotent on an already-active tenant so a double click sends one welcome.
   */
  /**
   * The tenant's free trial: extend it by some days, set its end date, or end it now. Keeps the
   * trial subscription in step (the hourly expire-trials job reads its currentPeriodEnd, and would
   * otherwise mark an extended trial expired), clears the "trial ended" banners a new date makes
   * wrong, and tells the ISP with a dashboard banner. A paid-up (ACTIVE) or overdue plan is left
   * alone: those are about payment, not the trial.
   */
  app.post(
    "/:tenantId/trial",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const body = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(365) }),
          z.object({ action: z.literal("set"), until: z.string().datetime() }),
          z.object({ action: z.literal("end") }),
        ])
        .parse(request.body);
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } });
      if (!tenant || tenant.deletedAt) throw new NotFoundError("Tenant");

      const now = new Date();
      let until: Date;
      if (body.action === "extend") {
        const from = tenant.trialEndsAt && tenant.trialEndsAt > now ? tenant.trialEndsAt : now;
        until = new Date(from.getTime() + body.days * 24 * 60 * 60 * 1000);
      } else if (body.action === "set") {
        until = new Date(body.until);
        if (until <= now) throw new ConflictError("Pick a date in the future, or use “End trial now”.");
      } else {
        until = now;
      }

      const sub = tenant.subscription;
      const syncSub = sub && (sub.status === "TRIALING" || sub.status === "EXPIRED" || sub.status === "CANCELLED");
      await prisma.$transaction([
        prisma.tenant.update({ where: { id: tenantId }, data: { trialEndsAt: until } }),
        ...(syncSub
          ? [prisma.tenantSubscription.update({ where: { id: sub.id }, data: body.action === "end" ? { status: "EXPIRED", currentPeriodEnd: until } : { status: "TRIALING", currentPeriodEnd: until } })]
          : []),
        ...(body.action === "end"
          ? []
          : [
              prisma.platformAnnouncement.deleteMany({ where: { tenantId, title: { in: ["Your free trial has ended", "Your free trial has been extended"] } } }),
              prisma.platformAnnouncement.create({
                data: {
                  tenantId,
                  title: "Your free trial has been extended",
                  body: `Your free trial now runs until ${until.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: tenant.timezone || "Africa/Nairobi" })}. Everything is unlocked until then.`,
                  severity: "INFO",
                  createdByUserId: request.user!.id,
                  expiresAt: until,
                },
              }),
            ]),
      ]);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: body.action === "end" ? "tenant.trial_ended" : "tenant.trial_extended",
        resourceType: "Tenant",
        resourceId: tenantId,
        before: { trialEndsAt: tenant.trialEndsAt, subscriptionStatus: sub?.status ?? null },
        after: { trialEndsAt: until, subscriptionStatus: syncSub ? (body.action === "end" ? "EXPIRED" : "TRIALING") : sub?.status ?? null },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ trialEndsAt: until.toISOString(), subscriptionSynced: Boolean(syncSub) }, request.id));
    }
  );

  app.post(
    "/:tenantId/approve",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");
      if (before.status !== "PENDING_APPROVAL") {
        throw new ConflictError(`This tenant is ${before.status.toLowerCase().replace("_", " ")}, not awaiting approval`);
      }

      const after = await prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.approved",
        resourceType: "Tenant",
        resourceId: tenantId,
        before: { status: before.status },
        after: { status: after.status },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      const notified = await notifyTenantOwner(after, "approved");
      reply.send(successResponse({ ...withPlatformUrl(after), notified }, request.id));
    }
  );

  app.post(
    "/:tenantId/reject",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");
      if (before.status !== "PENDING_APPROVAL") {
        throw new ConflictError("Only a tenant awaiting approval can be rejected");
      }

      // CANCELLED, not deleted: the application and its audit trail stay visible, and the slug
      // stays reserved so a rejected applicant cannot simply re-register around the decision.
      const after = await prisma.tenant.update({ where: { id: tenantId }, data: { status: "CANCELLED" } });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.rejected",
        resourceType: "Tenant",
        resourceId: tenantId,
        before: { status: before.status },
        after: { status: after.status, reason: reason ?? null },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      const notified = await notifyTenantOwner(after, "rejected", reason);
      reply.send(successResponse({ ...withPlatformUrl(after), notified }, request.id));
    }
  );

  app.post(
    "/:tenantId/reactivate",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.suspend")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!before || before.deletedAt) throw new NotFoundError("Tenant");

      const after = await prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.reactivated",
        resourceType: "Tenant",
        resourceId: tenantId,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse(withPlatformUrl(after), request.id));
    }
  );

  // --- Onboarding fee (450 KSH, collected via the platform's own M-Pesa, not the tenant's) ---

  app.get(
    "/:tenantId/onboarding-fee",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.read")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const fee = await getOnboardingFeeStatus(tenantId);
      reply.send(successResponse(fee, request.id));
    }
  );

  app.post(
    "/:tenantId/onboarding-fee/charge",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const { phone } = z.object({ phone: z.string().min(9) }).parse(request.body);

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant || tenant.deletedAt) throw new NotFoundError("Tenant");

      const fee = await initiateOnboardingFeeStkPush(tenantId, phone);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.onboarding_fee_charged",
        resourceType: "TenantOnboardingFee",
        resourceId: fee.id,
        after: { checkoutRequestId: fee.checkoutRequestId, amountMinor: fee.amountMinor },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(successResponse(fee, request.id));
    }
  );

  // --- Subscription plan assignment (super admin changes a tenant's plan/cycle) ---

  app.patch(
    "/:tenantId/subscription",
    { config: { audience: "platform" }, preHandler: [...preHandler, requirePermission("tenants.update")] },
    async (request, reply) => {
      const { tenantId } = idParamsSchema.parse(request.params);
      const { planId, billingCycle } = z
        .object({ planId: z.string().uuid(), billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional() })
        .parse(request.body);

      const [tenant, plan, before] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId } }),
        prisma.tenantPlan.findUnique({ where: { id: planId } }),
        prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      ]);
      if (!tenant || tenant.deletedAt) throw new NotFoundError("Tenant");
      if (!plan) throw new NotFoundError("Plan");

      // No proration this pass — plan change takes effect immediately, currentPeriodEnd unchanged.
      const after = before
        ? await prisma.tenantSubscription.update({
            where: { tenantId },
            data: { planId, ...(billingCycle ? { billingCycle } : {}) },
          })
        : await prisma.tenantSubscription.create({
            data: {
              tenantId,
              planId,
              billingCycle: billingCycle ?? "MONTHLY",
              status: "ACTIVE",
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "tenant.plan_changed",
        resourceType: "TenantSubscription",
        resourceId: after.id,
        before,
        after,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(after, request.id));
    }
  );
}
