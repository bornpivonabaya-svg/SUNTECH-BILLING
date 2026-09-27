import { buildAloginPage } from "../lib/router-pages.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  validateVoucherForLogin,
  activateVoucher,
  authenticateHotspotAccount,
  listHotspotPackages,
} from "@mashupkgrid/radius";
import { normalizeKenyanPhone } from "@mashupkgrid/payments";
import { createTicket } from "@mashupkgrid/support";
import {
  initiateHotspotPurchaseStkPush,
  queryAndReconcileStkRequest,
  isStkRequestOpen,
  STK_STILL_PROCESSING,
  initiatePaystackHotspotPurchase,
  verifyAndReconcilePaystackTransaction,
  initiatePesapalHotspotPurchase,
  verifyAndReconcilePesapalTransaction,
} from "@mashupkgrid/payments";
import { successResponse, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@mashupkgrid/shared";
import { appFilterPortalHosts, buildAppFilterSection, checkMacLogin, rememberDevice, sessionNamesForVoucher } from "@mashupkgrid/network";
import { env } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { requirePermission } from "../plugins/authorize.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { hotspotLoginRateLimitConfig } from "../plugins/rate-limit.js";
import { resolveTenantBySlug } from "../services/auth.service.js";

const tenantParamsSchema = z.object({ tenantSlug: z.string().min(1) });
const loginBodySchema = z.object({
  code: z.string().min(1).max(32),
  mac: z.string().max(32).optional(),
  disconnectPrevious: z.boolean().optional(),
});
/** Either identifier is accepted: the number they paid from, or the confirmation SMS pasted
 *  whole. Both are things a stranded customer has on their phone right now. */
const recoverBodySchema = z
  .object({
    phone: z.string().min(9).max(20).optional(),
    mpesaMessage: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.phone || v.mpesaMessage), {
    message: "Enter the phone number you paid with, or paste the M-Pesa message",
  });
const accountLoginBodySchema = z.object({ phone: z.string().min(9), password: z.string().min(1) });
const supportTicketBodySchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(9).max(32).optional(),
  email: z.string().email().optional(),
  message: z.string().min(1).max(2000),
});
const purchaseBodySchema = z.object({
  hotspotPackageId: z.string().uuid(),
  phone: z.string().min(9),
  email: z.string().email().optional(),
  method: z.enum(["MPESA", "PAYSTACK", "PESAPAL"]).default("MPESA"),
  // Only meaningful for PAYSTACK/PESAPAL — its checkout is a full off-site redirect, so the router's
  // link-login-only URL (otherwise just a query param the page already has) would be lost the
  // moment the browser leaves for Paystack/Pesapal, unless it's captured here and carried through the
  // transaction row instead (see initiatePaystackHotspotPurchase / paystack.ts's /return route).
  linkLoginOnly: z.string().url().optional(),
});
const statusParamsSchema = z.object({
  tenantSlug: z.string().min(1),
  checkoutRequestId: z.string().min(1),
});
const paystackStatusParamsSchema = z.object({
  tenantSlug: z.string().min(1),
  reference: z.string().min(1),
});

/**
 * Per-tenant captive-portal branding. Backed by the `captive_portal_configs` table (one row per
 * tenant, see packages/database/prisma/schema.prisma) rather than a JSON file on disk, which is
 * what it used to be. The file store cost three separate defects: the slug went into a
 * filesystem path and needed its own traversal guard, the write endpoint was unauthenticated,
 * and the directory had no volume in production so every deploy silently restored a stale copy
 * baked into the image. A tenant-scoped row removes all three by construction.
 */
export interface CaptivePortalConfig {
  phone: string;
  supportPhone: string;
  brandName: string;
  welcomeTitle: string;
  bannerSubtitle: string;
  activeThemeId: string;
  installationFee?: string;
  fiberRates?: Array<{ speed: string; price: string; subtitle?: string }>;
  /** The ~30-plugin customizer's whole state, opaque to the server — see the schema comment on
   *  CaptivePortalConfig.pluginsConfig for why this used to never reach here at all. */
  pluginsConfig?: unknown;
}

/**
 * What a tenant's captive portal shows before they have configured anything.
 *
 * Everything identifying is deliberately EMPTY. This object previously carried one real ISP's
 * trading name, support number, installation fee and full speed/price list — and it is served by
 * /info to every tenant with no saved config, so a brand-new ISP's customers were shown another
 * company's phone number to call and a price list that ISP does not charge. It also outranked the
 * client-side fallbacks, since the portal receives these as real values rather than blanks.
 *
 * Only non-identifying presentation copy has a default: a headline, a subtitle and a theme are
 * placeholders any ISP can live with, whereas a phone number or a tariff is a factual claim about
 * a specific business. `brandName` falls back to the tenant's own registered name at the call
 * site, so the portal is never nameless.
 */
const DEFAULT_CAPTIVE_CONFIG: CaptivePortalConfig = {
  phone: "",
  supportPhone: "",
  brandName: "",
  welcomeTitle: "Fast, reliable Wi-Fi",
  bannerSubtitle: "Pay with M-Pesa and connect instantly",
  activeThemeId: "mashuphost-clean",
  installationFee: "",
  fiberRates: [],
  pluginsConfig: null,
};

