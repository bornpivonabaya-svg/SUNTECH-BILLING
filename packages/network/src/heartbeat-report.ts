/**
 * What a router reports about itself once a minute (see buildHeartbeatScript in
 * @mashupkgrid/radius), so a router the platform can't connect to — behind CGNAT or an ISP's box —
 * still has CPU, memory, temperature and the rest on the dashboard.
 *
 * The body is form-encoded text built by the router's own script:
 *   cpu=4&uptime=1w2d03:04:05&freemem=…&totmem=…&freehdd=…&tothdd=…&ver=7.24.1 (stable)
 *   &board=hAP lite&users=3&health=<[:tostr [/system health print as-value]]>
 * Every field is optional and anything malformed is dropped, since it comes off the wire.
 */
export interface RouterHeartbeatMetrics {
  cpuLoadPercent?: number;
  uptimeSeconds?: number;
  memoryUsedBytes?: bigint;
  memoryTotalBytes?: bigint;
  diskFreeBytes?: bigint;
  diskTotalBytes?: bigint;
  temperatureC?: number;
  voltageV?: number;
  activeUsers?: number;
  routerOsVersion?: string;
  boardName?: string;
}

/** True when a callback body is this report rather than a WireGuard public key. */
export function isHeartbeatReport(body: string): boolean {
  return /(^|&)cpu=/.test(body);
}

/** RouterOS uptime in either form: the API's "1w2d3h4m5s" or a script's "1w2d03:04:05". */
export function parseUptimeSeconds(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  const clock = /(\d{1,2}):(\d{2}):(\d{2})$/.exec(text);
  const head = clock ? text.slice(0, clock.index) : text;
  for (const m of head.matchAll(/(\d+)([wdhms])/g)) total += Number(m[1]) * (units[m[2]!] ?? 0);
  if (clock) total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  return total > 0 ? total : undefined;
}

const TEMPERATURE_NAMES = ["temperature", "cpu-temperature", "board-temperature1", "board-temperature", "switch-temperature"];

/**
 * `/system health print as-value`, flattened by `:tostr`. RouterOS 7 gives one row per sensor
 * (".id=*1;name=temperature;type=C;value=41;.id=*2;name=voltage;…"); RouterOS 6 one row of
 * fields ("temperature=41;voltage=24.1"). Returns sensor name → value either way.
 */
export function parseHealthSensors(raw: string): Record<string, string> {
  const sensors: Record<string, string> = {};
  let current: string | undefined;
  for (const part of raw.slice(0, 4000).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "name") current = value;
    else if (key === "value" && current) sensors[current] = value;
    else if (key !== ".id" && key !== "type") sensors[key] = value;
  }
  return sensors;
}

function num(value: string | null | undefined, min: number, max: number): number | undefined {
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function bytes(value: string | null | undefined): bigint | undefined {
  return value && /^\d{1,15}$/.test(value.trim()) ? BigInt(value.trim()) : undefined;
}

const text = (value: string | null | undefined, max: number) => {
  const t = value?.replace(/[^\x20-\x7e]/g, "").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Reads a report from its form body; older routers put the same fields in the query string. */
export function parseHeartbeatReport(body: string, query: Record<string, unknown> = {}): RouterHeartbeatMetrics {
  const form = new URLSearchParams(body.slice(0, 8000));
  const get = (key: string) => form.get(key) ?? (typeof query[key] === "string" ? (query[key] as string) : null);
  const metrics: RouterHeartbeatMetrics = {};

  const cpu = num(get("cpu"), 0, 100);
  if (cpu !== undefined) metrics.cpuLoadPercent = Math.round(cpu);
  const uptime = get("uptime");
  if (uptime) metrics.uptimeSeconds = parseUptimeSeconds(uptime);

  const totalMem = bytes(get("totmem"));
  const freeMem = bytes(get("freemem"));
  if (totalMem) {
    metrics.memoryTotalBytes = totalMem;
    if (freeMem !== undefined) metrics.memoryUsedBytes = totalMem > freeMem ? totalMem - freeMem : 0n;
  }
  const totalDisk = bytes(get("tothdd"));
  const freeDisk = bytes(get("freehdd"));
  if (totalDisk) metrics.diskTotalBytes = totalDisk;
  if (freeDisk !== undefined && totalDisk) metrics.diskFreeBytes = freeDisk;

  const users = num(get("users"), 0, 100_000);
  if (users !== undefined) metrics.activeUsers = Math.round(users);
  metrics.routerOsVersion = text(get("ver"), 64);
  metrics.boardName = text(get("board"), 64);

  const health = get("health");
  if (health) {
    const sensors = parseHealthSensors(health);
    const tempName = TEMPERATURE_NAMES.find((name) => sensors[name] !== undefined);
    const temperature = tempName ? num(sensors[tempName], -40, 150) : undefined;
    if (temperature !== undefined) metrics.temperatureC = temperature;
    const voltage = num(sensors["voltage"], 0, 100);
    if (voltage !== undefined) metrics.voltageV = voltage;
  }

  for (const key of Object.keys(metrics) as (keyof RouterHeartbeatMetrics)[]) {
    if (metrics[key] === undefined) delete metrics[key];
  }
  return metrics;
}
