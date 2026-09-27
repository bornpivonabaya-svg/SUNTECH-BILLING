import { z } from "zod";

/**
 * Shared queue-name and job-payload contract between `apps/api` (producer) and `apps/worker`
 * (consumer) — both import from here so the payload shape can never drift between enqueue and
 * process (docs/architecture/05-maintenance-and-queues.md).
 */
export const QUEUE_NAMES = {
  email: "email",
  maintenance: "maintenance",
  cleanup: "cleanup",
  billing: "billing",
  mpesa: "mpesa",
  network: "network",
  webhooks: "webhooks",
  whatsapp: "whatsapp",
} as const;

export const sendVerificationEmailJobSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  verificationToken: z.string(),
});
export type SendVerificationEmailJob = z.infer<typeof sendVerificationEmailJobSchema>;

export const sendPasswordResetEmailJobSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  resetToken: z.string(),
});
export type SendPasswordResetEmailJob = z.infer<typeof sendPasswordResetEmailJobSchema>;

export const sendPaymentConfirmationEmailJobSchema = z.object({
  email: z.string().email(),
  customerName: z.string(),
  amountMinor: z.number().int(),
  receiptNumber: z.string(),
  /** Lets the worker find the payment and attach a receipt PDF. Optional for jobs queued
   *  before this existed. */
  tenantId: z.string().uuid().optional(),
});
export type SendPaymentConfirmationEmailJob = z.infer<typeof sendPaymentConfirmationEmailJobSchema>;

/** Which moment of onboarding this message marks. A self-registered ISP is PENDING_APPROVAL
 *  until a super admin approves it, and telling them "you're live, here's your dashboard" at
 *  registration, before they can sign in, is what "pending" avoids; "approved" is the real
 *  welcome with the working links; "rejected" says so, with the reason. */
export const tenantOnboardingStageSchema = z.enum(["pending", "approved", "rejected"]);
export type TenantOnboardingStage = z.infer<typeof tenantOnboardingStageSchema>;

export const sendTenantWelcomeEmailJobSchema = z.object({
  email: z.string().email(),
  ownerName: z.string(),
  companyName: z.string(),
  subdomain: z.string(),
  dashboardUrl: z.string(),
  portalUrl: z.string(),
  temporaryPassword: z.string().optional(),
  stage: tenantOnboardingStageSchema.default("approved"),
  /** Only for "rejected": what the applicant is told. */
  reason: z.string().max(500).optional(),
});
// z.input, not z.infer: `stage` has a default, so producers may omit it while the worker's parse fills it.
export type SendTenantWelcomeEmailJob = z.input<typeof sendTenantWelcomeEmailJobSchema>;

export const sendEmailOtpJobSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  purpose: z.string(),
});
export type SendEmailOtpJob = z.infer<typeof sendEmailOtpJobSchema>;

/** Emails one invoice to its customer — a staff "Email invoice" click. The scheduled
 *  `sendPendingInvoiceEmails` job needs no payload: it finds what has not been sent yet. */
export const sendInvoiceEmailJobSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});
export type SendInvoiceEmailJob = z.infer<typeof sendInvoiceEmailJobSchema>;

/** A message staff wrote to one customer, on the channels they chose. Sent by the worker so a
 *  slow SMS gateway or mail server never holds up the dashboard request. */
export const sendCustomerMessageJobSchema = z.object({
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  channels: z.array(z.enum(["EMAIL", "SMS"])).min(1),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(2000),
  sentByUserId: z.string().uuid(),
});
export type SendCustomerMessageJob = z.infer<typeof sendCustomerMessageJobSchema>;

export const applyScheduledMaintenanceJobSchema = z.object({});
export type ApplyScheduledMaintenanceJob = z.infer<typeof applyScheduledMaintenanceJobSchema>;

export const cleanupExpiredTokensJobSchema = z.object({});
export type CleanupExpiredTokensJob = z.infer<typeof cleanupExpiredTokensJobSchema>;

/** `code` travels as plaintext here (worker -> WhatsApp) since the worker is the only place
 *  that actually has to speak it to the user — the API process that enqueues this never persists
 *  the plaintext itself, only its hash (see apps/api's whatsapp-otp.ts), matching how
 *  emailVerificationToken/passwordResetToken already only ever store a hash. */
