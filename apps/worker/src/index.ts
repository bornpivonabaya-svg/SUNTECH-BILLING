import { retryPendingVlans } from "@mashupkgrid/radius";
import { handleRunProvisioningJobs } from "./jobs/run-provisioning-jobs.js";
import { Worker, Queue } from "bullmq";
import { env } from "@mashupkgrid/config";
import { QUEUE_NAMES, JOB_NAMES, AUTOMATION_JOBS, type AutomationSummary } from "@mashupkgrid/shared";
import { handleSendVerificationEmail } from "./jobs/send-verification-email.js";
import { handleSendPasswordResetEmail } from "./jobs/send-password-reset-email.js";
import { handleSendPaymentConfirmationEmail } from "./jobs/send-payment-confirmation-email.js";
import { handleSendTenantWelcomeEmail } from "./jobs/send-tenant-welcome-email.js";
import { handleSendEmailOtp } from "./jobs/send-email-otp.js";
import { handleSendInvoiceEmail, handleSendPendingInvoiceEmails } from "./jobs/invoice-email.js";
import { handleSendCustomerMessage } from "./jobs/customer-message.js";
import { handleApplyScheduledMaintenance } from "./jobs/apply-scheduled-maintenance.js";
import { handleCleanupExpiredTokens } from "./jobs/cleanup-expired-tokens.js";
import {
  handleGenerateInvoices,
  handleMarkOverdueInvoices,
  handleSuspendOverdueCustomers,
  handleReactivateClearedCustomers,
} from "./jobs/billing-cycle.js";
import { handleExpireTrials } from "./jobs/expire-trials.js";
import { handlePollPendingStkRequests } from "./jobs/poll-pending-stk-requests.js";
import {
  handleRetryPendingSyncTasks,
  handleExpireOverdueVouchers,
  handlePollRouterHealth,
} from "./jobs/network-sync.js";
import {
  handleSendDueSoonReminders,
  handleSendOverdueNotices,
  handleSendFinalDunningNotices,
} from "./jobs/dunning.js";
import { handleDeliverWebhook } from "./jobs/deliver-webhook.js";
import { handlePushLargePayments } from "./jobs/push-large-payments.js";
import { handleSuggestUpgrades } from "./jobs/suggest-upgrades.js";
import { handleReferralRewards } from "./jobs/referral-rewards.js";
import { handleResumePausedPlans } from "./jobs/resume-paused-plans.js";
import { handleSweepAddOns } from "./jobs/addons.js";
import { handleWinBackOffers } from "./jobs/win-back.js";
import { handleSendCampaigns } from "./jobs/campaigns.js";
import { handleRouterRollouts } from "./jobs/router-rollouts.js";
import { handleRouterBackups } from "./jobs/router-backups.js";
import { handleAutoRouterUpdates } from "./jobs/auto-router-updates.js";
import { handleNetworkMaintenanceNotices } from "./jobs/network-maintenance-notices.js";
import { handleRunTenantPayouts } from "./jobs/tenant-payouts.js";
import { handleSendWhatsappOtp } from "./jobs/send-whatsapp-otp.js";
import {
  handleSendWhatsappVoucher,
  handleSendWhatsappTenantWelcome,
  handleSendWhatsappServiceStatus,
} from "./jobs/whatsapp-notifications.js";
import { createGracefulShutdown } from "./lib/shutdown.js";
import { recordJobRun, startWorkerHeartbeat, triggerOf } from "./lib/job-runs.js";
import { startRadiusServer } from "@mashupkgrid/radius";
import { startWinboxRelay, loadWinboxRelayTargets } from "@mashupkgrid/network";
import { whatsappConnectJobSchema, whatsappDisconnectJobSchema, whatsappTestMessageJobSchema } from "@mashupkgrid/shared";
import { setConnectionStatus, clearPairingQr, pushTestChatMessage } from "@mashupkgrid/whatsapp";
import { startWhatsAppRuntime, getManager } from "./lib/whatsapp-runtime.js";

const connection = { url: env.REDIS_URL };

/** Runs a scheduled handler and leaves its run record for the dashboard's automation page. */
function scheduled(jobName: string, data: unknown, handler: () => Promise<AutomationSummary | void>): Promise<AutomationSummary> {
  return recordJobRun(jobName, triggerOf(data), handler);
}

