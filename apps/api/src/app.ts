import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { env, isDevelopment, isProduction } from "@mashupkgrid/config";
import "./types.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerSecurity } from "./plugins/security.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerRawBodyCapture } from "./plugins/raw-body.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { sessionRoutes } from "./routes/sessions.js";
import { tenantRoutes } from "./routes/tenants.js";
import { rbacRoutes } from "./routes/rbac.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { auditLogRoutes } from "./routes/audit-logs.js";
import { customerRoutes } from "./routes/customers.js";
import { packageRoutes } from "./routes/packages.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { paymentRoutes } from "./routes/payments.js";
import { walletRoutes } from "./routes/wallet.js";
import { reportRoutes } from "./routes/reports.js";
import { mpesaRoutes } from "./routes/mpesa.js";
import { routerRoutes } from "./routes/routers.js";
import { ipPoolRoutes } from "./routes/ip-pools.js";
import { vlanRoutes } from "./routes/vlans.js";
import { provisioningRoutes } from "./routes/provisioning.js";
import { radiusUserRoutes } from "./routes/radius-users.js";
import { voucherRoutes } from "./routes/vouchers.js";
import { settingsRoutes } from "./routes/settings.js";
import { meRoutes } from "./routes/me.js";
import { hotspotRoutes } from "./routes/hotspot.js";
import { smsRoutes } from "./routes/sms.js";
import { paystackRoutes } from "./routes/paystack.js";
import { pesapalRoutes } from "./routes/pesapal.js";
import { developerRoutes } from "./routes/developer.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { aiAssistantRoutes } from "./routes/ai-assistant.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { ticketRoutes } from "./routes/tickets.js";
import { announcementRoutes } from "./routes/announcements.js";
import { domainRoutes } from "./routes/domains.js";
import { statusRoutes } from "./routes/status.js";
import { branchRoutes } from "./routes/branches.js";
import { pushRoutes } from "./routes/push.js";
import { upgradeRoutes } from "./routes/upgrades.js";
import { networkMaintenanceRoutes } from "./routes/network-maintenance.js";
import { referralRoutes } from "./routes/referrals.js";
import { jobRoutes } from "./routes/jobs.js";
import { routerUpdateRoutes } from "./routes/router-updates.js";
import { routerBackupRoutes } from "./routes/router-backups.js";
import { routerHealthRoutes } from "./routes/router-health.js";
import { activationRoutes } from "./routes/activation.js";
import { customerMemberRoutes } from "./routes/customer-members.js";
import { addOnRoutes } from "./routes/addons.js";
import { winBackRoutes } from "./routes/win-back.js";
import { agentRoutes } from "./routes/agents.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { leadRoutes } from "./routes/leads.js";
import { mfaRoutes } from "./routes/mfa.js";
import { accountingRoutes } from "./routes/accounting.js";
import { tenantWalledGardenRoutes } from "./routes/tenant-walled-garden.js";
import { planRoutes, publicConfigRoutes, publicPlanRoutes } from "./routes/plans.js";
import { tenantBillingRoutes } from "./routes/tenant-billing.js";
import { landingContentRoutes } from "./routes/landing-content.js";
import { customerPortalRoutes } from "./routes/customer-portal.js";
import { productRoutes } from "./routes/products.js";
import { platformPaymentRoutes } from "./routes/platform-payments.js";
import { tenantPaymentRoutes } from "./routes/tenant-payments.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { automationRoutes } from "./routes/automation.js";
import { platformWalledGardenRoutes } from "./routes/platform-walled-garden.js";
import { radiusSessionRoutes } from "./routes/radius-sessions.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    logger: isDevelopment
      ? { transport: { target: "pino-pretty" }, level: "info" }
      : { level: "info" },
    trustProxy: env.TRUST_PROXY,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", request.id);
    return payload;
  });

  // Middleware order per docs/architecture/00-overview.md §4:
  // request id (above) -> security headers -> rate limiting -> auth -> tenant resolution ->
  // maintenance check -> authorization -> validation -> controller. Auth/tenant/maintenance/
  // authorization are applied per-route (via preHandler arrays) rather than globally, since
  // public routes like /health and /auth/login must skip the auth step itself.
  await registerSecurity(app);
  await app.register(cookie);
  await registerRateLimit(app);
  registerErrorHandler(app);
  registerRawBodyCapture(app);

  app.get("/", async (_request, reply) => {
    reply.send({
      success: true,
      data: {
        name: "MASHUPKGRID ISP Platform API",
        status: "OPERATIONAL",
        version: "1.0.0",
      },
    });
  });

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(sessionRoutes, { prefix: "/api/v1/sessions" });
  await app.register(tenantRoutes, { prefix: "/api/v1/platform/tenants" });
  await app.register(rbacRoutes, { prefix: "/api/v1/rbac" });
  await app.register(maintenanceRoutes, { prefix: "/api/v1/platform/maintenance" });
  await app.register(auditLogRoutes, { prefix: "/api/v1/audit-logs" });
  await app.register(customerRoutes, { prefix: "/api/v1/customers" });
  await app.register(packageRoutes, { prefix: "/api/v1/packages" });
  await app.register(subscriptionRoutes, { prefix: "/api/v1/subscriptions" });
  await app.register(invoiceRoutes, { prefix: "/api/v1/invoices" });
  await app.register(paymentRoutes, { prefix: "/api/v1/payments" });
  await app.register(walletRoutes, { prefix: "/api/v1/wallets" });
  await app.register(reportRoutes, { prefix: "/api/v1/reports" });
  await app.register(mpesaRoutes, { prefix: "/api/v1/payments/mpesa" });
  await app.register(routerRoutes, { prefix: "/api/v1/routers" });
  await app.register(ipPoolRoutes, { prefix: "/api/v1/ip-pools" });
  await app.register(vlanRoutes, { prefix: "/api/v1/vlans" });
  await app.register(provisioningRoutes, { prefix: "/api/v1/provisioning" });
  await app.register(radiusUserRoutes, { prefix: "/api/v1/radius/users" });
  await app.register(radiusSessionRoutes, { prefix: "/api/v1/radius/sessions" });
  await app.register(voucherRoutes, { prefix: "/api/v1/vouchers" });
  await app.register(settingsRoutes, { prefix: "/api/v1/settings" });
  await app.register(meRoutes, { prefix: "/api/v1/me" });
  await app.register(hotspotRoutes, { prefix: "/api/v1/hotspot" });
  await app.register(smsRoutes, { prefix: "/api/v1/sms" });
  await app.register(paystackRoutes, { prefix: "/api/v1/payments/paystack" });
  await app.register(pesapalRoutes, { prefix: "/api/v1/payments/pesapal" });
  await app.register(developerRoutes, { prefix: "/api/v1/developer" });
  await app.register(onboardingRoutes, { prefix: "/api/v1/onboarding" });
  await app.register(aiAssistantRoutes, { prefix: "/api/v1/ai-assistant" });
  await app.register(whatsappRoutes, { prefix: "/api/v1/whatsapp" });
  await app.register(ticketRoutes, { prefix: "/api/v1/tickets" });
  await app.register(announcementRoutes, { prefix: "/api/v1/announcements" });
  await app.register(domainRoutes, { prefix: "/api/v1/domains" });
  await app.register(statusRoutes, { prefix: "/api/v1/status" });
  await app.register(branchRoutes, { prefix: "/api/v1/branches" });
  await app.register(pushRoutes, { prefix: "/api/v1/push" });
  await app.register(upgradeRoutes, { prefix: "/api/v1/upgrades" });
  await app.register(networkMaintenanceRoutes, { prefix: "/api/v1/network-maintenance" });
  await app.register(referralRoutes, { prefix: "/api/v1/referrals" });
  await app.register(jobRoutes, { prefix: "/api/v1/jobs" });
  await app.register(routerUpdateRoutes, { prefix: "/api/v1/router-updates" });
  await app.register(routerBackupRoutes, { prefix: "/api/v1/router-backups" });
  await app.register(routerHealthRoutes, { prefix: "/api/v1/router-health" });
  await app.register(activationRoutes, { prefix: "/api/v1" });
  await app.register(customerMemberRoutes, { prefix: "/api/v1" });
  await app.register(addOnRoutes, { prefix: "/api/v1/addons" });
  await app.register(winBackRoutes, { prefix: "/api/v1/win-back" });
  await app.register(agentRoutes, { prefix: "/api/v1" });
  await app.register(campaignRoutes, { prefix: "/api/v1/campaigns" });
  await app.register(leadRoutes, { prefix: "/api/v1" });
  await app.register(mfaRoutes, { prefix: "/api/v1/auth/mfa" });
  await app.register(accountingRoutes, { prefix: "/api/v1/accounting" });
  await app.register(tenantWalledGardenRoutes, { prefix: "/api/v1/walled-garden" });
  await app.register(planRoutes, { prefix: "/api/v1/platform/plans" });
  await app.register(publicPlanRoutes, { prefix: "/api/v1/public/plans" });
  await app.register(publicConfigRoutes, { prefix: "/api/v1/public/config" });
  await app.register(tenantBillingRoutes, { prefix: "/api/v1/billing" });
  await app.register(landingContentRoutes, { prefix: "/api/v1/landing-content" });
  await app.register(productRoutes, { prefix: "/api/v1/products" });
  await app.register(platformPaymentRoutes, { prefix: "/api/v1/platform/payments" });
  await app.register(tenantPaymentRoutes, { prefix: "/api/v1/tenant-payments" });
  await app.register(checkoutRoutes, { prefix: "/api/v1/pay" });
  await app.register(automationRoutes, { prefix: "/api/v1/automation" });
  await app.register(platformWalledGardenRoutes, { prefix: "/api/v1/platform/walled-garden" });
  // apps/api/src/routes/customer-portal.ts is still an unimplemented demo surface: it serves one
  // hardcoded customer's details to any caller, accepts "123456" (and, before the fix in that
  // file, literally any 4+ character string) as a phone OTP, hands back a fabricated
  // `portal_jwt_mock_token_<timestamp>` that nothing ever verifies, and reports every payment as
  // SUCCESS without touching a payment provider. Mounted in production that is an unauthenticated
  // data-disclosure and free-service bug, not a stub. It stays available in development so the
  // FiberConnect client can keep being built against it, and is refused outright in production
  // until it is backed by real auth and real payments.
  if (isProduction) {
    app.log.warn(
      "[SECURITY] /api/v1/portal (customer super-app demo routes) is NOT mounted in production — " +
        "it is mock-only: hardcoded OTP, fabricated session token, and always-SUCCESS payment status. " +
        "Implement it against real auth/payments before serving it to customers."
    );
  } else {
    await app.register(customerPortalRoutes, { prefix: "/api/v1/portal" });
  }

  return app;
}

export function getPort(): number {
  return env.API_PORT;
}