export const sendWhatsappOtpJobSchema = z.object({
  /** Which tenant's WhatsApp session sends this. Null for platform-level messages that belong to
   *  no particular ISP — notably ISP-registration OTPs, which are sent *before* the tenant that
   *  would own a session exists at all. */
  tenantId: z.string().uuid().nullable(),
  phone: z.string(),
  code: z.string().length(6),
});
export type SendWhatsappOtpJob = z.infer<typeof sendWhatsappOtpJobSchema>;

/** Sent to a hotspot customer the moment their payment completes — their voucher code plus a
 *  thank-you branded with the ISP's own company name (never this platform's), since to that
 *  customer the ISP *is* the brand they bought from. */
export const sendWhatsappVoucherJobSchema = z.object({
  tenantId: z.string().uuid(),
  phone: z.string(),
  voucherCode: z.string(),
  /** The tenant's (ISP's) company name — what the customer actually recognizes. */
  tenantName: z.string(),
  packageName: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  durationMinutes: z.number().int().nullable(),
  dataCapMb: z.number().int().nullable(),
});
export type SendWhatsappVoucherJob = z.infer<typeof sendWhatsappVoucherJobSchema>;

/** A hotspot voucher emailed to whoever bought it (or asked for it on the success screen). The
 *  worker reads the voucher and the ISP from the database, so the job carries only what to find. */
export const sendHotspotVoucherEmailJobSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  voucherCode: z.string().min(1).max(64),
});
export type SendHotspotVoucherEmailJob = z.infer<typeof sendHotspotVoucherEmailJobSchema>;

/** Sent to a new ISP owner right after their tenant is created. Deliberately carries the
 *  username but NOT the password — see the handler for why that line is drawn here. */
export const sendWhatsappTenantWelcomeJobSchema = z.object({
  /** Null like the OTP above: a brand-new ISP has not linked a WhatsApp account yet, so their
   *  own welcome message can only go out over the platform session. */
  tenantId: z.string().uuid().nullable(),
  phone: z.string(),
  ownerName: z.string(),
  companyName: z.string(),
  username: z.string(),
  dashboardUrl: z.string(),
  portalUrl: z.string(),
  stage: tenantOnboardingStageSchema.default("approved"),
  reason: z.string().max(500).optional(),
});
export type SendWhatsappTenantWelcomeJob = z.input<typeof sendWhatsappTenantWelcomeJobSchema>;

/**
 * Tells a subscriber what just happened to their internet (spec section 20). Sent only AFTER a
 * provisioning job reached a terminal state, so the message reflects what a device actually did
 * rather than what was intended — telling someone "your internet is active" while the router
 * rejected the configuration is worse than saying nothing.
 */
export const sendWhatsappServiceStatusJobSchema = z.object({
  tenantId: z.string().uuid(),
  phone: z.string(),
  customerName: z.string(),
  /** The ISP's own company name. The customer buys from them, not from this platform. */
  tenantName: z.string(),
  event: z.enum(["ACTIVATED", "SUSPENDED", "RESTORED", "DEPROVISIONED", "FAILED"]),
  packageName: z.string().nullable(),
  downloadKbps: z.number().int().nullable(),
  uploadKbps: z.number().int().nullable(),
  /** Support contact for a FAILED event, where the customer needs a human, not a status line. */
  supportPhone: z.string().nullable(),
});
export type SendWhatsappServiceStatusJob = z.infer<typeof sendWhatsappServiceStatusJobSchema>;

/** Pairing is driven from the dashboard but can only happen in the worker (the only process that
 *  holds WhatsApp sockets), so the API asks for it through the queue rather than doing it. */
export const whatsappConnectJobSchema = z.object({
  tenantId: z.string().uuid().nullable(),
  /** When present, pair by typing a code into WhatsApp instead of scanning a QR. E.164 with or
   *  without the leading "+"; the session manager strips everything but the digits. */
  pairWithPhoneNumber: z.string().min(8).max(20).optional(),
});
export type WhatsappConnectJob = z.infer<typeof whatsappConnectJobSchema>;

export const whatsappDisconnectJobSchema = z.object({ tenantId: z.string().uuid().nullable() });
export type WhatsappDisconnectJob = z.infer<typeof whatsappDisconnectJobSchema>;

/** Sends an arbitrary text message from a tenant's WhatsApp socket — used by the dashboard's
 *  bot-testing panel so operators can interact with the self-service menu as if they were a
 *  customer, without needing a second phone. */
