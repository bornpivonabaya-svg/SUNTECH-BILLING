import { prisma, type User, type Tenant } from "@mashupkgrid/database";
import {
  verifyLoginCredentials,
  isSuspiciousLogin,
  registerUser,
  verifyEmailToken,
  resendVerificationEmail,
  requestPasswordReset,
  resetPassword,
  createSession,
  refreshSession,
  revokeSession,
  verifyGoogleIdToken,
  type DeviceContext,
  type IssuedTokens,
} from "@mashupkgrid/auth";
import {
  ConflictError,
  NotFoundError,
  TenantSuspendedError,
  TenantPendingApprovalError,
  UnauthorizedError,
  ValidationError,
  hashPassword,
  generateSecureToken,
  isReservedSubdomain,
} from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { getPlatformGoogleAuthConfig } from "./google-auth-config.service.js";
import { secondStepFor, type SecondStep } from "./mfa.service.js";
import {
  enqueueSendVerificationEmail,
  enqueueSendPasswordResetEmail,
  enqueueSendWhatsappTenantWelcome,
  enqueueSendTenantWelcomeEmail,
} from "../lib/queue.js";

/**
 * Resolves a tenant slug to its row, enforcing the same access checks `resolveTenant` (the
 * per-request plugin) enforces for an already-authenticated request — the auth-time equivalent,
 * since a suspended/cancelled tenant's staff shouldn't even be able to log in in the first place.
 * Used both here and by the public hotspot routes (apps/api/src/routes/hotspot.ts).
 */
export async function resolveTenantBySlug(slug: string): Promise<Tenant> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || tenant.deletedAt) throw new NotFoundError("Tenant");
  if (tenant.status === "SUSPENDED") throw new TenantSuspendedError();
  if (tenant.status === "CANCELLED") throw new UnauthorizedError("This tenant account has been cancelled");
  if (tenant.status === "PENDING_APPROVAL") throw new TenantPendingApprovalError();
  return tenant;
}

/** Every new self-registered account starts as a tenant-scoped CUSTOMER — never anything with
 *  broader permissions, regardless of what the request claims. */
export async function assignDefaultCustomerRole(userId: string, tenantId: string): Promise<void> {
  const role = await prisma.role.findFirst({ where: { tenantId: null, name: "CUSTOMER" } });
  if (!role) return;
  await prisma.userRole.upsert({
    where: { userId_roleId_tenantId: { userId, roleId: role.id, tenantId } },
    update: {},
    create: { userId, roleId: role.id, tenantId },
  });
}

/** Gives a shop agent's login the AGENT role, creating the role first on a database seeded
 *  before agents existed. */
export async function assignAgentRole(userId: string, tenantId: string): Promise<void> {
  let role = await prisma.role.findFirst({ where: { tenantId: null, name: "AGENT" } });
  if (!role) {
    role = await prisma.role.create({ data: { name: "AGENT", isSystem: true, tenantId: null } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["sessions.manage_own"] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role!.id, permissionId: p.id })), skipDuplicates: true });
  }
  await prisma.userRole.upsert({
    where: { userId_roleId_tenantId: { userId, roleId: role.id, tenantId } },
    update: {},
    create: { userId, roleId: role.id, tenantId },
  });
}

export interface RegisterCustomerBody {
  tenantSlug: string;
  email: string;
  password: string;
  phone?: string;
}

export async function registerCustomer(
  body: RegisterCustomerBody,
  device: DeviceContext
): Promise<{ user: User; session: IssuedTokens | null }> {
  const tenant = await resolveTenantBySlug(body.tenantSlug);
  const { user, verificationToken, session } = await registerUser({
    tenantId: tenant.id,
    email: body.email,
    password: body.password,
    phone: body.phone ?? null,
    device,
  });

  await assignDefaultCustomerRole(user.id, tenant.id);

  if (verificationToken) {
    await enqueueSendVerificationEmail({ userId: user.id, email: user.email, verificationToken });
  }

  return { user, session };
}

