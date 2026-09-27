import { pollPendingStkRequests, replayStrandedStkCallbacks } from "@mashupkgrid/payments";
import type { AutomationSummary } from "@mashupkgrid/shared";

export async function handlePollPendingStkRequests(): Promise<AutomationSummary> {
  const result = await pollPendingStkRequests();
  // Paid purchases an older version left failed, recovered from Safaricom's stored callback.
  const replay = await replayStrandedStkCallbacks();
  console.log(
    `[mpesa] poll-pending-stk-requests: checked=${result.checked} resolved=${result.resolved} errors=${result.errors} recoveredFromCallbacks=${replay.recovered}`
  );
  if (result.unresolvedSuccesses.length > 0) {
    // Safaricom confirms success but we have no receipt number (see the documented limitation
    // in packages/payments/src/mpesa/stk.service.ts) — surfaced loudly for operator follow-up.
    console.warn(
      `[mpesa] ${result.unresolvedSuccesses.length} STK request(s) confirmed successful by Safaricom but still awaiting a receipt number (no callback received yet): ${result.unresolvedSuccesses.join(", ")}`
    );
  }
  return {
    checked: result.checked,
    resolved: result.resolved + replay.recovered,
    errors: result.errors,
    awaitingReceipt: result.unresolvedSuccesses.length,
  };
}