async function main() {
  const stopHeartbeat = startWorkerHeartbeat();

  const emailWorker = new Worker(
    QUEUE_NAMES.email,
    async (job) => {
      switch (job.name) {
        case JOB_NAMES.sendVerificationEmail:
          return handleSendVerificationEmail(job.data);
        case JOB_NAMES.sendPasswordResetEmail:
          return handleSendPasswordResetEmail(job.data);
        case JOB_NAMES.sendPaymentConfirmationEmail:
          return handleSendPaymentConfirmationEmail(job.data);
        case JOB_NAMES.sendTenantWelcomeEmail:
          return handleSendTenantWelcomeEmail(job.data);
        case JOB_NAMES.sendEmailOtp:
          return handleSendEmailOtp(job.data);
        case JOB_NAMES.sendInvoiceEmail:
          return handleSendInvoiceEmail(job.data);
        case JOB_NAMES.sendCustomerMessage:
          return handleSendCustomerMessage(job.data);
        case JOB_NAMES.sendPendingInvoiceEmails:
          return scheduled(job.name, job.data, handleSendPendingInvoiceEmails);
        default:
          throw new Error(`Unknown job in queue "${QUEUE_NAMES.email}": ${job.name}`);
      }
    },
    { connection, concurrency: env.WORKER_CONCURRENCY }
  );

  const maintenanceWorker = new Worker(
    QUEUE_NAMES.maintenance,
    async (job) => {
      if (job.name === JOB_NAMES.applyScheduledMaintenance) {
        return scheduled(job.name, job.data, handleApplyScheduledMaintenance);
      }
      throw new Error(`Unknown job in queue "${QUEUE_NAMES.maintenance}": ${job.name}`);
    },
    { connection, concurrency: 1 }
  );

  const cleanupWorker = new Worker(
    QUEUE_NAMES.cleanup,
    async (job) => {
      if (job.name === JOB_NAMES.cleanupExpiredTokens) {
        return scheduled(job.name, job.data, handleCleanupExpiredTokens);
      }
      throw new Error(`Unknown job in queue "${QUEUE_NAMES.cleanup}": ${job.name}`);
    },
    { connection, concurrency: 1 }
  );

  const billingWorker = new Worker(
    QUEUE_NAMES.billing,
    async (job) => {
      const run = (handler: () => Promise<AutomationSummary | void>) => scheduled(job.name, job.data, handler);
      switch (job.name) {
        case JOB_NAMES.generateInvoices:
          return run(handleGenerateInvoices);
        case JOB_NAMES.markOverdueInvoices:
          return run(handleMarkOverdueInvoices);
        case JOB_NAMES.suspendOverdueCustomers:
          return run(handleSuspendOverdueCustomers);
        case JOB_NAMES.reactivateClearedCustomers:
          return run(handleReactivateClearedCustomers);
        case JOB_NAMES.sendDueSoonReminders:
          return run(handleSendDueSoonReminders);
        case JOB_NAMES.sendOverdueNotices:
          return run(handleSendOverdueNotices);
        case JOB_NAMES.sendFinalDunningNotices:
          return run(handleSendFinalDunningNotices);
        case JOB_NAMES.runTenantPayouts:
          return run(handleRunTenantPayouts);
        case JOB_NAMES.expireTrials:
          return run(handleExpireTrials);
        case JOB_NAMES.suggestUpgrades:
          return run(handleSuggestUpgrades);
        case JOB_NAMES.referralRewards:
          return run(handleReferralRewards);
        case JOB_NAMES.resumePausedPlans:
          return run(handleResumePausedPlans);
        case JOB_NAMES.sweepAddOns:
          return run(handleSweepAddOns);
        case JOB_NAMES.winBackOffers:
          return run(handleWinBackOffers);
        case JOB_NAMES.sendCampaigns:
          return run(handleSendCampaigns);
        default:
          throw new Error(`Unknown job in queue "${QUEUE_NAMES.billing}": ${job.name}`);
      }
    },
    // concurrency 1: billing-cycle jobs mutate shared financial state (invoices, subscription
    // status) without row locking — see the concurrency note in
    // packages/billing/src/billing-cycle.service.ts.
    { connection, concurrency: 1 }
  );

  const mpesaWorker = new Worker(
    QUEUE_NAMES.mpesa,
    async (job) => {
      if (job.name === JOB_NAMES.pollPendingStkRequests) {
        return scheduled(job.name, job.data, handlePollPendingStkRequests);
      }
      if (job.name === JOB_NAMES.pushLargePayments) {
        return scheduled(job.name, job.data, handlePushLargePayments);
      }
      throw new Error(`Unknown job in queue "${QUEUE_NAMES.mpesa}": ${job.name}`);
    },
    { connection, concurrency: 1 }
  );

  const networkWorker = new Worker(
    QUEUE_NAMES.network,
    async (job) => {
      const run = (handler: () => Promise<AutomationSummary | void>) => scheduled(job.name, job.data, handler);
      switch (job.name) {
        case JOB_NAMES.retryPendingSyncTasks:
          return run(handleRetryPendingSyncTasks);
        case JOB_NAMES.runProvisioningJobs:
          return run(async () => ({ ...(await handleRunProvisioningJobs()) }));
        case JOB_NAMES.expireOverdueVouchers:
          return run(handleExpireOverdueVouchers);
        case JOB_NAMES.pollRouterHealth:
          return run(handlePollRouterHealth);
        case JOB_NAMES.retryPendingVlans:
          return run(retryPendingVlans);
        case JOB_NAMES.networkMaintenanceNotices:
          return run(handleNetworkMaintenanceNotices);
        case JOB_NAMES.routerRollouts:
          return run(handleRouterRollouts);
        case JOB_NAMES.routerBackups:
          return run(handleRouterBackups);
        case JOB_NAMES.autoRouterUpdates:
          return run(handleAutoRouterUpdates);
        default:
          throw new Error(`Unknown job in queue "${QUEUE_NAMES.network}": ${job.name}`);
      }
    },
    // concurrency 1: router polling opens real TCP sockets to routers one at a time rather than
    // stampeding every router on the platform at once.
    { connection, concurrency: 1 }
  );

  const webhooksWorker = new Worker(
    QUEUE_NAMES.webhooks,
    async (job) => {
      if (job.name === JOB_NAMES.deliverWebhookEvent) {
        return handleDeliverWebhook(job.data);
      }
      throw new Error(`Unknown job in queue "${QUEUE_NAMES.webhooks}": ${job.name}`);
    },
    // Outbound HTTP to arbitrary third-party endpoints — a few concurrent deliveries in flight
    // is fine, unlike router polling which deliberately serializes against real hardware.
    { connection, concurrency: 5 }
  );

  for (const worker of [
    emailWorker,
    maintenanceWorker,
    cleanupWorker,
    billingWorker,
    mpesaWorker,
    networkWorker,
    webhooksWorker,
  ]) {
    worker.on("failed", (job, err) => {
      console.error(`[worker] job ${job?.queueName}/${job?.name} (${job?.id}) failed:`, err);
    });
    worker.on("completed", (job) => {
      console.log(`[worker] job ${job.queueName}/${job.name} (${job.id}) completed`);
    });
  }

  // Repeatable jobs: the scheduler. Every interval lives in packages/shared's AUTOMATION_JOBS,
  // which is also what the API and the dashboard's automation page read — a job cannot be
  // listed there without being scheduled here, or the other way round. The rationale for each
  // cadence is documented on its catalog entry; the short version:
  // - apply-scheduled-maintenance every minute (CRITICAL: it is what turns maintenance back off).
  // - billing, dunning and trial expiry hourly: DAILY-billing packages need finer than daily,
  //   and every stage is idempotent so a tick with nothing due is a no-op.
  // - settlements every 5 minutes; INSTANT batches per tick (one transfer fee per tenant).
  // - STK polling every 2 minutes covers a lost callback without hammering Safaricom.
  // - provisioning every 20s: this is the delay between paying and getting back online.
  // - router health every 30s, not 10: each poll is a full API login, and a small hAP was
  //   measurably loaded at 10s. Liveness also comes from the router's own 1-minute heartbeat.
  //
  // BullMQ keys a repeatable job by its interval, so changing `everyMs` would add a second
  // schedule beside the old one instead of replacing it. Any schedule for a catalog job at an
  // interval the catalog no longer specifies is dropped first.
  const queues = new Map<string, Queue>();
  const queueFor = (name: string): Queue => {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection });
      queues.set(name, queue);
    }
    return queue;
  };
  for (const queueName of new Set(AUTOMATION_JOBS.map((job) => job.queue))) {
    const queue = queueFor(queueName);
    for (const existing of await queue.getRepeatableJobs()) {
      const definition = AUTOMATION_JOBS.find((job) => job.name === existing.name && job.queue === queueName);
      if (definition && Number(existing.every) !== definition.everyMs) {
        await queue.removeRepeatableByKey(existing.key);
        console.log(`[worker] dropped stale schedule for ${existing.name} (every ${existing.every}ms → ${definition.everyMs}ms)`);
      }
    }
  }
  for (const job of AUTOMATION_JOBS) {
    await queueFor(job.queue).add(
      job.name,
      {},
      // Failed runs are kept for inspection; the run record in Redis carries the error message
      // the dashboard shows, and the BullMQ row is the fallback for a stack trace.
      { repeat: { every: job.everyMs }, removeOnComplete: true, removeOnFail: 50 }
    );
  }

  console.log("[worker] MASHUPKGRID ISP worker started. Queues:", Object.values(QUEUE_NAMES).join(", "));

  const radiusServer = env.ENABLE_EMBEDDED_RADIUS_SERVER
    ? startRadiusServer({ authPort: env.RADIUS_AUTH_PORT, acctPort: env.RADIUS_ACCT_PORT })
    : null;

  // Remote WinBox: one public port per VPN-linked router, relayed over WireGuard. The worker
  // shares the API container's network namespace in production, so it can reach wg0.
  const winboxRelay = env.ENABLE_WINBOX_RELAY
    ? startWinboxRelay({
        loadTargets: () => loadWinboxRelayTargets(env.WINBOX_RELAY_PORT_RANGE),
        allowedSources: env.WINBOX_RELAY_ALLOWED_SOURCES,
      })
    : null;

  // Owns every WhatsApp session (one per linked tenant, plus the platform line) and restores
  // whatever was connected before this restart — see lib/whatsapp-runtime.ts.
  const whatsappManager = await startWhatsAppRuntime();

  const whatsappWorker = new Worker(
    QUEUE_NAMES.whatsapp,
    async (job) => {
      // Each handler resolves its own socket through the runtime rather than being handed one:
      // sockets are replaced on every reconnect, so anything captured up front goes stale.
      if (job.name === JOB_NAMES.sendWhatsappOtp) return handleSendWhatsappOtp(job.data);
      if (job.name === JOB_NAMES.sendWhatsappVoucher) return handleSendWhatsappVoucher(job.data);
      if (job.name === JOB_NAMES.sendWhatsappTenantWelcome) return handleSendWhatsappTenantWelcome(job.data);
      if (job.name === JOB_NAMES.sendWhatsappServiceStatus) return handleSendWhatsappServiceStatus(job.data);

      if (job.name === JOB_NAMES.whatsappConnect) {
        const { tenantId, pairWithPhoneNumber } = whatsappConnectJobSchema.parse(job.data);
        try {
          // NOT optional-chained. `getManager()?.start(...)` silently does nothing when the
          // runtime failed to come up, so the job completes successfully, no QR is ever
          // published, and the dashboard sits on "Waiting for scan" forever with an empty
          // lastError — the operator has no way to tell a broken runtime from a slow one.
          const manager = getManager();
          if (!manager) {
            throw new Error(
              "WhatsApp runtime is not running in this worker — check the worker's startup logs"
            );
          }
          await manager.start(tenantId, { pairWithPhoneNumber, forceClean: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await setConnectionStatus(tenantId, "DISCONNECTED", { lastError: message });
          throw err;
        }
        return;
      }

      if (job.name === JOB_NAMES.whatsappDisconnect) {
        const { tenantId } = whatsappDisconnectJobSchema.parse(job.data);
        await getManager()?.stop(tenantId, { deleteAuth: true });
        await clearPairingQr(tenantId);
        await setConnectionStatus(tenantId, "DISCONNECTED", { lastError: null });
        return;
      }

      if (job.name === JOB_NAMES.whatsappTestMessage) {
        const { tenantId, phone, text } = whatsappTestMessageJobSchema.parse(job.data);
        const manager = getManager();
        if (!manager) throw new Error("WhatsApp runtime is not running");
        const sock = manager.get(tenantId);
        if (!sock) throw new Error("No active WhatsApp session for this tenant");

        // Import sendWhatsAppMessage dynamically to avoid circular deps
        const { sendWhatsAppMessage } = await import("@mashupkgrid/whatsapp");
        await sendWhatsAppMessage(sock, phone, text);

        // Simulate the inbound reply by feeding the message through the bot handler,
        // capturing its reply to log it to the test chat.
        const jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
        const { handleIncomingWhatsAppMessage } = await import("./lib/whatsapp-bot.js");

        // Monkey-patch the socket's sendMessage to capture the bot's reply
        const originalSendMessage = sock.sendMessage.bind(sock);
        let botReply: string | null = null;
        sock.sendMessage = async (jidTarget: string, content: unknown, ...rest: unknown[]) => {
          if (typeof content === "object" && content !== null && "text" in content) {
            botReply = (content as { text: string }).text;
          }
          // Don't actually send the bot reply to the real phone — just capture it
          return { key: { remoteJid: jidTarget, id: "test" }, message: content } as any;
        };

        try {
          await handleIncomingWhatsAppMessage(sock, tenantId ?? "platform", jid, text);
          if (botReply) {
            await pushTestChatMessage(tenantId, { direction: "in", text: botReply, phone });
          }
        } finally {
          sock.sendMessage = originalSendMessage;
        }
        return;
      }
    },
    { connection }
  );

  const shutdown = createGracefulShutdown(
    [
      async () => stopHeartbeat(),
      () => whatsappManager.stopAll().catch(() => {}),
      () => emailWorker.close(),
      () => maintenanceWorker.close(),
      () => cleanupWorker.close(),
      () => billingWorker.close(),
      () => mpesaWorker.close(),
      () => networkWorker.close(),
      () => webhooksWorker.close(),
      () => whatsappWorker.close(),
      () => radiusServer?.close() ?? Promise.resolve(),
      () => winboxRelay?.close() ?? Promise.resolve(),
    ],
    (code) => process.exit(code),
    { log: console.log }
  );
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal startup error", err);
  process.exit(1);
});
