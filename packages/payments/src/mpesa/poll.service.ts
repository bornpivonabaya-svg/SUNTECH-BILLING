import { prisma } from "@mashupkgrid/database";
import { queryAndReconcileStkRequest } from "./stk.service.js";
import { handleStkCallback } from "./callback.service.js";

export interface PollResult {
  checked: number;
  resolved: number;
  unresolvedSuccesses: string[];
  errors: number;
}

/**
 * Defensive poll for lost/delayed STK callbacks (docs/architecture/10-phase3-plan.md). Checks
 * every PENDING `MpesaStkRequest` older than `olderThanMs` against Safaricom's Query API.
 * `unresolvedSuccesses` lists checkoutRequestIds Safaricom reports as successful but for which
 * we have no receipt number yet (see the limitation documented in `stk.service.ts`) — these
 * need operator attention if they never resolve via a real callback.
 */
export async function pollPendingStkRequests(olderThanMs = 2 * 60 * 1000): Promise<PollResult> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const pending = await prisma.mpesaStkRequest.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { tenantId: true, checkoutRequestId: true },
  });

  let resolved = 0;
  let errors = 0;
  const unresolvedSuccesses: string[] = [];

  for (const { tenantId, checkoutRequestId } of pending) {
    try {
      const { request, unresolvedSuccess } = await queryAndReconcileStkRequest(tenantId, checkoutRequestId);
      if (unresolvedSuccess) {
        unresolvedSuccesses.push(checkoutRequestId);
      } else if (request.status !== "PENDING") {
        resolved += 1;
      }
    } catch (err) {
      errors += 1;
      // eslint-disable-next-line no-console
      console.error(`[mpesa] failed to poll STK request ${checkoutRequestId}`, err);
    }
  }

  return { checked: pending.length, resolved, unresolvedSuccesses, errors };
}

/** A stored Safaricom STK callback that says the customer paid: ResultCode 0 with a receipt. */
export function isPaidStkCallback(payload: unknown): boolean {
  const cb = (payload as { Body?: { stkCallback?: { ResultCode?: unknown; CallbackMetadata?: { Item?: { Name?: string; Value?: unknown }[] } } } })
    ?.Body?.stkCallback;
  if (!cb || Number(cb.ResultCode) !== 0) return false;
  return Boolean(cb.CallbackMetadata?.Item?.some((i) => i.Name === "MpesaReceiptNumber" && i.Value));
}

export interface ReplayResult {
  checked: number;
  recovered: number;
}

/**
 * Repairs purchases where the customer paid but got nothing: requests left FAILED or CANCELLED
 * (an older version failed them on Daraja's "still under processing" while the PIN prompt was
 * open) whose real success callback then arrived and was dropped as a duplicate. Every callback
 * is stored verbatim (PaymentWebhookEvent), so it is replayed through the normal path — which now
 * honours a callback with a real receipt on such a request — issuing the voucher and texting it
 * to the customer. Idempotent: a completed request is never touched again.
 */
export async function replayStrandedStkCallbacks(sinceDays = 14): Promise<ReplayResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const stranded = await prisma.mpesaStkRequest.findMany({
    where: { status: { in: ["FAILED", "CANCELLED"] }, createdAt: { gte: since } },
    select: { checkoutRequestId: true },
    take: 500,
  });
  let recovered = 0;
  for (const { checkoutRequestId } of stranded) {
    const events = await prisma.paymentWebhookEvent.findMany({
      where: { provider: "MPESA", eventType: "STK_CALLBACK", externalId: checkoutRequestId },
      orderBy: { receivedAt: "desc" },
      select: { payload: true },
    });
    const paid = events.find((e) => isPaidStkCallback(e.payload));
    if (!paid) continue;
    try {
      await handleStkCallback(paid.payload);
      recovered += 1;
      // eslint-disable-next-line no-console
      console.log(`[mpesa] recovered paid purchase ${checkoutRequestId} from its stored Safaricom callback`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[mpesa] could not replay stored callback for ${checkoutRequestId}`, err);
    }
  }
  return { checked: stranded.length, recovered };
}