export interface LoginBody {
  tenantSlug: string | null;
  email: string;
  password: string;
}

/** Never assigned to a real Tenant — routes a nonexistent/deleted tenant slug into the exact
 *  same "no such user" path attemptLogin already gives a genuinely-unknown email, instead of a
 *  distinct pre-credential error. See the comment on `login` for why. */
const NONEXISTENT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Tenant status is deliberately NOT checked before credentials are: doing so would let an
 * unauthenticated caller enumerate valid tenant slugs and learn a tenant's suspended/cancelled
 * status by watching which distinct error a login attempt returns, before ever proving they know
 * a real password. Only once attemptLogin confirms real credentials do we reveal tenant-status
 * detail — the same "authenticated callers only" rule the resolveTenant plugin already applies
 * post-login.
 */
export type LoginOutcome =
  | (IssuedTokens & { user: User; suspicious: boolean; secondStep?: undefined })
  | { user: User; suspicious: boolean; secondStep: SecondStep };

export async function login(body: LoginBody, device: DeviceContext): Promise<LoginOutcome> {
  let tenant: Tenant | null = null;
  let tenantId: string | null = null;
  if (body.tenantSlug) {
    tenant = await prisma.tenant.findUnique({ where: { slug: body.tenantSlug } });
    tenantId = tenant && !tenant.deletedAt ? tenant.id : NONEXISTENT_TENANT_ID;
  } else {
    const normalizedEmail = body.email.trim().toLowerCase();
    const platformUser = await prisma.user.findFirst({
      where: { tenantId: null, email: normalizedEmail, deletedAt: null },
    });
    if (!platformUser) {
      const tenantUsers = await prisma.user.findMany({
        where: { email: normalizedEmail, deletedAt: null, tenantId: { not: null } },
        include: { tenant: true },
        take: 2,
      });
      if (tenantUsers.length === 1 && tenantUsers[0]?.tenant && !tenantUsers[0].tenant.deletedAt) {
        tenantId = tenantUsers[0].tenantId;
        tenant = tenantUsers[0].tenant;
      }
    }
  }

  const user = await verifyLoginCredentials({ tenantId, email: body.email, password: body.password, device });

  if (tenant?.status === "SUSPENDED") throw new TenantSuspendedError();
  if (tenant?.status === "CANCELLED") throw new UnauthorizedError("This tenant account has been cancelled");
  if (tenant?.status === "PENDING_APPROVAL") throw new TenantPendingApprovalError();

  const suspicious = await isSuspiciousLogin(user.id, device);
  // Two-step login: a code comes before the session.
  const secondStep = await secondStepFor(user, device);
  if (secondStep) return { user, suspicious, secondStep };
  const issued = await createSession(user.id, user.tenantId, device);
  return { ...issued, user, suspicious };
}

export interface GoogleAuthBody {
  tenantSlug: string;
  credential: string;
}

/**
 * Finds-or-creates a user from a verified Google identity. If no account exists for this email
 * within the given tenant (or at the platform level, when tenantSlug is empty), a duplicate-
 * account check runs first: an existing account for this email under a *different* tenant blocks
 * silent creation of a second one — surfaced as a clear error rather than masking what's likely a
 * wrong-tenant mistake as a brand-new signup. An empty tenantSlug can only ever resolve an
 * *existing* platform-level account; it can never register a brand-new tenant-less one.
 */