/** Every column is nullable, so an unset field falls back to the shared default rather than
 *  rendering an empty portal. A tenant with no row at all gets the defaults with its own name
 *  as the brand, which is what a freshly-created tenant should show before anyone customizes. */
function toCaptiveConfig(
  row: {
    phone: string | null;
    supportPhone: string | null;
    brandName: string | null;
    welcomeTitle: string | null;
    bannerSubtitle: string | null;
    activeThemeId: string | null;
    installationFee: string | null;
    fiberRates: unknown;
    pluginsConfig: unknown;
  } | null,
  tenantName?: string
): CaptivePortalConfig {
  if (!row) {
    return { ...DEFAULT_CAPTIVE_CONFIG, brandName: tenantName || DEFAULT_CAPTIVE_CONFIG.brandName };
  }
  return {
    phone: row.phone ?? DEFAULT_CAPTIVE_CONFIG.phone,
    supportPhone: row.supportPhone ?? DEFAULT_CAPTIVE_CONFIG.supportPhone,
    brandName: row.brandName ?? tenantName ?? DEFAULT_CAPTIVE_CONFIG.brandName,
    welcomeTitle: row.welcomeTitle ?? DEFAULT_CAPTIVE_CONFIG.welcomeTitle,
    bannerSubtitle: row.bannerSubtitle ?? DEFAULT_CAPTIVE_CONFIG.bannerSubtitle,
    activeThemeId: row.activeThemeId ?? DEFAULT_CAPTIVE_CONFIG.activeThemeId,
    installationFee: row.installationFee ?? DEFAULT_CAPTIVE_CONFIG.installationFee,
    fiberRates: (row.fiberRates as CaptivePortalConfig["fiberRates"]) ?? DEFAULT_CAPTIVE_CONFIG.fiberRates,
    pluginsConfig: row.pluginsConfig ?? null,
  };
}

async function loadTenantCaptiveConfig(tenantId: string, tenantName?: string): Promise<CaptivePortalConfig> {
  const row = await prisma.captivePortalConfig.findUnique({ where: { tenantId } });
  return toCaptiveConfig(row, tenantName);
}

async function saveTenantCaptiveConfig(
  tenantId: string,
  tenantName: string,
  patch: Partial<CaptivePortalConfig>
): Promise<CaptivePortalConfig> {
  // Upsert with only the supplied keys: a caller editing one field must not blank out the rest,
  // which is the same partial-merge behaviour the file store had.
  const data = {
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.supportPhone !== undefined ? { supportPhone: patch.supportPhone } : {}),
    ...(patch.brandName !== undefined ? { brandName: patch.brandName } : {}),
    ...(patch.welcomeTitle !== undefined ? { welcomeTitle: patch.welcomeTitle } : {}),
    ...(patch.bannerSubtitle !== undefined ? { bannerSubtitle: patch.bannerSubtitle } : {}),
    ...(patch.activeThemeId !== undefined ? { activeThemeId: patch.activeThemeId } : {}),
    ...(patch.installationFee !== undefined ? { installationFee: patch.installationFee } : {}),
    ...(patch.fiberRates !== undefined ? { fiberRates: patch.fiberRates } : {}),
    ...(patch.pluginsConfig !== undefined ? { pluginsConfig: patch.pluginsConfig as object } : {}),
  };
  const row = await prisma.captivePortalConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  return toCaptiveConfig(row, tenantName);
}

// Every field is length-bounded: this config is written verbatim to a JSON file on disk and
// rendered straight onto the public captive portal, so an unbounded string here is both an
// unbounded disk write and an unbounded payload served to every visitor of that portal.
const updateConfigSchema = z.object({
  phone: z.string().max(40).optional(),
  supportPhone: z.string().max(40).optional(),
  brandName: z.string().max(80).optional(),
  welcomeTitle: z.string().max(120).optional(),
  bannerSubtitle: z.string().max(200).optional(),
  activeThemeId: z.string().max(64).optional(),
  installationFee: z.string().max(40).optional(),
  fiberRates: z
    .array(
      z.object({
        speed: z.string().max(40),
        price: z.string().max(40),
        subtitle: z.string().max(80).optional(),
      })
    )
    .max(24)
    .optional(),
  // Opaque to this schema by design — the ~30-plugin customizer's shape lives in the web app,
  // not here, and duplicating it would only let the two drift apart. Bounded instead: a plain
  // object, size-capped, because this row is served on every anonymous portal page load and an
  // unbounded blob here is an unbounded payload for every visitor plus an unbounded write from a
  // staff-authenticated but still fallible client.
  pluginsConfig: z
    .unknown()
    .optional()
    .refine((v) => v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v)), {
      message: "pluginsConfig must be a plain object",
    })
    .refine((v) => v === undefined || JSON.stringify(v).length <= 300_000, {
      message: "pluginsConfig is too large (max ~300KB)",
    }),
});

/**
 * The public captive-portal surface — a WiFi customer's device is redirected here by the
 * router's hotspot walled garden, before any login exists. No `authenticate` preHandler
 * anywhere in this file is deliberate, not an oversight: this is the one part of the platform
 * genuinely meant to be used by someone with no account.
 */
