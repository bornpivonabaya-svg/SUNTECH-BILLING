/**
 * How often a router checks in, and so how long its silence means "offline".
 *
 * Each check-in downloads the report script and posts the results over HTTPS. On a small router —
 * a hAP lite has one 650 MHz MIPS core and 32 MB — two TLS handshakes a minute plus the hotspot
 * self-check kept the CPU at 100%: check-ins piled up, the console froze, and phones timed out
 * loading the sign-in page. Small routers therefore check in every 5 minutes; everything else
 * every minute. The report script sets the router's own scheduler to match (buildHeartbeatScript),
 * and every "is it online?" decision allows 2.5 intervals.
 */

type RouterSize = { memoryTotalBytes?: bigint | number | null; boardName?: string | null };

const SMALL_MEMORY_BYTES = 64 * 1024 * 1024;
/** Boards with 64 MB or less, for a router that hasn't reported its memory yet. */
const SMALL_BOARDS = /\b(hAP lite|hAP mini|mAP lite|cAP lite|hEX lite|RB941|RB931|RB750r2)\b/i;

export function isSmallRouter(router: RouterSize): boolean {
  if (router.memoryTotalBytes !== null && router.memoryTotalBytes !== undefined) {
    return Number(router.memoryTotalBytes) <= SMALL_MEMORY_BYTES;
  }
  return Boolean(router.boardName && SMALL_BOARDS.test(router.boardName));
}

/** Seconds between check-ins. */
export function heartbeatIntervalSeconds(router: RouterSize): number {
  return isSmallRouter(router) ? 300 : 60;
}

/** The interval as RouterOS writes it, for the scheduler; null while the router's size is unknown. */
export function heartbeatIntervalRouterOs(router: RouterSize): "1m" | "5m" | null {
  const known = (router.memoryTotalBytes !== null && router.memoryTotalBytes !== undefined) || Boolean(router.boardName);
  if (!known) return null;
  return isSmallRouter(router) ? "5m" : "1m";
}

/** How long after its last check-in a router still counts as online: 2.5 intervals (two missed). */
export function heartbeatOnlineWindowMs(router: RouterSize): number {
  return heartbeatIntervalSeconds(router) * 2.5 * 1000;
}

/** Past the online window but within this, it is "late" (warning) rather than down: 4 intervals. */
export function heartbeatLateWindowMs(router: RouterSize): number {
  return heartbeatIntervalSeconds(router) * 4 * 1000;
}