export async function loginOrRegisterWithGoogle(
  body: GoogleAuthBody,
  device: DeviceContext
): Promise<{ user: User; tokens: IssuedTokens }> {
  const config = await getPlatformGoogleAuthConfig();
  if (!config.enabled || !config.clientId) {
    throw new ConflictError("Google sign-in is not enabled on this platform");
  }

  const identity = await verifyGoogleIdToken(body.credential, config.clientId);
  if (!identity.emailVerified) {
    throw new ValidationError("This Google account's email address is not verified");
  }
  // Normalize exactly like every password-based lookup/create already does (login.ts,
  // registration.ts) — Postgres's unique index on (tenantId, email) is case-sensitive, and
  // Google's `email` claim is not guaranteed lowercase for Workspace/custom-domain accounts.
  // Skipping this let a differently-cased Google identity silently create a second, disconnected
  // account instead of matching an existing one, defeating the duplicate-account check below.
  const email = identity.email.trim().toLowerCase();

  let tenant: Tenant | null = null;
  let tenantId: string | null = null;
  if (body.tenantSlug) {
    tenant = await prisma.tenant.findUnique({ where: { slug: body.tenantSlug } });
    // Same pre-credential-oracle concern as `login` — a Google identity is itself the proven
    // credential here, so defer any tenant-status detail until after we know this identity maps
    // to a real account (or is about to create one) in that tenant.
    tenantId = tenant && !tenant.deletedAt ? tenant.id : NONEXISTENT_TENANT_ID;
  }

  let user = await prisma.user.findFirst({ where: { tenantId, email } });

  if (!user) {
    const existingElsewhere = await prisma.user.findFirst({
      where: { email, tenantId: { not: tenantId } },
    });
    if (existingElsewhere) {
      throw new ConflictError(
        "An account with this email already exists under a different organization — sign in with the correct tenant, or use your password."
      );
    }

    if (tenantId === null || tenantId === NONEXISTENT_TENANT_ID) {
      throw new ValidationError("Enter your ISP's tenant slug to create an account with Google");
    }

    user = await prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await hashPassword(generateSecureToken()),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    await assignDefaultCustomerRole(user.id, tenantId);
  }

  if (user.status === "SUSPENDED") {
    throw new UnauthorizedError("This account has been suspended");
  }
  if (tenant?.status === "SUSPENDED") throw new TenantSuspendedError();
  if (tenant?.status === "CANCELLED") throw new UnauthorizedError("This tenant account has been cancelled");
  if (tenant?.status === "PENDING_APPROVAL") throw new TenantPendingApprovalError();

  const tokens = await createSession(user.id, user.tenantId, device);
  return { user, tokens };
}

export async function refresh(token: string, device: DeviceContext): Promise<IssuedTokens> {
  return refreshSession(token, device);
}

export async function logout(
  sessionId: string,
  _context: { userId: string; tenantId: string | null; ipAddress: string | null; userAgent: string | null }
): Promise<void> {
  await revokeSession(sessionId, "logout");
}

export async function verifyEmail(token: string, _device: DeviceContext): Promise<User> {
  return verifyEmailToken(token);
}

/** Resolves a slug for the silent-no-op public endpoints (forgot-password, resend-verification)
 *  without ever throwing — an unknown/suspended/cancelled tenant must be indistinguishable from
 *  an unknown email, both here and at `login`, or the slug itself becomes an enumeration oracle. */
async function resolveTenantIdForNoOpFlow(slug: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  return tenant && !tenant.deletedAt && tenant.status === "ACTIVE" ? tenant.id : null;
}

export async function resendVerification(tenantSlug: string | null | undefined, email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  let tenantId: string | null = null;
  if (tenantSlug) {
    tenantId = await resolveTenantIdForNoOpFlow(tenantSlug);
    if (!tenantId) return;
  } else {
    const platformUser = await prisma.user.findFirst({
      where: { tenantId: null, email: normalizedEmail, deletedAt: null },
    });
    if (platformUser) {
      tenantId = null;
    } else {
      const tenantUser = await prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null, tenantId: { not: null } },
        include: { tenant: true },
      });
      if (tenantUser && tenantUser.tenant && tenantUser.tenant.status === "ACTIVE" && !tenantUser.tenant.deletedAt) {
        tenantId = tenantUser.tenant.id;
      } else {
        return;
      }
    }
  }

  const result = await resendVerificationEmail(tenantId, normalizedEmail);
  if (result) {
    await enqueueSendVerificationEmail({
      userId: result.user.id,
      email: result.user.email,
      verificationToken: result.verificationToken,
    });
  }
  // Silent no-op when result is null (already verified / unknown email) — never leak account
  // existence, same principle attemptLogin already applies.
}