export async function hotspotRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/:tenantSlug/info",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      const config = await loadTenantCaptiveConfig(tenant.id, tenant.name);

      reply.send(
        successResponse(
          {
            name: config.brandName || tenant.name,
            brandName: config.brandName || tenant.name,
            phone: config.phone,
            supportPhone: config.supportPhone,
            welcomeTitle: config.welcomeTitle,
            bannerSubtitle: config.bannerSubtitle,
            activeThemeId: config.activeThemeId,
            installationFee: config.installationFee,
            fiberRates: config.fiberRates,
            // Already set by every tenant in Settings, and until now never read by the one
            // surface a customer actually sees — the portal showed generic theme colours and no
            // logo no matter what a tenant had configured.
            logoUrl: tenant.logoUrl,
            brandColor: tenant.brandColor,
          },
          request.id
        )
      );
    }
  );

  app.get(
    "/:tenantSlug/config",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      const config = await loadTenantCaptiveConfig(tenant.id, tenant.name);
      reply.send(
        successResponse({ ...config, logoUrl: tenant.logoUrl, brandColor: tenant.brandColor }, request.id)
      );
    }
  );

  /**
   * The one WRITE on this otherwise-public router, and the only route in this file that is not
   * meant for an anonymous visitor. It previously carried `audience: "public"` and no preHandler
   * at all, which made every tenant's captive-portal branding world-writable: anyone on the
   * internet could PUT a new support phone number, brand name, and price list onto any ISP's
   * portal — a ready-made phishing page served from the ISP's own address, plus an unbounded
   * write of a `<slug>.json` file for tenant slugs that don't even exist. Staff auth, tenant
   * ownership, and `settings.manage` are all required now; the slug in the path must be the
   * caller's own tenant, so a signed-in staff member of tenant A still can't rewrite tenant B.
   */
  app.put(
    "/:tenantSlug/config",
    {
      config: { audience: "staff" },
      preHandler: [authenticate, resolveTenant, checkMaintenance, requirePermission("settings.manage")],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const body = updateConfigSchema.parse(request.body);

      const caller = request.tenantCtx;
      if (!caller) {
        throw new ConflictError("Platform administration has no captive portal of its own");
      }
      if (caller.slug.toLowerCase() !== tenantSlug.toLowerCase()) {
        throw new ForbiddenError("You can only edit your own tenant's captive portal");
      }

      // Keyed by the caller's own tenant id from the verified session, never by the slug in the
      // path — the ownership check above rejects a mismatch, and the id is what the row is
      // actually keyed on, so there is no way for the two to drift apart.
      const updated = await saveTenantCaptiveConfig(caller.id, caller.name, body);
      reply.send(successResponse(updated, request.id));
    }
  );

  /**
   * Staff view of the portal's payment methods: what this tenant COULD offer, and which of those
   * they have switched off. Separate from the public endpoint above, which only ever reports the
   * methods a customer can actually use — an anonymous visitor has no business knowing that a
   * method exists but is disabled.
   */
  app.get(
    "/payment-toggles",
    {
      config: { audience: "staff" },
      preHandler: [authenticate, resolveTenant, checkMaintenance, requirePermission("settings.manage")],
    },
    async (request, reply) => {
      // Platform administration has no captive portal of its own, so there is nothing to toggle.
      const tenantId = request.tenantCtx?.id;
      if (!tenantId) throw new ConflictError("Platform administration has no captive portal");

      const [tenant, configs, platformMpesa] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { collectionMode: true, portalPaymentsDisabled: true },
        }),
        prisma.paymentProviderConfig.findMany({ where: { tenantId, isActive: true } }),
        prisma.platformMpesaConfig.findFirst({ where: { isActive: true } }),
      ]);

      const disabled = new Set(tenant.portalPaymentsDisabled);
      const usable = {
        MPESA:
          configs.some((c) => c.provider === "MPESA") ||
          (tenant.collectionMode === "PLATFORM" && Boolean(platformMpesa)),
        PAYSTACK: configs.some((c) => c.provider === "PAYSTACK"),
        PESAPAL: configs.some((c) => (c.provider as string) === "PESAPAL"),
      };

      reply.send(
        successResponse(
          {
            methods: (["MPESA", "PAYSTACK", "PESAPAL"] as const).map((method) => ({
              method,
              usable: usable[method],
              enabled: usable[method] && !disabled.has(method),
            })),
          },
          request.id
        )
      );
    }
  );

  app.put(
    "/payment-toggles",
    {
      config: { audience: "staff" },
      preHandler: [authenticate, resolveTenant, checkMaintenance, requirePermission("settings.manage")],
    },
    async (request, reply) => {
      // Platform administration has no captive portal of its own, so there is nothing to toggle.
      const tenantId = request.tenantCtx?.id;
      if (!tenantId) throw new ConflictError("Platform administration has no captive portal");
      const body = z
        .object({ method: z.enum(["MPESA", "PAYSTACK", "PESAPAL"]), enabled: z.boolean() })
        .parse(request.body);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { portalPaymentsDisabled: true },
      });

      const disabled = new Set(tenant.portalPaymentsDisabled);
      if (body.enabled) disabled.delete(body.method);
      else disabled.add(body.method);

      await prisma.tenant.update({
        where: { id: tenantId },
        data: { portalPaymentsDisabled: [...disabled] },
      });

      reply.send(successResponse({ method: body.method, enabled: body.enabled }, request.id));
    }
  );

  /**
   * Public discovery endpoint reporting which payment methods are enabled for this tenant.
   */
  app.get(
    "/:tenantSlug/payment-methods",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);

      const [configs, platformMpesa] = await Promise.all([
        prisma.paymentProviderConfig.findMany({
          where: { tenantId: tenant.id, isActive: true },
        }),
        // Needed for aggregated tenants, who have no M-Pesa config of their own.
        prisma.platformMpesaConfig.findFirst({ where: { isActive: true } }),
      ]);

      const paystackConfig = configs.find((c) => c.provider === "PAYSTACK");
      const pesapalConfig = configs.find((c) => (c.provider as string) === "PESAPAL");

      // A tenant on platform collection has no M-Pesa credentials of their own by design — the
      // platform's paybill collects for them. Keying availability purely off their own config row
      // is what made M-Pesa vanish from an aggregated tenant's portal even though it was the one
      // method that definitely worked for them.
      const mpesaUsable =
        configs.some((c) => c.provider === "MPESA") ||
        (tenant.collectionMode === "PLATFORM" && Boolean(platformMpesa));

      const disabled = new Set(tenant.portalPaymentsDisabled);
      const enabled = (method: string, usable: boolean) => usable && !disabled.has(method);

      reply.send(
        successResponse(
          {
            mpesa: enabled("MPESA", mpesaUsable),
            paystack: enabled("PAYSTACK", Boolean(paystackConfig)),
            paystackPublicKey: paystackConfig?.publicKey ?? null,
            pesapal: enabled("PESAPAL", Boolean(pesapalConfig)),
            pesapalConsumerKey: pesapalConfig?.publicKey ?? null,
          },
          request.id
        )
      );
    }
  );

  /**
   * Public discovery endpoint for the Tawk.to widget — only ever reveals the widgetId when the
   * tenant has both switched it on AND opted it into this specific surface, never the raw config
   * row (an anonymous captive-portal visitor has no business seeing showOnDashboard etc).
   */
  app.get(
    "/:tenantSlug/live-chat",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      const config = await prisma.liveChatConfig.findUnique({ where: { tenantId: tenant.id } });

      const featureDisabled = tenant.disabledFeatures.includes("LIVE_CHAT");
      const show = !!(config?.isActive && config.showOnHotspotPortal && config.widgetId && !featureDisabled);
      reply.send(successResponse({ show, widgetId: show ? config!.widgetId : null }, request.id));
    }
  );

  /**
   * A walk-in hotspot customer reporting an issue has no account at all — this is the "no
   * account, no login" counterpart to the staff-created and /me/tickets flows, identified only by
   * whatever contact details they choose to give. Rate-limited the same as login, for the same
   * reason: it's a public, unauthenticated write.
   */
  app.post(
    "/:tenantSlug/support-ticket",
    {
      config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const body = supportTicketBodySchema.parse(request.body);
      const tenant = await resolveTenantBySlug(tenantSlug);

      const ticket = await createTicket(tenant.id, {
        contactName: body.name,
        contactPhone: body.phone,
        contactEmail: body.email,
        subject: `Hotspot support request from ${body.name}`,
        body: body.message,
        source: "HOTSPOT_PORTAL",
      });

      reply.status(201).send(successResponse({ id: ticket.id, status: ticket.status }, request.id));
    }
  );

  /**
   * Public endpoint listing available packages for online purchase on the captive portal.
   */
  app.get(
    "/:tenantSlug/packages",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      const packages = await listHotspotPackages(tenant.id, true);
      reply.send(successResponse(packages, request.id));
    }
  );

  /**
   * Can this phone reconnect without its code? The portal asks with the MAC the router put in the
   * sign-in link, and offers a "Reconnect" button when the answer is yes. Never returns the code:
   * the button asks the ROUTER to log this phone in by MAC, and the RADIUS server only accepts
   * that for the phone actually asking (see findMacLogin), so knowing a MAC here gains nothing.
   */
  app.get(
    "/:tenantSlug/devices/:mac/status",
    { config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug, mac } = z.object({ tenantSlug: z.string().min(1), mac: z.string().max(32) }).parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      const check = await checkMacLogin(tenant.id, mac);
      if (!check) {
        reply.send(successResponse({ canReconnect: false }, request.id));
        return;
      }
      const pkg = check.hotspotPackageId
        ? await prisma.hotspotPackage.findFirst({ where: { id: check.hotspotPackageId, tenantId: tenant.id }, select: { name: true } })
        : null;
      reply.send(
        successResponse(
          {
            canReconnect: true,
            packageName: pkg?.name ?? null,
            minutesLeft: check.remainingSeconds === null ? null : Math.floor(check.remainingSeconds / 60),
            dataLeftMb: check.remainingBytes === null ? null : Math.floor(check.remainingBytes / (1024 * 1024)),
          },
          request.id
        )
      );
    }
  );

  /**
   * Initiates an online purchase for a hotspot package (via M-Pesa STK or Paystack).
   */
  app.post(
    "/:tenantSlug/purchase",
    {
      config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const body = purchaseBodySchema.parse(request.body);
      const tenant = await resolveTenantBySlug(tenantSlug);

      if (body.method === "PAYSTACK") {
        const email = body.email?.trim();
        if (!email) {
          throw new ValidationError("An email address is required to pay by card/bank — please enter one");
        }

        const result = await initiatePaystackHotspotPurchase(tenant.id, {
          hotspotPackageId: body.hotspotPackageId,
          email,
          phone: body.phone,
          linkLoginOnly: body.linkLoginOnly,
        });

        reply.status(201).send(
          successResponse(
            {
              method: "PAYSTACK",
              reference: result.transaction.reference,
              authorizationUrl: result.authorizationUrl,
              status: result.transaction.status,
              amountMinor: result.transaction.amountMinor,
            },
            request.id
          )
        );
        return;
      }

      if (body.method === "PESAPAL") {
        const email = body.email?.trim() || `guest-${body.phone}@hotspot.local`;
        const result = await initiatePesapalHotspotPurchase(tenant.id, {
          hotspotPackageId: body.hotspotPackageId,
          email,
          phone: body.phone,
          linkLoginOnly: body.linkLoginOnly,
        });

        reply.status(201).send(
          successResponse(
            {
              method: "PESAPAL",
              reference: result.transaction.reference,
              authorizationUrl: result.redirectUrl,
              status: result.transaction.status,
              amountMinor: result.transaction.amountMinor,
            },
            request.id
          )
        );
        return;
      }

      // Default: M-Pesa STK Push
      const stkRequest = await initiateHotspotPurchaseStkPush(tenant.id, {
        hotspotPackageId: body.hotspotPackageId,
        phone: body.phone,
      });

      reply.status(201).send(
        successResponse(
          {
            method: "MPESA",
            checkoutRequestId: stkRequest.checkoutRequestId,
            status: stkRequest.status,
            amountMinor: stkRequest.amountMinor,
            phone: stkRequest.phone,
          },
          request.id
        )
      );
    }
  );

  /**
   * Polling endpoint for M-Pesa STK push.
   */
  app.get(
    "/:tenantSlug/purchase/:checkoutRequestId/status",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug, checkoutRequestId } = statusParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);

      let req = await prisma.mpesaStkRequest.findFirst({
        where: { tenantId: tenant.id, checkoutRequestId },
      });
      if (!req) throw new NotFoundError("Payment request");

      if (isStkRequestOpen(req)) {
        try {
          const res = await queryAndReconcileStkRequest(tenant.id, checkoutRequestId);
          req = res.request;
        } catch {
          // ignore query errors during polling
        }
      }

      reply.send(
        successResponse(
          {
            status: req.status,
            mpesaReceiptNumber: req.mpesaReceiptNumber,
            voucherCode: req.hotspotVoucherCode,
            resultDesc: req.resultDesc,
          },
          request.id
        )
      );
    }
  );

  /**
   * Polling endpoint for Paystack transaction on the captive portal.
   */
  app.get(
    "/:tenantSlug/purchase/paystack/:reference/status",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug, reference } = paystackStatusParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);

      let req = await prisma.paystackTransaction.findFirst({
        where: { tenantId: tenant.id, reference },
      });
      if (!req) throw new NotFoundError("Payment request");

      if (req.status === "PENDING") {
        try {
          req = await verifyAndReconcilePaystackTransaction(tenant.id, reference);
        } catch {
          // ignore verify network blips during polling
        }
      }

      reply.send(
        successResponse(
          {
            status: req.status,
            voucherCode: req.hotspotVoucherCode,
            gatewayResponse: req.gatewayResponse,
            amountMinor: req.amountMinor,
          },
          request.id
        )
      );
    }
  );

  /**
   * Polling endpoint for Pesapal transaction on the captive portal.
   */
  app.get(
    "/:tenantSlug/purchase/pesapal/:reference/status",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug, reference } = paystackStatusParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);

      let req = await prisma.paystackTransaction.findFirst({
        where: { tenantId: tenant.id, reference },
      });
      if (!req) throw new NotFoundError("Payment request");

      if (req.status === "PENDING") {
        try {
          req = await verifyAndReconcilePesapalTransaction(tenant.id, reference);
        } catch {
          // ignore verify network blips during polling
        }
      }

      reply.send(
        successResponse(
          {
            status: req.status,
            voucherCode: req.hotspotVoucherCode,
            gatewayResponse: req.gatewayResponse,
            amountMinor: req.amountMinor,
          },
          request.id
        )
      );
    }
  );

  /**
   * Served to a router, not a browser — this is what gets written onto the router's own flash
   * as hotspot/login.html (see buildMikrotikHotspotScript in @mashupkgrid/radius). RouterOS
   * substitutes its `$(...)` template variables when it serves this exact file to a connecting
   * client, so the literal tokens below must survive untouched — no client itself ever calls
   * this route directly, only the router's own hotspot HTTP server does, once, at write time
   * (`/tool fetch`), before ever handing it to a user.
   */
  /**
   * Served to a router, not a browser: the per-app package filter, which the platform's
   * self-repair has a router download and import when it is missing (see ensureHotspotProvisioning).
   * Nothing tenant-specific or secret in it; the slug only 404s an unknown tenant.
   */
  app.get(
    "/:tenantSlug/mikrotik-app-filter.rsc",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      await resolveTenantBySlug(tenantSlug);
      reply
        .header("Content-Type", "text/plain; charset=utf-8")
        .send(`${buildAppFilterSection({ portalHosts: appFilterPortalHosts() })}
:log info "MASHUPKGRID per-app filter installed"
`);
    }
  );

  /**
   * hotspot/alogin.html — what the router shows right after a successful sign-in. MikroTik's stock
   * page ("You are logged in / If nothing happens, click here") reads like something is stuck, and
   * Android keeps its "Sign in to …" window open on it. This one says plainly that the customer is
   * online, shows the time left (the router fills in $(session-time-left)), tells them they can
   * close the window, and then sends the window on to the page they first asked for, which is how
   * Android and iPhone notice the internet works and close their sign-in window by themselves.
   */
  app.get(
    "/:tenantSlug/mikrotik-alogin-template",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const tenant = await resolveTenantBySlug(tenantSlug);
      reply.header("Content-Type", "text/html; charset=utf-8").send(buildAloginPage(tenant.name));
    }
  );

  app.get(
    "/:tenantSlug/mikrotik-login-template",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      await resolveTenantBySlug(tenantSlug); // 404s early for an unknown tenant, same as /info

      const portalBase = (env as any).APP_PORTAL_URL || "https://captive.mashuphost.tech";
      const target =
        `${portalBase}/hotspot/${tenantSlug}` +
        `?mac=$(mac)&ip=$(ip)&link-login-only=$(link-login-only-esc)&link-orig=$(link-orig-esc)&error=$(error-esc)`;

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connecting to Wi-Fi…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #090d16;
      color: #fff;
      text-align: center;
    }
    .box { max-width: 320px; padding: 24px; }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .title { font-size: 16px; font-weight: 700; margin: 0 0 8px; color: #f8fafc; }
    .sub { font-size: 12px; color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p class="title" id="statusTitle">Connecting…</p>
    <p class="sub" id="statusMsg">Directing you to your Wi-Fi portal</p>
    <form name="login" method="post" action="$(link-login-only)" style="display:none;">
      <input type="hidden" name="username" id="formUser" value="$(username)">
      <input type="hidden" name="password" id="formPass" value="$(password)">
      <input type="hidden" name="dst" value="$(link-orig)">
    </form>
  </div>
  <script>
    (function() {
      try {
        var s = window.location.search || '';
        var h = window.location.hash || '';
        var query = s.indexOf('?') !== -1 ? s.substring(1) : (h.indexOf('?') !== -1 ? h.substring(h.indexOf('?') + 1) : '');
        var params = {};
        if (query) {
          var pairs = query.split('&');
          for (var i = 0; i < pairs.length; i++) {
            var idx = pairs[i].indexOf('=');
            if (idx > 0) {
              params[decodeURIComponent(pairs[i].substring(0, idx))] = decodeURIComponent(pairs[i].substring(idx + 1));
            }
          }
        }
        var u = params['username'] || params['user'] || params['code'];
        var p = params['password'] || params['pass'] || u;
        if (u) {
          document.getElementById('statusTitle').innerText = 'Activating Internet…';
          document.getElementById('statusMsg').innerText = 'Authenticating your Wi-Fi access code with the router…';
          document.getElementById('formUser').value = u;
          document.getElementById('formPass').value = p;
          document.forms['login'].submit();
          return;
        }
      } catch (e) {}
      // No credentials in URL — redirect to the hosted captive portal
      window.location.replace("${target}");
    })();
  </script>
  <noscript>
    <meta http-equiv="refresh" content="0;url=${target}">
  </noscript>
</body>
</html>`;

      reply.header("Content-Type", "text/html; charset=utf-8").send(html);
    }
  );

  /**
   * Serves the downloadable 1-line Anti-VPN & Tunnel Shield RouterOS script:
   * /tool fetch url="https://api.mashuphost.tech/api/v1/hotspot/<tenantSlug>/anti-vpn.rsc" dst-path=anti-vpn.rsc; :delay 2s; /import anti-vpn.rsc;
   */
  app.get(
    "/:tenantSlug/anti-vpn.rsc",
    { config: { audience: "customer" }, preHandler: [checkMaintenance] },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      await resolveTenantBySlug(tenantSlug);

      const rsc = `# MASHUPKGRID ISP — Bulletproof Anti-VPN & Tunnel Shield
/ip firewall filter remove [find comment~"MASHUPKGRID ANTI-TUNNEL"]
/ip firewall filter remove [find comment~"MASHUPKGRID ANTI-VPN"]
/ip firewall nat remove [find comment~"MASHUPKGRID ANTI-VPN"]

# 1. DNS Hijack: Force all unauthenticated DNS to router (stops SlowDNS, iodine, dnscat)
/ip firewall nat add chain=dstnat protocol=udp dst-port=53 hotspot=!auth action=redirect to-ports=53 comment="MASHUPKGRID ANTI-VPN"
/ip firewall nat add chain=dstnat protocol=tcp dst-port=53 hotspot=!auth action=redirect to-ports=53 comment="MASHUPKGRID ANTI-VPN"

# 2. Block direct outbound DNS queries (stops bypass attempts)
/ip firewall filter add chain=forward protocol=udp dst-port=53 hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"
/ip firewall filter add chain=forward protocol=tcp dst-port=53 hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 3. Block UDP forwarding completely for unauth (kills WireGuard, OpenVPN UDP, V2Ray UDP, QUIC tunnels)
/ip firewall filter add chain=forward protocol=udp hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 4. Block common VPN & Proxy ports
/ip firewall filter add chain=forward protocol=tcp dst-port=22,1194,3128,8080,8443,8888,51820,9000-65535 hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 5. BLOCK WEBSOCKET TUNNELS (Kills HA Tunnel Plus & HTTP Injector over Cloudflare CDN)
/ip firewall filter add chain=forward protocol=tcp content="websocket" hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"
/ip firewall filter add chain=forward protocol=tcp content="Upgrade: websocket" hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"
/ip firewall filter add chain=forward protocol=tcp content="Sec-WebSocket" hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 6. BLOCK SSH TUNNELS (Kills SSH over port 443/80)
/ip firewall filter add chain=forward protocol=tcp content="SSH-" hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 7. BLOCK HTTP INJECTOR PROXY TUNNELS (Kills HTTP CONNECT proxying)
/ip firewall filter add chain=forward protocol=tcp content="CONNECT " hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 8. LIMIT PERSISTENT DATA TRANSFERS (Captive portal never downloads large continuous data)
# Drops any single unauthenticated connection that transfers more than 3 Megabytes
/ip firewall filter add chain=forward protocol=tcp connection-bytes=3000000-0 hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 9. LIMIT CONCURRENT CONNECTIONS (Stops multi-connection flood tunnels)
/ip firewall filter add chain=forward protocol=tcp hotspot=!auth connection-limit=6,32 action=drop comment="MASHUPKGRID ANTI-VPN"

# 10. BLOCK ICMP TUNNELS
/ip firewall filter add chain=forward protocol=icmp hotspot=!auth action=drop comment="MASHUPKGRID ANTI-VPN"

# 12. MOVE ALL RULES TO TOP OF CHAIN (Crucial: loop each item so RouterOS reliably moves them to position 0)
:foreach i in=[/ip firewall filter find comment~"MASHUPKGRID ANTI-VPN"] do={
  :do {/ip firewall filter move $i destination=0} on-error={}
}
:foreach i in=[/ip firewall nat find comment~"MASHUPKGRID ANTI-VPN"] do={
  :do {/ip firewall nat move $i destination=0} on-error={}
}

:put "========================================================="
:put "  SUCCESS: Bulletproof Anti-VPN Shield is ACTIVE!       "
:put "  Cloudflare WebSocket, SSH & SlowDNS are now BLOCKED.   "
:put "========================================================="
`;

      reply.header("Content-Type", "text/plain; charset=utf-8").send(rsc);
    }
  );

  /**
   * "I paid but I am not online."
   *
   * The single worst moment in a hotspot: the money has left the customer's phone and the network
   * still will not let them on. It happens for reasons entirely outside their control — the
   * browser refused the hand-off to the router, the page was closed while the STK was pending,
   * the phone dropped Wi-Fi mid-payment — and without a way back they are left with a support
   * call, a refund request, or simply a customer who never returns.
   *
   * Identified by something the stranded customer already has: the number they paid from, or the
   * confirmation SMS pasted whole. Both are proof of payment in the only sense that matters here,
   * and neither can be used to fish for someone else's code:
   *
   *   - Only purchases from the LAST 24 HOURS are searchable, so an old number is worthless.
   *   - Only that tenant's own purchases, so one ISP's portal cannot recover another's.
   *   - Rate-limited exactly like login, because it is a public unauthenticated lookup.
   *
   * Returning the code the payer already owns is not a disclosure: they bought it. The receipt
   * number in the SMS is the stronger of the two proofs, since it is unique per transaction.
   */
  app.post(
    "/:tenantSlug/recover",
    {
      config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const body = recoverBodySchema.parse(request.body);
      const tenant = await resolveTenantBySlug(tenantSlug);

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // An M-Pesa confirmation opens with its receipt: "TGH7ABC123 Confirmed. Ksh10.00 sent to…".
      // Ten uppercase alphanumerics is that code's shape, and matching it is far more precise
      // than trying to parse the rest of a message whose wording Safaricom changes.
      const receipt = body.mpesaMessage?.toUpperCase().match(/\b[A-Z0-9]{10}\b/)?.[0];
      const phone = body.phone ? normalizeKenyanPhone(body.phone) : undefined;

      const findCompleted = (match: { mpesaReceiptNumber: string } | { phone: string }) =>
        prisma.mpesaStkRequest.findFirst({
          where: { tenantId: tenant.id, status: "COMPLETED", hotspotVoucherCode: { not: null }, createdAt: { gte: since }, ...match },
          orderBy: { createdAt: "desc" },
          select: { hotspotVoucherCode: true, mpesaReceiptNumber: true, createdAt: true },
        });
      // The receipt first; then the phone number, which also covers a receipt misread from a
      // pasted message or a customer who gave both.
      let stkRequest = receipt ? await findCompleted({ mpesaReceiptNumber: receipt }) : null;
      if (!stkRequest && phone) stkRequest = await findCompleted({ phone });

      // If not yet completed, check if there is a recent PENDING request for this phone.
      // Defensively live-query Safaricom right now to reconcile it on-demand!
      if (!stkRequest && phone) {
        const pendingStk = await prisma.mpesaStkRequest.findFirst({
          where: {
            tenantId: tenant.id,
            // Also a request an older version marked failed on "still under processing".
            OR: [{ status: "PENDING" }, { status: "FAILED", resultCode: STK_STILL_PROCESSING }],
            phone,
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
        });

        if (pendingStk) {
          try {
            const res = await queryAndReconcileStkRequest(tenant.id, pendingStk.checkoutRequestId);
            if (res.request.status === "COMPLETED" && res.request.hotspotVoucherCode) {
              stkRequest = {
                hotspotVoucherCode: res.request.hotspotVoucherCode,
                mpesaReceiptNumber: res.request.mpesaReceiptNumber,
                createdAt: res.request.createdAt,
              };
            }
          } catch {
            // ignore query failure in recovery fallback
          }
        }
      }

      // Paystack and Pesapal purchases live in their own table and are just as strandable.
      const gatewayTransaction = stkRequest
        ? null
        : await prisma.paystackTransaction.findFirst({
            where: {
              tenantId: tenant.id,
              status: "COMPLETED",
              hotspotVoucherCode: { not: null },
              createdAt: { gte: since },
              ...(phone ? { hotspotPhone: phone } : { reference: receipt }),
            },
            orderBy: { createdAt: "desc" },
            select: { hotspotVoucherCode: true, createdAt: true },
          });

      const code = stkRequest?.hotspotVoucherCode ?? gatewayTransaction?.hotspotVoucherCode ?? null;

      if (!code) {
        // Deliberately vague about WHICH part did not match, and identical whether the number is
        // unknown or simply had no purchase — a lookup that confirms "this number paid here" to
        // anyone who asks is a privacy leak, however small.
        throw new NotFoundError(
          "No completed payment found for that in the last 24 hours. Check the number, or paste the M-Pesa confirmation message"
        );
      }

      reply.send(successResponse({ code }, request.id));
    }
  );

  app.post(
    "/:tenantSlug/login",
    {
      config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const { code, mac, disconnectPrevious } = loginBodySchema.parse(request.body);
      const tenant = await resolveTenantBySlug(tenantSlug);

      const voucher = await validateVoucherForLogin(tenant.id, code.trim().toUpperCase());

      if (voucher.status === "EXPIRED") {
        throw new ConflictError("This voucher has expired — please buy a new one");
      }
      if (voucher.status === "USED") {
        throw new ConflictError("This voucher has already been used up");
      }

      const simCheck = await prisma.radCheck.findFirst({
        where: { username: voucher.code, attribute: "Simultaneous-Use" },
      });
      const maxDevices = simCheck ? parseInt(simCheck.value, 10) : (voucher.simultaneousUse || 1);

      if (maxDevices > 0) {
        const sessionNames = await sessionNamesForVoucher(tenant.id, voucher.code);
        const otherDevicesActive = await prisma.radAcct.count({
          where: {
            username: { in: sessionNames },
            acctStopTime: null,
            ...(mac ? { NOT: { callingStationId: mac } } : {}),
          },
        });
        if (otherDevicesActive >= maxDevices) {
          if (disconnectPrevious) {
            await prisma.radAcct.updateMany({
              where: { username: { in: sessionNames }, acctStopTime: null },
              data: { acctStopTime: new Date(), acctTerminateCause: "User-Request" },
            });
          } else {
            throw new ConflictError(
              `Another session is already connected using this voucher. Only ${maxDevices} device allowed at a time.`
            );
          }
        }
      }

      // If MAC is supplied, immediately bind device and activate the voucher!
      // This enables MikroTik's MAC-auth to automatically accept the phone on the next request!
      let activeVoucher = voucher;
      if (mac) {
        try {
          await rememberDevice(tenant.id, mac, voucher.code);
          activeVoucher = await activateVoucher(tenant.id, voucher.code);
        } catch (err) {
          request.log.warn({ err, mac, code: voucher.code }, "Failed to bind MAC to voucher during login");
        }
      }

      reply.send(
        successResponse(
          {
            status: activeVoucher.status,
            expiresAt: activeVoucher.expiresAt,
            durationMinutes: activeVoucher.durationMinutes,
            dataCapMb: activeVoucher.dataCapMb,
          },
          request.id
        )
      );
    }
  );

  /** An existing subscriber logging into the hotspot with their normal PPPoE/RADIUS account —
   *  no voucher purchase needed. Their credentials already work for RADIUS auth at the router's
   *  own hotspot login form (same radcheck row PPPoE uses); this endpoint only confirms them
   *  and gives the captive-portal page something to show, mirroring the voucher flow above. */
  app.post(
    "/:tenantSlug/account-login",
    {
      config: { audience: "customer", rateLimit: hotspotLoginRateLimitConfig },
      preHandler: [checkMaintenance],
    },
    async (request, reply) => {
      const { tenantSlug } = tenantParamsSchema.parse(request.params);
      const { phone, password } = accountLoginBodySchema.parse(request.body);
      const tenant = await resolveTenantBySlug(tenantSlug);

      const radiusUser = await authenticateHotspotAccount(tenant.id, phone, password);

      reply.send(successResponse({ username: radiusUser.username }, request.id));
    }
  );
}