export const whatsappTestMessageJobSchema = z.object({
  tenantId: z.string().uuid().nullable(),
  phone: z.string().min(8).max(20),
  text: z.string().min(1).max(2000),
});
export type WhatsappTestMessageJob = z.infer<typeof whatsappTestMessageJobSchema>;

export const deliverWebhookEventJobSchema = z.object({
  webhookEndpointId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
});
export type DeliverWebhookEventJob = z.infer<typeof deliverWebhookEventJobSchema>;

export const JOB_NAMES = {
  runTenantPayouts: "run-tenant-payouts",
  sendVerificationEmail: "send-verification-email",
  sendPasswordResetEmail: "send-password-reset-email",
  sendPaymentConfirmationEmail: "send-payment-confirmation-email",
  sendHotspotVoucherEmail: "send-hotspot-voucher-email",
  applyScheduledMaintenance: "apply-scheduled-maintenance",
  cleanupExpiredTokens: "cleanup-expired-tokens",
  // Phase 2 — core ISP billing (docs/architecture/09-phase2-plan.md). Each is CRITICAL-adjacent
  // (financial state) so the worker runs them regardless of maintenance level, same as
  // apply-scheduled-maintenance.
  generateInvoices: "generate-invoices",
  markOverdueInvoices: "mark-overdue-invoices",
  suspendOverdueCustomers: "suspend-overdue-customers",
  reactivateClearedCustomers: "reactivate-cleared-customers",
  // Trial lifecycle — same billing queue/cadence as customer suspension, since it's the same
  // shape of concern one level up (tenant, not customer).
  expireTrials: "expire-trials",
  // Phase 3 — M-Pesa (docs/architecture/10-phase3-plan.md).
  pollPendingStkRequests: "poll-pending-stk-requests",
  // Phase 4 — network/MikroTik/RADIUS (docs/architecture/13-phase4-plan.md).
  retryPendingSyncTasks: "retry-pending-sync-tasks",
  runProvisioningJobs: "run-provisioning-jobs",
  pollRouterHealth: "poll-router-health",
  pushLargePayments: "push-large-payments",
  suggestUpgrades: "suggest-upgrades",
  networkMaintenanceNotices: "network-maintenance-notices",
  referralRewards: "referral-rewards",
  routerRollouts: "router-rollouts",
  routerBackups: "router-backups",
  autoRouterUpdates: "auto-router-updates",
  resumePausedPlans: "resume-paused-plans",
  sweepAddOns: "sweep-addons",
  retryPendingVlans: "retry-pending-vlans",
  checkPendingDomains: "check-pending-domains",
  winBackOffers: "win-back-offers",
  sendCampaigns: "send-campaigns",
  expireOverdueVouchers: "expire-overdue-vouchers",
  // Dunning — escalating payment reminders ahead of suspendOverdueCustomers, not just the
  // status flip itself.
  sendDueSoonReminders: "send-due-soon-reminders",
  sendOverdueNotices: "send-overdue-notices",
  sendFinalDunningNotices: "send-final-dunning-notices",
  // Developer platform — outbound webhook delivery, one job per (endpoint, event) pair, enqueued
  // by the API and consumed by the worker so a slow/unreachable third-party endpoint can never
  // add latency to the request that triggered the event.
  deliverWebhookEvent: "deliver-webhook-event",
  sendWhatsappOtp: "send-whatsapp-otp",
  sendWhatsappVoucher: "send-whatsapp-voucher",
  sendWhatsappTenantWelcome: "send-whatsapp-tenant-welcome",
  sendWhatsappServiceStatus: "send-whatsapp-service-status",
  whatsappConnect: "whatsapp-connect",
  whatsappDisconnect: "whatsapp-disconnect",
  whatsappTestMessage: "whatsapp-test-message",
  sendTenantWelcomeEmail: "send-tenant-welcome-email",
  sendEmailOtp: "send-email-otp",
  // Customer communication: invoices go out on their own; staff can also message a customer.
  sendInvoiceEmail: "send-invoice-email",
  sendPendingInvoiceEmails: "send-pending-invoice-emails",
  sendCustomerMessage: "send-customer-message",
} as const;

/** Webhook event types a tenant can subscribe an endpoint to. Kept in `shared` (not just the API)
 *  so the worker's delivery job and any future consumer validate against the same catalog. Only
 *  events actually emitted somewhere in apps/api belong here — see the `emitWebhookEvent` call
 *  sites for where each one fires. */
export const WEBHOOK_EVENT_TYPES = ["customer.created", "payment.received"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
