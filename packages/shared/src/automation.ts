import { JOB_NAMES, QUEUE_NAMES } from "./queues.js";

/**
 * The catalog of everything the worker does on a schedule, and the Redis contract it uses to
 * report back on it.
 *
 * Three consumers share this file, and each drifted from the others before it existed:
 * - `apps/worker` registers the repeatable jobs from it, so an interval lives in exactly one
 *   place (BullMQ keys a repeatable job by its interval, so a stale duplicate schedule is the
 *   usual symptom of editing one copy).
 * - `apps/api` reads the run records the worker leaves behind and serves them to the dashboard.
 * - `apps/web` renders the catalog, so a job is never listed in the UI without being registered
 *   in the worker, or vice versa.
 */

export type AutomationCategory = "billing" | "collections" | "network" | "payments" | "platform";

export interface AutomationJobDefinition {
  name: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
  queue: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
  category: AutomationCategory;
  /** Short, operator-facing. Sentence case, no jargon. */
  label: string;
  /** One sentence on what actually happens when it runs — what an ISP owner would want to know. */
  description: string;
  everyMs: number;
  /** What the run summary's counters mean, keyed by counter name, for the dashboard's tooltip. */
  counters: Record<string, string>;
  /** True for the jobs a tenant operator sees on their own automation page. Platform-only jobs
   *  (trial expiry, settlements, token cleanup) are still recorded but only shown to super admins. */
  tenantVisible: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const AUTOMATION_JOBS: readonly AutomationJobDefinition[] = [
  // --- billing ---------------------------------------------------------------------------------
  {
    name: JOB_NAMES.generateInvoices,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Generate renewal invoices",
    description: "Creates the next invoice for every subscription whose billing period is about to end.",
    everyMs: HOUR,
    counters: { processed: "Subscriptions checked", created: "Invoices created", errors: "Failed" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.markOverdueInvoices,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Mark overdue invoices",
    description: "Flags unpaid invoices as overdue once their due date has passed.",
    everyMs: HOUR,
    counters: { marked: "Invoices marked overdue" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.suspendOverdueCustomers,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Suspend overdue customers",
    description: "Suspends service for customers whose invoices stayed unpaid past the grace period, and queues the router change.",
    everyMs: HOUR,
    counters: { suspended: "Customers suspended" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.reactivateClearedCustomers,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Reactivate paid-up customers",
    description: "Restores service for suspended customers who have cleared their balance. Payments restore service immediately; this catches anything that slipped.",
    everyMs: MINUTE,
    counters: { reactivated: "Customers reactivated" },
    tenantVisible: true,
  },

  // --- collections (dunning) --------------------------------------------------------------------
  {
    name: JOB_NAMES.sendDueSoonReminders,
    queue: QUEUE_NAMES.billing,
    category: "collections",
    label: "Due-soon reminders",
    description: "Sends a friendly SMS and email a few days before an invoice is due.",
    everyMs: HOUR,
    counters: { processed: "Invoices reminded", smsSent: "SMS delivered", emailSent: "Emails sent", smsFailed: "SMS failed" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.sendOverdueNotices,
    queue: QUEUE_NAMES.billing,
    category: "collections",
    label: "Overdue notices",
    description: "Tells customers an invoice is overdue and that service will be suspended if it stays unpaid.",
    everyMs: HOUR,
    counters: { processed: "Notices sent", smsSent: "SMS delivered", emailSent: "Emails sent", smsFailed: "SMS failed" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.sendFinalDunningNotices,
    queue: QUEUE_NAMES.billing,
    category: "collections",
    label: "Final notices",
    description: "The last warning, sent the day before suspension.",
    everyMs: HOUR,
    counters: { processed: "Final notices sent", smsSent: "SMS delivered", emailSent: "Emails sent", smsFailed: "SMS failed" },
    tenantVisible: true,
  },

  {
    name: JOB_NAMES.sendPendingInvoiceEmails,
    queue: QUEUE_NAMES.email,
    category: "collections",
    label: "Email new invoices",
    description: "Emails every newly issued invoice to the customer, with the amount, due date and how to pay.",
    everyMs: 5 * MINUTE,
    counters: { sent: "Invoices emailed", noEmail: "Customers without email" },
    tenantVisible: true,
  },

  // --- network ---------------------------------------------------------------------------------
  {
    name: JOB_NAMES.runProvisioningJobs,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Apply router changes",
    description: "Pushes pending activations, suspensions and restores to routers, then tells the customer on WhatsApp.",
    everyMs: 20_000,
    counters: { processed: "Jobs run", succeeded: "Applied", failed: "Failed", notified: "Customers notified" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.checkPendingDomains,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Check custom domains",
    description: "Keeps checking newly added custom domains until their DNS points here, then switches them on.",
    everyMs: 5 * MINUTE,
    counters: { verified: "Now live", waiting: "Waiting for DNS" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.retryPendingVlans,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Finish VLAN setup",
    description: "Sets up hotspot and PPPoE VLANs on routers that were offline when the VLAN was added.",
    everyMs: 5 * MINUTE,
    counters: { applied: "Set up", waiting: "Router still offline", failed: "Failed" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.pollRouterHealth,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Check router health",
    description: "Connects to every linked router, updates its online status and alerts staff when one goes down or comes back.",
    everyMs: 30_000,
    counters: { reachable: "Routers online", unreachable: "Routers offline", alerts: "Alerts sent" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.retryPendingSyncTasks,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Retry RADIUS sync",
    description: "Retries session disconnects and account updates that a router did not acknowledge.",
    everyMs: 30_000,
    counters: { processed: "Tasks retried" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.expireOverdueVouchers,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Expire hotspot vouchers",
    description: "Ends hotspot sessions whose time or data allowance has run out.",
    everyMs: MINUTE,
    counters: { expired: "Vouchers expired" },
    tenantVisible: true,
  },

  // --- payments --------------------------------------------------------------------------------
  {
    name: JOB_NAMES.pollPendingStkRequests,
    queue: QUEUE_NAMES.mpesa,
    category: "payments",
    label: "Recover M-Pesa payments",
    description: "Asks Safaricom about STK pushes that never called back, so a paid customer is not left waiting.",
    everyMs: 2 * MINUTE,
    counters: { checked: "Requests checked", resolved: "Payments recovered", errors: "Errors", awaitingReceipt: "Awaiting receipt" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.autoRouterUpdates,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Monthly router upgrades",
    description: "Starts the RouterOS and firmware upgrade on the day and hour each ISP chose.",
    everyMs: 15 * MINUTE,
    counters: { tenants: "ISPs checked", started: "Upgrades started" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.routerBackups,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Router backups",
    description: "Saves each online router's full configuration once a day, keeping the newest 20.",
    everyMs: HOUR,
    counters: { due: "Routers due", saved: "Backups saved", failed: "Backups failed" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.routerRollouts,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Router updates",
    description: "Applies over-the-air updates, features and scripts from the Router updates page, one router at a time.",
    everyMs: 30 * 1000,
    counters: { rollouts: "Rollouts running", updated: "Routers updated", failed: "Routers failed", interrupted: "Interrupted" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.networkMaintenanceNotices,
    queue: QUEUE_NAMES.network,
    category: "network",
    label: "Maintenance notices",
    description: "Texts customers on the affected routers before planned network work starts, and again when it is over.",
    everyMs: 5 * MINUTE,
    counters: { checked: "Windows checked", notices: "Notices sent", texted: "Customers texted", failed: "Texts not delivered" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.resumePausedPlans,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Resume paused plans",
    description: "Turns a customer's paused plan back on when the pause ends.",
    everyMs: 15 * MINUTE,
    counters: { resumed: "Plans resumed", failed: "Could not resume" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.sweepAddOns,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Prepaid add-ons",
    description: "Starts speed boosts and data add-ons once paid, ends them when their time is up, and cancels ones left unpaid.",
    everyMs: MINUTE,
    counters: { activated: "Started", expired: "Ended", cancelled: "Cancelled unpaid" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.winBackOffers,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Win-back offers",
    description: "Texts customers at risk of leaving an offer to come back, in the daytime, and credits the ones who pay in time.",
    everyMs: 60 * MINUTE,
    counters: { sent: "Offers sent", failed: "Could not send", redeemed: "Came back", expired: "Expired" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.sendCampaigns,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Campaigns",
    description: "Sends scheduled SMS and WhatsApp campaigns in batches, and records who paid after getting one.",
    everyMs: MINUTE,
    counters: { sent: "Messages sent", failed: "Could not send", started: "Campaigns started", finished: "Campaigns finished", attributed: "Payments counted" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.referralRewards,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Referral rewards",
    description: "Gives free days or credit to customers whose referred neighbour has made their first payment.",
    everyMs: HOUR,
    counters: { tenants: "ISPs checked", rewarded: "Rewards given", errors: "Errors" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.suggestUpgrades,
    queue: QUEUE_NAMES.billing,
    category: "billing",
    label: "Suggest plan upgrades",
    description: "Finds subscribers running into their data cap and suggests the next plan up, for staff to apply.",
    everyMs: 6 * HOUR,
    counters: { tenants: "ISPs checked", found: "Suggestions", texted: "Customers texted", errors: "Errors" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.pushLargePayments,
    queue: QUEUE_NAMES.mpesa,
    category: "payments",
    label: "Alert on large payments",
    description: "Sends a push alert to staff devices when a payment at or above the ISP's alert amount arrives.",
    everyMs: MINUTE,
    counters: { checked: "Payments checked", alerted: "Alerts sent" },
    tenantVisible: true,
  },
  {
    name: JOB_NAMES.runTenantPayouts,
    queue: QUEUE_NAMES.billing,
    category: "payments",
    label: "Settle ISP balances",
    description: "Pays out collected money to each ISP according to the platform's settlement policy.",
    everyMs: 5 * MINUTE,
    counters: { created: "Settlements created", skipped: "Skipped", failed: "Failed" },
    tenantVisible: false,
  },

  // --- platform --------------------------------------------------------------------------------
  {
    name: JOB_NAMES.expireTrials,
    queue: QUEUE_NAMES.billing,
    category: "platform",
    label: "ISP subscription lifecycle",
    description: "Ends free trials, moves unpaid ISP subscriptions to past-due, and expires them after the grace period.",
    everyMs: HOUR,
    counters: { expiredTrials: "Trials ended", pastDue: "Moved to past-due", expired: "Expired" },
    tenantVisible: false,
  },
  {
    name: JOB_NAMES.applyScheduledMaintenance,
    queue: QUEUE_NAMES.maintenance,
    category: "platform",
    label: "Scheduled maintenance",
    description: "Turns maintenance mode on and off at the scheduled times.",
    everyMs: MINUTE,
    counters: { switched: "Switched" },
    tenantVisible: false,
  },
  {
    name: JOB_NAMES.cleanupExpiredTokens,
    queue: QUEUE_NAMES.cleanup,
    category: "platform",
    label: "Clean up expired tokens",
    description: "Deletes used and expired sign-in tokens, old revoked sessions and stale login attempts.",
    everyMs: 24 * HOUR,
    counters: { verificationTokens: "Verification tokens", resetTokens: "Reset tokens", sessions: "Sessions", loginAttempts: "Login attempts" },
    tenantVisible: false,
  },
];

export const AUTOMATION_CATEGORY_LABELS: Record<AutomationCategory, string> = {
  billing: "Billing",
  collections: "Payment reminders",
  network: "Network",
  payments: "Payments",
  platform: "Platform",
};

export function findAutomationJob(name: string): AutomationJobDefinition | undefined {
  return AUTOMATION_JOBS.find((job) => job.name === name);
}

/** Counters a handler reports for one run — small integers only, so a run record stays tiny. */
export type AutomationSummary = Record<string, number>;

export type AutomationTrigger = "schedule" | "manual";

export interface AutomationRunRecord {
  job: string;
  trigger: AutomationTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  summary: AutomationSummary;
  /** The failure message, when `ok` is false. */
  error: string | null;
}

/** Payload of a job the dashboard asked to run now, as opposed to the scheduler's empty `{}`. */
export interface AutomationRunNowPayload {
  trigger: "manual";
  requestedBy: string;
}

export const AUTOMATION_KEYS = {
  /** Set by the worker every WORKER_HEARTBEAT_MS with the ISO time; its absence or staleness is
   *  how the dashboard tells "the worker is down" from "nothing has needed doing". */
  heartbeat: "automation:worker:heartbeat",
  lastRun: (job: string) => `automation:job:${job}:last`,
  /** A capped list, newest first, of the last RUN_HISTORY_LIMIT records. */
  runs: (job: string) => `automation:job:${job}:runs`,
} as const;

export const WORKER_HEARTBEAT_MS = 30_000;
/** Three missed heartbeats before the dashboard calls the worker offline. */
export const WORKER_OFFLINE_AFTER_MS = 3 * WORKER_HEARTBEAT_MS;
export const RUN_HISTORY_LIMIT = 20;

/** When a job should next fire, given its last completed run, or "any moment" if it has none. */
export function nextRunAfter(job: AutomationJobDefinition, lastRun: AutomationRunRecord | null, now = Date.now()): Date {
  if (!lastRun) return new Date(now);
  const next = new Date(lastRun.startedAt).getTime() + job.everyMs;
  return new Date(Math.max(next, now));
}

/**
 * Whether a job is behind schedule: no run has completed within two intervals (one interval of
 * slack absorbs a slow run or a busy queue) plus a floor for the fast jobs, where a 20-second
 * tick that slips by a few seconds is not worth a warning.
 */
export function isJobStale(job: AutomationJobDefinition, lastRun: AutomationRunRecord | null, now = Date.now()): boolean {
  if (!lastRun) return false; // a job that has never run is "not yet", not "late"
  const allowance = Math.max(2 * job.everyMs, 2 * MINUTE);
  return now - new Date(lastRun.finishedAt).getTime() > allowance;
}