export async function forgotPassword(tenantSlug: string | null | undefined, email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  let tenantId: string | null = null;
  if (tenantSlug) {
    tenantId = await resolveTenantIdForNoOpFlow(tenantSlug);
    if (!tenantId) return;
  } else {
    const platformUser = await prisma.user.findFirst({
      where: { tenantId: null, email: normalizedEmail, deletedAt: null },
    });
    if (platformUser) {
      tenantId = null;
    } else {
      const tenantUser = await prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null, tenantId: { not: null } },
        include: { tenant: true },
      });
      if (tenantUser && tenantUser.tenant && tenantUser.tenant.status === "ACTIVE" && !tenantUser.tenant.deletedAt) {
        tenantId = tenantUser.tenant.id;
      } else {
        return;
      }
    }
  }

  const result = await requestPasswordReset(tenantId, normalizedEmail);
  if (result) {
    await enqueueSendPasswordResetEmail({
      userId: result.user.id,
      email: result.user.email,
      resetToken: result.resetToken,
    });
  }
}

export async function completePasswordReset(
  token: string,
  password: string,
  _device: DeviceContext
): Promise<User> {
  return resetPassword(token, password);
}

export interface RegisterIspTenantBody {
  name: string;
  company: string;
  slug: string;
  email: string;
  phone?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  password: string;
  heardAboutUs?: string;
}

