import type { FastifyRequest } from "fastify";
import { prisma } from "@mashupkgrid/database";
import { TenantSuspendedError, TenantPendingApprovalError, TenantTrialExpiredError, UnauthorizedError } from "@mashupkgrid/shared";

/**
 * Tenant resolution preHandler — must run after `authenticate`. Staff/customer accounts are
 * scoped to exactly one tenant in Phase 1 (their `User.tenantId`); SUPER_ADMIN accounts have
 * `tenantId = null` and operate in the platform scope (`request.tenantCtx = null`) — platform
 * routes that need to act on a specific tenant take that tenant's id as an explicit route
 * param, which is itself audit-logged, rather than any implicit "acting as" state.
 */
export async function resolveTenant(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    throw new UnauthorizedError("Authentication is required before tenant resolution");
  }

  if (request.user.tenantId === null) {
    request.tenantCtx = null;
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: request.user.tenantId },
    include: { subscription: { include: { plan: true } } },
  });
  if (!tenant || tenant.deletedAt) {
    throw new UnauthorizedError("Tenant account no longer exists");
  }
  if (tenant.status === "SUSPENDED") {
    throw new TenantSuspendedError();
  }
  if (tenant.status === "CANCELLED") {
    throw new UnauthorizedError("This tenant account has been cancelled");
  }
  if (tenant.status === "PENDING_APPROVAL") {
    throw new TenantPendingApprovalError();
  }

  const now = new Date();
  const isTrialExpired = Boolean(
    tenant.trialEndsAt &&
    tenant.trialEndsAt <= now &&
    tenant.subscription?.status !== "ACTIVE"
  );

  request.tenantCtx = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    brandColor: tenant.brandColor,
    logoUrl: tenant.logoUrl,
    disabledFeatures: tenant.disabledFeatures,
    trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
    planFeatures: tenant.subscription?.plan.features ?? null,
    subscriptionStatus: tenant.subscription?.status ?? null,
    isTrialExpired,
  };

  // If the trial has expired and there is no active paid subscription, block tenant feature routes.
  // Billing, subscription, plans, and account endpoints stay accessible so the tenant can pay.
  if (isTrialExpired) {
    const isExempt = isTrialExemptPath(request.url || "");

    if (!isExempt) {
      throw new TenantTrialExpiredError(
        "Your free trial has ended. Please subscribe to a plan under Settings > Billing to continue using tenant features."
      );
    }
  }
}

/** Where a tenant whose trial has ended may still go: signing in, their subscription and paying
 *  for it (Settings > My subscription calls /api/v1/billing), plans, and notices. Everything else
 *  answers "trial ended". Matched on whole path segments, so /api/v1/billing-x isn't let through. */
const TRIAL_EXEMPT_PREFIXES = [
  "/api/v1/auth",
  "/api/v1/billing",
  "/api/v1/tenant-billing",
  "/api/v1/subscriptions",
  "/api/v1/plans",
  "/api/v1/announcements",
  "/api/v1/notifications",
  "/api/v1/settings/account",
  "/api/v1/tenants/me",
  "/api/v1/tenants/subscription",
];

export function isTrialExemptPath(url: string): boolean {
  const path = url.split("?")[0]!;
  return TRIAL_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
