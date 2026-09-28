import { describe, expect, it } from "vitest";
import { heartbeatIntervalRouterOs, heartbeatIntervalSeconds, heartbeatLateWindowMs, heartbeatOnlineWindowMs, isSmallRouter } from "../heartbeat-interval.js";

const MB = 1024 * 1024;

describe("how often a router checks in", () => {
  it("gives small routers (32–64 MB) a 5-minute check-in, everything else 1 minute", () => {
    const hapLite = { memoryTotalBytes: BigInt(32 * MB), boardName: "hAP lite" };
    const hexLite = { memoryTotalBytes: BigInt(64 * MB), boardName: "hEX lite" };
    const hapAc2 = { memoryTotalBytes: BigInt(128 * MB), boardName: "hAP ac^2" };
    expect(isSmallRouter(hapLite)).toBe(true);
    expect(isSmallRouter(hexLite)).toBe(true);
    expect(isSmallRouter(hapAc2)).toBe(false);
    expect(heartbeatIntervalSeconds(hapLite)).toBe(300);
    expect(heartbeatIntervalSeconds(hapAc2)).toBe(60);
  });

  it("recognises a small board by name before it has reported its memory", () => {
    expect(isSmallRouter({ memoryTotalBytes: null, boardName: "hAP lite" })).toBe(true);
    expect(isSmallRouter({ memoryTotalBytes: null, boardName: "RB941-2nD" })).toBe(true);
    expect(isSmallRouter({ memoryTotalBytes: null, boardName: "RB4011iGS+" })).toBe(false);
    // Memory, once known, decides.
    expect(isSmallRouter({ memoryTotalBytes: BigInt(256 * MB), boardName: "hAP lite" })).toBe(false);
  });

  it("tells the router its interval only once its size is known", () => {
    expect(heartbeatIntervalRouterOs({})).toBeNull();
    expect(heartbeatIntervalRouterOs({ memoryTotalBytes: BigInt(32 * MB) })).toBe("5m");
    expect(heartbeatIntervalRouterOs({ memoryTotalBytes: BigInt(256 * MB) })).toBe("1m");
    expect(heartbeatIntervalRouterOs({ boardName: "hAP lite" })).toBe("5m");
  });

  it("counts a router online for 2.5 check-ins and late up to 4", () => {
    expect(heartbeatOnlineWindowMs({})).toBe(150_000);
    expect(heartbeatLateWindowMs({})).toBe(240_000);
    const small = { memoryTotalBytes: BigInt(32 * MB) };
    expect(heartbeatOnlineWindowMs(small)).toBe(750_000);
    expect(heartbeatLateWindowMs(small)).toBe(1_200_000);
  });
});