export async function registerIspTenant(
  body: RegisterIspTenantBody,
  device: DeviceContext
): Promise<{ tenant: Tenant; user: User; session: IssuedTokens }> {
  const cleanSlug = body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const cleanEmail = body.email.trim().toLowerCase();

  // Re-validate the sanitized slug rather than trusting the request schema's regex: the strip
  // above can shorten a slug past the 3-character minimum, and a slug of only hyphens passes the
  // regex but is not a usable hostname label.
  if (cleanSlug.length < 3 || cleanSlug.length > 30 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(cleanSlug)) {
    throw new ValidationError(
      "Choose an address of 3-30 letters, numbers, or dashes, starting and ending with a letter or number."
    );
  }

  // The public /isp-registration/check-slug endpoint refused reserved names, but this — the
  // endpoint that actually creates the tenant — did not, so the check was advisory only: a
  // caller who skipped the wizard could register `api`, `admin`, `portal`, or `support` directly
  // and be handed that subdomain of the platform's own domain. See RESERVED_SUBDOMAINS for why
  // that is a phishing/CORS problem, not a cosmetic one. The super-admin tenant-creation route
  // (apps/api/src/routes/tenants.ts) already enforced this; this path now matches it.
  if (isReservedSubdomain(cleanSlug)) {
    throw new ConflictError(`The address "${cleanSlug}" is reserved by the platform. Please pick another name.`);
  }

  // Check if tenant slug already exists
  const existingTenant = await prisma.tenant.findUnique({ where: { slug: cleanSlug } });
  if (existingTenant) {
    throw new ConflictError(`The domain prefix "${cleanSlug}" is already taken. Please pick another name.`);
  }

  // Check if an account with this email already exists across the system
  const existingUser = await prisma.user.findFirst({ where: { email: cleanEmail } });
  if (existingUser) {
    throw new ConflictError("An account already exists for this email address. Sign in instead.");
  }

  // Find default or first active plan for trial
  const plan =
    (await prisma.tenantPlan.findFirst({ where: { isDefault: true, isActive: true } })) ??
    (await prisma.tenantPlan.findFirst({ where: { isActive: true } }));
  const trialDays = plan?.trialDays ?? 14;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

  // Create Tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: body.company.trim(),
      slug: cleanSlug,
      status: "PENDING_APPROVAL",
      timezone: body.timezone?.trim() || "Africa/Nairobi",
      currency: body.currency?.trim() || "KES",
      trialEndsAt,
      ...(plan
        ? {
            subscription: {
              create: { planId: plan.id, status: "TRIALING", currentPeriodEnd: trialEndsAt },
            },
          }
        : {}),
    },
  });

  // Create Owner User
  const passwordHash = await hashPassword(body.password);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: body.name?.trim() || null,
      email: cleanEmail,
      phone: body.phone?.trim() || null,
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  // Assign ISP_OWNER / OWNER role
  const ownerRole =
    (await prisma.role.findFirst({ where: { name: "ISP_OWNER", tenantId: null } })) ??
    (await prisma.role.findFirst({ where: { name: "OWNER", tenantId: null } })) ??
    (await prisma.role.findFirst({ where: { isSystem: true, tenantId: null } }));

  // A silently-skipped assignment here used to leave the new owner with zero permissions and no
  // error raised at all — the only symptom was a support ticket days later saying "I can't do
  // anything in my own account." Seed data (packages/database/prisma/seed.ts) is what's supposed
  // to guarantee one of the three lookups above always matches; if none does, that's a real
  // deployment misconfiguration and must fail loudly, not hand out a powerless account.
  if (!ownerRole) {
    throw new Error(
      "No system role found to assign as tenant owner (expected ISP_OWNER, OWNER, or any isSystem role) — seed data is missing or misconfigured"
    );
  }
  await prisma.userRole.upsert({
    where: { userId_roleId_tenantId: { userId: user.id, roleId: ownerRole.id, tenantId: tenant.id } },
    update: {},
    create: { userId: user.id, roleId: ownerRole.id, tenantId: tenant.id },
  });

  const session = await createSession(user.id, tenant.id, device);

  // Welcome the new ISP owner on the WhatsApp number they just verified during registration.
  // Enqueued (not awaited inline) so a WhatsApp hiccup can never fail a registration whose
  // account, tenant, and session are already committed — the job retries on its own.
  if (body.phone) await enqueueSendWhatsappTenantWelcome({
    // Sent on the platform line: this ISP has not had the chance to link its own WhatsApp
    // account yet — the message it's about to receive is what tells them they can.
    tenantId: null,
    phone: body.phone,
    ownerName: body.name.trim(),
    companyName: tenant.name,
    username: cleanEmail,
    // The tenant's own subdomain, not the platform apex. This is the address the ISP will use
    // from now on, and the welcome message is the first and often only place they are told it.
    dashboardUrl: `https://${tenant.slug}.${env.PLATFORM_BASE_DOMAIN}/login`,
    portalUrl: `${env.APP_WEB_URL}/hotspot/${tenant.slug}`,
    // The tenant is PENDING_APPROVAL: this says "we have your application", not "you're live".
    // The real welcome goes out from POST /platform/tenants/:id/approve.
    stage: "pending",
  }).catch((err) => console.error("[auth] failed to enqueue tenant welcome WhatsApp:", err));

  // Welcome the new ISP owner via Email with their Subdomain, Username and links
  await enqueueSendTenantWelcomeEmail({
    email: cleanEmail,
    ownerName: body.name.trim(),
    companyName: tenant.name,
    subdomain: tenant.slug,
    dashboardUrl: `https://${tenant.slug}.${env.PLATFORM_BASE_DOMAIN}/login`,
    portalUrl: `${env.APP_WEB_URL}/hotspot/${tenant.slug}`,
    stage: "pending",
  }).catch((err) => console.error("[auth] failed to enqueue tenant welcome Email:", err));

  return { tenant, user, session };
}
