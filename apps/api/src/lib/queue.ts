import { Queue } from "bullmq";
import { env } from "@mashupkgrid/config";
import {
  QUEUE_NAMES,
  JOB_NAMES,
  type SendVerificationEmailJob,
  type SendPasswordResetEmailJob,
  type SendPaymentConfirmationEmailJob,
  type SendHotspotVoucherEmailJob,
  type DeliverWebhookEventJob,
  type SendWhatsappOtpJob,
  type SendWhatsappVoucherJob,
  type SendWhatsappTenantWelcomeJob,
  type WhatsappConnectJob,
  type WhatsappDisconnectJob,
  type WhatsappTestMessageJob,
  type SendTenantWelcomeEmailJob,
  type SendEmailOtpJob,
  type AutomationJobDefinition,
  type AutomationRunNowPayload,
  type SendInvoiceEmailJob,
  type SendCustomerMessageJob,
} from "@mashupkgrid/shared";

const connection = { url: env.REDIS_URL };

const emailQueue = new Queue(QUEUE_NAMES.email, { connection });
const webhooksQueue = new Queue(QUEUE_NAMES.webhooks, { connection });
const whatsappQueue = new Queue(QUEUE_NAMES.whatsapp, { connection });

/** Queues for the worker's scheduled jobs, opened only when a super admin asks for a run. */
const automationQueues = new Map<string, Queue>();
function automationQueue(name: string): Queue {
  let queue = automationQueues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection });
    automationQueues.set(name, queue);
  }
  return queue;
}

/**
 * Runs one of the worker's scheduled jobs now, ahead of its next tick. It goes through the same
 * queue and handler as the schedule, so a manual run is exactly a scheduled one brought forward
 * — same idempotency, same run record (tagged "manual" with who asked).
 *
 * One attempt, no retries: someone is watching the page for the result, and a job that fails is
 * reported there rather than silently retried into a window nobody is looking at. The job id
 * dedupes a double-click into one run.
 */
export async function enqueueAutomationRunNow(job: AutomationJobDefinition, requestedBy: string): Promise<string> {
  const payload: AutomationRunNowPayload = { trigger: "manual", requestedBy };
  // BullMQ refuses a custom id containing ":", hence the dashes.
  const jobId = `manual-${job.name}-${Math.floor(Date.now() / 10_000)}`;
  await automationQueue(job.queue).add(job.name, payload, {
    jobId,
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 50,
  });
  return jobId;
}

export async function enqueueSendTenantWelcomeEmail(data: SendTenantWelcomeEmailJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendTenantWelcomeEmail, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function enqueueSendInvoiceEmail(data: SendInvoiceEmailJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendInvoiceEmail, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

/** One attempt: a message staff typed should be delivered once or reported, never retried
 *  into a customer's inbox three times. */
export async function enqueueSendCustomerMessage(data: SendCustomerMessageJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendCustomerMessage, data, { attempts: 1, removeOnComplete: 1000, removeOnFail: 2000 });
}

export async function enqueueSendEmailOtp(data: SendEmailOtpJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendEmailOtp, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueSendVerificationEmail(data: SendVerificationEmailJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendVerificationEmail, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function enqueueSendPasswordResetEmail(data: SendPasswordResetEmailJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendPasswordResetEmail, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function enqueueSendPaymentConfirmationEmail(data: SendPaymentConfirmationEmailJob): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendPaymentConfirmationEmail, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/**
 * Emails a hotspot voucher. Jobs with the same `dedupeKey` send once while the finished job is
 * kept (a week): the M-Pesa callback and the portal's status poll both see a purchase complete,
 * and a customer tapping "Email me this code" repeatedly should not flood an inbox.
 */
export async function enqueueSendHotspotVoucherEmail(data: SendHotspotVoucherEmailJob, dedupeKey?: string): Promise<void> {
  await emailQueue.add(JOB_NAMES.sendHotspotVoucherEmail, data, {
    ...(dedupeKey ? { jobId: `voucher-email-${dedupeKey}`.replace(/[^\w@.-]/g, "_") } : {}),
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: 5000,
  });
}

export async function enqueueDeliverWebhookEvent(data: DeliverWebhookEventJob): Promise<void> {
  await webhooksQueue.add(JOB_NAMES.deliverWebhookEvent, data, {
    attempts: 4,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

/** Pairing is interactive — someone is watching the dashboard for a QR right now — so this runs
 *  once and fails fast rather than retrying into a window nobody is still watching. */
export async function enqueueWhatsappConnect(data: WhatsappConnectJob): Promise<void> {
  await whatsappQueue.add(JOB_NAMES.whatsappConnect, data, {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueWhatsappDisconnect(data: WhatsappDisconnectJob): Promise<void> {
  await whatsappQueue.add(JOB_NAMES.whatsappDisconnect, data, {
    attempts: 2,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

/** Retries harder than the OTP job below: unlike a 10-minute code, a voucher a customer has
 *  already paid for stays valid, so it's always worth continuing to try to deliver it. */
export async function enqueueSendWhatsappVoucher(data: SendWhatsappVoucherJob): Promise<void> {
  await whatsappQueue.add(JOB_NAMES.sendWhatsappVoucher, data, {
    attempts: 6,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function enqueueSendWhatsappTenantWelcome(data: SendWhatsappTenantWelcomeJob): Promise<void> {
  await whatsappQueue.add(JOB_NAMES.sendWhatsappTenantWelcome, data, {
    attempts: 6,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export async function enqueueSendWhatsappOtp(data: SendWhatsappOtpJob): Promise<void> {
  // Fewer/faster retries than the email jobs above — the code is only valid for 10 minutes
  // (whatsapp-otp.ts's CODE_TTL_SECONDS), so retrying for the email jobs' usual ~2.5 minutes of
  // backoff is fine, but there's no point retrying a stale code delivery well past its own expiry.
  await whatsappQueue.add(JOB_NAMES.sendWhatsappOtp, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 2000,
  });
}

export async function enqueueWhatsappTestMessage(data: WhatsappTestMessageJob): Promise<void> {
  await whatsappQueue.add(JOB_NAMES.whatsappTestMessage, data, {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}
