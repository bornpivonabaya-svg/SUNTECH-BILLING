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
  /** The management VPN as the router reports it; see parseVpnReport. */
  vpnStatus?: "none" | "no-peer" | "waiting" | "connected";
  vpnHandshakeAt?: Date;
  /** The router's hotspot self-check; see parseHotspotCheck and hotspotProblems. */
  hotspotCheck?: HotspotCheck;
  hotspotCheckAt?: Date;
}

/** Counts from the router's hotspot self-check (HOTSPOT_CHECK in @mashupkgrid/radius). */
export interface HotspotCheck {
  srv?: number; // hotspot servers running
  hosts?: number; // devices that reached the hotspot
  auth?: number; // of those, signed in
  leases?: number; // DHCP leases handed out
  dnsnat?: number; // "MASHUPKGRID DNS" redirect rules
  login?: number; // hotspot/login.html files
  radios?: number; // wlan/wifi interfaces in the bridge
  garden?: number; // walled-garden entries for the platform
  ping?: number; // of 2 pings to 8.8.8.8, answered
  dns?: number; // 1 when the router resolves names
}

const CHECK_KEYS: (keyof HotspotCheck)[] = ["srv", "hosts", "auth", "leases", "dnsnat", "login", "radios", "garden", "ping", "dns"];

/** "srv=1;hosts=3;…;dns=1" → counts; unknown keys and non-numbers are dropped. */
export function parseHotspotCheck(value: string | null): HotspotCheck | undefined {
  if (!value) return undefined;
  const check: HotspotCheck = {};
  for (const part of value.slice(0, 500).split(";")) {
    const [key, raw] = part.split("=", 2) as [string, string | undefined];
    const n = Number(raw);
    if (CHECK_KEYS.includes(key as keyof HotspotCheck) && raw !== undefined && raw !== "" && Number.isInteger(n) && n >= 0 && n < 1_000_000) {
      check[key as keyof HotspotCheck] = n;
    }
  }
  return Object.keys(check).length ? check : undefined;
}

export interface HotspotProblem {
  code: string;
  /** What is wrong, in words an ISP can act on. */
  message: string;
}

/**
 * Why customers would see "Connected, no internet" or no sign-in page, from the router's own
 * check. Ordered by cause: a router with no internet explains everything after it.
 */
export function hotspotProblems(check: HotspotCheck | null | undefined): HotspotProblem[] {
  if (!check) return [];
  const out: HotspotProblem[] = [];
  if (check.ping === 0) out.push({ code: "no-internet", message: "The router itself has no internet: its WAN (ether1) link or the upstream modem is down." });
  if (check.dns === 0) out.push({ code: "no-dns", message: "The router can't look up names (DNS), so the sign-in page and every website fail." });
  if (check.srv === 0) out.push({ code: "no-hotspot", message: "No hotspot server is running on the router, so phones never get the sign-in page." });
  if (check.login === 0) out.push({ code: "no-login-page", message: "The sign-in page file (hotspot/login.html) is missing on the router." });
  if (check.radios === 0) out.push({ code: "wifi-not-bridged", message: "The Wi-Fi isn't part of the hotspot bridge, so Wi-Fi phones bypass the hotspot." });
  if (check.garden === 0) out.push({ code: "no-walled-garden", message: "The payment portal isn't in the walled garden, so the sign-in page can't open." });
  if (check.dnsnat !== undefined && check.dnsnat > 2) out.push({ code: "dns-rules-piled", message: `${check.dnsnat} copies of the DNS redirect rule (should be 2) are slowing the router.` });
  if (check.leases !== undefined && check.leases > 0 && check.hosts === 0 && check.srv !== 0)
    out.push({ code: "hosts-bypass", message: "Phones get an address but never reach the hotspot: it runs on a different port than the Wi-Fi." });
  return out;
}

/**
 * The report's `wg` field: "0" no WireGuard interface, "1" an interface with no peer, "1," one
 * that has never connected, "1,1m20s" (or "1,00:01:20") connected that long ago. A handshake
 * older than 3 minutes means the tunnel is down again (WireGuard re-handshakes every 2).
 */
export function parseVpnReport(value: string | null, now = Date.now()): Pick<RouterHeartbeatMetrics, "vpnStatus" | "vpnHandshakeAt"> {
  if (value === null) return {};
  const [count, handshake] = value.trim().split(",", 2);
  if (count === "0") return { vpnStatus: "none" };
  if (count !== "1") return {};
  if (handshake === undefined) return { vpnStatus: "no-peer" };
  const ago = parseUptimeSeconds(handshake);
  if (ago === undefined) return { vpnStatus: "waiting" };
  return { vpnStatus: ago <= 180 ? "connected" : "waiting", vpnHandshakeAt: new Date(now - ago * 1000) };
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

  Object.assign(metrics, parseVpnReport(get("wg")));
  const hotspotCheck = parseHotspotCheck(get("hs"));
  if (hotspotCheck) {
    metrics.hotspotCheck = hotspotCheck;
    metrics.hotspotCheckAt = new Date();
  }

  for (const key of Object.keys(metrics) as (keyof RouterHeartbeatMetrics)[]) {
    if (metrics[key] === undefined) delete metrics[key];
  }
  return metrics;
}
