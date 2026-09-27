import { describe, expect, it } from "vitest";
import { isHeartbeatReport, parseHealthSensors, parseHeartbeatReport, parseUptimeSeconds } from "../heartbeat-report.js";

// Built exactly as the router's heartbeat script builds it (buildHeartbeatScript).
const v7Body =
  "cpu=7&uptime=1w2d03:04:05&freemem=9332736&totmem=33554432&freehdd=3895296&tothdd=16777216" +
  "&ver=7.24.1 (stable)&board=hAP lite&users=3" +
  "&health=.id=*1;name=voltage;type=V;value=24.1;.id=*2;name=temperature;type=C;value=41";

describe("the router's once-a-minute report", () => {
  it("is told apart from a WireGuard public key", () => {
    expect(isHeartbeatReport(v7Body)).toBe(true);
    expect(isHeartbeatReport("xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=")).toBe(false);
  });

  it("reads every figure from a RouterOS 7 hAP lite", () => {
    expect(parseHeartbeatReport(v7Body)).toEqual({
      cpuLoadPercent: 7,
      uptimeSeconds: 7 * 86400 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5,
      memoryTotalBytes: 33554432n,
      memoryUsedBytes: 33554432n - 9332736n,
      diskTotalBytes: 16777216n,
      diskFreeBytes: 3895296n,
      activeUsers: 3,
      routerOsVersion: "7.24.1 (stable)",
      boardName: "hAP lite",
      temperatureC: 41,
      voltageV: 24.1,
    });
  });

  it("reads RouterOS 6's one-row health, and a board with no sensors at all", () => {
    expect(parseHealthSensors("temperature=38;voltage=12.3")).toEqual({ temperature: "38", voltage: "12.3" });
    const v6 = parseHeartbeatReport("cpu=12&uptime=03:00:00&totmem=67108864&freemem=33554432&health=temperature=38;voltage=12.3");
    expect(v6).toMatchObject({ cpuLoadPercent: 12, uptimeSeconds: 10800, temperatureC: 38, voltageV: 12.3, memoryUsedBytes: 33554432n });
    const noSensor = parseHeartbeatReport("cpu=1&uptime=5m10s&health=");
    expect(noSensor.temperatureC).toBeUndefined();
    expect(noSensor.uptimeSeconds).toBe(310);
  });

  it("drops anything malformed rather than storing it", () => {
    const junk = parseHeartbeatReport("cpu=900&totmem=lots&freemem=-1&users=abc&health=name=temperature;value=hot&board=%00%01");
    expect(junk).toEqual({});
  });

  it("still reads the query-string figures older setup scripts send", () => {
    expect(parseHeartbeatReport("", { cpu: "5", uptime: "2d01:00:00" })).toEqual({ cpuLoadPercent: 5, uptimeSeconds: 2 * 86400 + 3600 });
  });

  it("parses uptime in both RouterOS forms", () => {
    expect(parseUptimeSeconds("1w2d3h4m5s")).toBe(788645);
    expect(parseUptimeSeconds("1w2d03:04:05")).toBe(788645);
    expect(parseUptimeSeconds("00:00:30")).toBe(30);
  });
});
