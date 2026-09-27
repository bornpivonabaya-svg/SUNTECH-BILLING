import { RouterOSClient, assertNoTrap } from "./routeros-client.js";
import { ANTI_TUNNEL_RESULT_VAR, ANTI_TUNNEL_TAG, antiTunnelRules, buildAntiTunnelScript } from "../anti-tunnel.js";
import type {
  DeviceInfo,
  NetworkDeviceAdapter,
  NetworkUserSpec,
  DeviceHealth,
  DeviceSession,
  ConnectedAccessPoint,
  DeviceVlanInterface,
  CreateVlanInterfaceSpec,
  DeviceIpPool,
  DeviceProfile,
} from "../adapter.interface.js";

export interface MikroTikCredentials {
  host: string;
  port: number;
  useTls: boolean;
  username: string;
  password: string;
}

/** Real RouterOS API adapter — PPP secrets for PPPoE, real health/session queries. Hotspot
 *  user management uses the same `/ip/hotspot/user/*` command family and is added alongside
 *  PPP once Phase 4's voucher flow needs it directly against a router (vouchers are RADIUS
 *  users first — see docs/architecture/06 — so most hotspot auth doesn't call this adapter at all). */
export class MikroTikAdapter implements NetworkDeviceAdapter {
  private client: RouterOSClient | null = null;

  constructor(private readonly credentials: MikroTikCredentials) {}

  async connect(): Promise<void> {
    const client = new RouterOSClient({
      host: this.credentials.host,
      port: this.credentials.port,
      useTls: this.credentials.useTls,
    });
    await client.connect();
    try {
      await client.login(this.credentials.username, this.credentials.password);
    } catch (err) {
      // A failed or timed-out login must close its socket. Left open, RouterOS keeps the session
      // (an "api-login" job) alive; with the health poll retrying, those pile up until a small
      // router like a hAP lite sits at 100% CPU and stops serving its hotspot.
      client.disconnect();
      throw err;
    }
    this.client = client;
  }

  async disconnect(): Promise<void> {
    this.client?.disconnect();
    this.client = null;
  }

  private requireClient(): RouterOSClient {
    if (!this.client) throw new Error("MikroTikAdapter: call connect() first");
    return this.client;
  }

  async healthCheck(): Promise<DeviceHealth> {
    try {
      const client = this.requireClient();
      const [resource] = await client.print(["/system/resource/print"]);
      const [identity] = await client.print(["/system/identity/print"]);
      if (!resource) return { reachable: false, error: "No response from /system/resource/print" };
      // RouterOS 7 lists sensors as name/value rows; RouterOS 6 has one row of fields. Not every
      // board has a sensor, and that is not an error.
      const health = await client.print(["/system/health/print"]).catch(() => [] as Array<Record<string, string>>);
      const tempRaw =
        health.find((h) => h["name"] === "temperature" || h["name"] === "cpu-temperature" || h["name"] === "board-temperature1")?.["value"] ??
        health[0]?.["temperature"] ??
        health[0]?.["cpu-temperature"];
      const temperatureC = tempRaw !== undefined && Number.isFinite(Number(tempRaw)) ? Number(tempRaw) : undefined;

      return {
        reachable: true,
        cpuLoadPercent: resource["cpu-load"] ? Number(resource["cpu-load"]) : undefined,
        memoryUsedBytes:
          resource["total-memory"] && resource["free-memory"]
            ? BigInt(resource["total-memory"]) - BigInt(resource["free-memory"])
            : undefined,
        memoryTotalBytes: resource["total-memory"] ? BigInt(resource["total-memory"]) : undefined,
        uptimeSeconds: resource["uptime"] ? parseRouterOSUptime(resource["uptime"]) : undefined,
        temperatureC,
        identity: identity?.["name"],
        version: resource["version"],
      };
    } catch (err) {
      return { reachable: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getActiveSessions(): Promise<DeviceSession[]> {
    const [pppRows, hotspotRows] = await Promise.all([
      this.requireClient().print(["/ppp/active/print"]),
      // A router with no hotspot server configured just returns an empty list here, not an
      // error — RouterOS's /ip hotspot active/print is always a valid (if empty) command.
      this.requireClient().print(["/ip/hotspot/active/print"]),
    ]);
    const ppp = pppRows.map((row) => ({
      username: row["name"] ?? "",
      address: row["address"],
      uptime: row["uptime"],
      callerId: row["caller-id"],
    }));
    // Hotspot sessions have no PPP caller-id; their closest equivalent client identifier is the
    // connecting device's MAC address, reusing the same field rather than adding a new one only
    // one of the two session kinds would populate.
    const hotspot = hotspotRows.map((row) => ({
      username: row["user"] ?? "",
      address: row["address"],
      uptime: row["uptime"],
      callerId: row["mac-address"],
      bytesIn: row["bytes-in"] ? Number(row["bytes-in"]) : undefined,
      bytesOut: row["bytes-out"] ? Number(row["bytes-out"]) : undefined,
    }));
    return [...ppp, ...hotspot];
  }

  async getConnectedAccessPoints(): Promise<ConnectedAccessPoint[]> {
    const client = this.requireClient();
    const accessPoints: ConnectedAccessPoint[] = [];
    const seenMacs = new Set<string>();

    // 0. Build physical port mapping from Bridge Host table (/interface/bridge/host/print)
    // When ports (e.g. ether2, ether3) are bridged, this maps the AP MAC directly to the physical port.
    const macToPort = new Map<string, string>();
    try {
      const bridgeHosts = await client.print(["/interface/bridge/host/print"]);
      for (const bh of bridgeHosts) {
        const mac = (bh["mac-address"] || "").trim().toUpperCase();
        const port = bh["on-interface"] || bh["interface"];
        if (mac && port) {
          macToPort.set(mac, port);
        }
      }
    } catch {
      // ignore bridge host lookup failure (e.g. unbridged router)
    }

    // 1. Check /ip/neighbor/print (MNDP, CDP, LLDP) - identifies connected APs, bridges, Ubiquiti, TP-Link, Ruijie, MikroTik
    try {
      const neighbors = await client.print(["/ip/neighbor/print"]);
      for (const row of neighbors) {
        const mac = (row["mac-address"] || "").trim().toUpperCase();
        const identity = row["identity"] || row["system-description"] || "Access Point";
        let iface = row["interface"] || "";
        const address = row["address"] || row["ipv4-address"] || "";
        const board = row["board"] || row["platform"] || row["model"] || "";
        const version = row["version"] || "";
        const uptime = row["uptime"] || "";

        // If interface is a bridge, resolve exact physical port from bridge host table
        if (mac && macToPort.has(mac)) {
          const physicalPort = macToPort.get(mac)!;
          if (physicalPort && (!iface || iface.toLowerCase().includes("bridge"))) {
            iface = physicalPort;
          }
        }

        if (mac) seenMacs.add(mac);
        accessPoints.push({
          identity,
          ipAddress: address || undefined,
          macAddress: mac,
          interface: iface || "LAN",
          board: board || undefined,
          platform: row["platform"] || undefined,
          version: version || undefined,
          uptime: uptime || undefined,
          detectionSource: "NEIGHBOR",
        });
      }
    } catch {
      // ignore neighbor lookup failure
    }

    // 2. Check /interface/wireless/registration-table/print (Local Wi-Fi / CAPsMAN / wireless clients)
    try {
      const wirelessClients = await client.print(["/interface/wireless/registration-table/print"]);
      for (const row of wirelessClients) {
        const mac = (row["mac-address"] || "").trim().toUpperCase();
        if (mac && !seenMacs.has(mac)) {
          seenMacs.add(mac);
          accessPoints.push({
            identity: row["comment"] || row["radio-name"] || `Wireless Client (${mac.slice(-8)})`,
            macAddress: mac,
            interface: row["interface"] || "wlan",
            signal: row["signal-strength"] || undefined,
            uptime: row["uptime"] || undefined,
            detectionSource: "WIRELESS",
          });
        }
      }
    } catch {
      // not a wireless router or wireless pkg not installed
    }

    // 3. Check /ip/dhcp-server/lease/print for APs/CPEs that got DHCP leases
    try {
      const leases = await client.print(["/ip/dhcp-server/lease/print", "?status=bound"]);
      for (const row of leases) {
        const mac = (row["mac-address"] || "").trim().toUpperCase();
        const hostName = (row["host-name"] || "").trim();
        // If it looks like an AP, CPE, antenna or has a name, or matches AP vendors
        if (mac && !seenMacs.has(mac) && hostName) {
          seenMacs.add(mac);
          const physicalPort = macToPort.get(mac);
          accessPoints.push({
            identity: hostName,
            ipAddress: row["address"] || undefined,
            macAddress: mac,
            interface: physicalPort || row["server"] || "LAN",
            uptime: row["last-seen"] || row["expires-after"] || undefined,
            detectionSource: "DHCP",
          });
        }
      }
    } catch {
      // ignore DHCP lease check failure
    }

    return accessPoints;
  }

  async createUser(user: NetworkUserSpec): Promise<void> {
    const words = [
      "/ppp/secret/add",
      `=name=${user.username}`,
      `=password=${user.password}`,
      "=service=pppoe",
    ];
    if (user.profile) words.push(`=profile=${user.profile}`);
    // Deliberately NOT `=rate-limit=`. A PPP secret has no such property: RouterOS 7.12.1 answers
    // `!trap unknown parameter rate-limit` and creates nothing at all, so passing it did not just
    // lose the speed setting, it silently aborted the whole account creation. Per-subscriber
    // speed is delivered by the Mikrotik-Rate-Limit RADIUS reply attribute (see
    // packages/radius' provisioning service), which is the same mechanism the voucher flow
    // already uses; a package's PPP profile carries it otherwise.
    if (user.comment) words.push(`=comment=${user.comment}`);
    await this.requireClient().talk(words);
  }

  private async findSecretId(username: string): Promise<string> {
    const rows = await this.requireClient().print(["/ppp/secret/print", `?name=${username}`]);
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`No PPP secret found on router for username "${username}"`);
    return id;
  }

  async updateUser(username: string, patch: Partial<NetworkUserSpec>): Promise<void> {
    const id = await this.findSecretId(username);
    const words = ["/ppp/secret/set", `=.id=${id}`];
    if (patch.password) words.push(`=password=${patch.password}`);
    if (patch.profile) words.push(`=profile=${patch.profile}`);
    // Same reason as createUser: `rate-limit` is not a /ppp/secret property. Speed changes are
    // applied through the RADIUS reply attribute, not here.
    if (patch.comment) words.push(`=comment=${patch.comment}`);
    await this.requireClient().talk(words);
  }

  async disableUser(username: string): Promise<void> {
    const id = await this.findSecretId(username);
    await this.requireClient().talk(["/ppp/secret/set", `=.id=${id}`, "=disabled=yes"]);
    await this.disconnectUser(username).catch(() => {
      // Best-effort: if there's no active session to kick, that's fine — the secret is
      // disabled either way, which prevents any *future* login.
    });
  }

  async enableUser(username: string): Promise<void> {
    const id = await this.findSecretId(username);
    await this.requireClient().talk(["/ppp/secret/set", `=.id=${id}`, "=disabled=no"]);
  }

  async disconnectUser(username: string): Promise<void> {
    const pppRows = await this.requireClient().print(["/ppp/active/print", `?name=${username}`]);
    const pppId = pppRows[0]?.[".id"];
    if (pppId) {
      await this.requireClient().talk(["/ppp/active/remove", `=.id=${pppId}`]);
      return;
    }
    // A hotspot session's active-table username field is "user", not "name" — vouchers and
    // hotspot-package logins only ever show up here, never in /ppp/active, so without this
    // fallback disconnectUser() silently no-ops for every hotspot user (the case data-cap
    // enforcement actually needs).
    const hotspotRows = await this.requireClient().print(["/ip/hotspot/active/print", `?user=${username}`]);
    const hotspotId = hotspotRows[0]?.[".id"];
    if (!hotspotId) return; // no active session under either service — nothing to disconnect
    await this.requireClient().talk(["/ip/hotspot/active/remove", `=.id=${hotspotId}`]);
  }

  async disconnectAllSessions(): Promise<number> {
    const [pppRows, hotspotRows] = await Promise.all([
      this.requireClient().print(["/ppp/active/print"]),
      this.requireClient().print(["/ip/hotspot/active/print"]),
    ]);
    let removed = 0;
    for (const row of pppRows) {
      const id = row[".id"];
      if (!id) continue;
      await this.requireClient().talk(["/ppp/active/remove", `=.id=${id}`]);
      removed++;
    }
    for (const row of hotspotRows) {
      const id = row[".id"];
      if (!id) continue;
      await this.requireClient().talk(["/ip/hotspot/active/remove", `=.id=${id}`]);
      removed++;
    }
    return removed;
  }

  async applySpeedtestBoost(): Promise<{ success: boolean; message: string }> {
    const client = this.requireClient();
    const domains = ["speedtest.net", "fast.com", "speedtestcustom.com", "ookla.com"];

    for (const domain of domains) {
      const existing = await client.print([
        "/ip/firewall/address-list/print",
        "?list=SPEEDTEST_SERVERS",
        `?address=${domain}`,
      ]).catch(() => []);
      if (!existing || existing.length === 0) {
        await client.talk([
          "/ip/firewall/address-list/add",
          "=list=SPEEDTEST_SERVERS",
          `=address=${domain}`,
          "=comment=Ookla & Fast.com Speedtest Boost",
        ]).catch(() => {});
      }
    }

    const existingConn = await client.print([
      "/ip/firewall/mangle/print",
      "?comment=Speedtest Boost Connection",
    ]).catch(() => []);
    if (!existingConn || existingConn.length === 0) {
      await client.talk([
        "/ip/firewall/mangle/add",
        "=chain=prerouting",
        "=dst-address-list=SPEEDTEST_SERVERS",
        "=action=mark-connection",
        "=new-connection-mark=speedtest_conn",
        "=passthrough=yes",
        "=comment=Speedtest Boost Connection",
      ]).catch(() => {});
    }

    const existingPkt = await client.print([
      "/ip/firewall/mangle/print",
      "?comment=Speedtest Boost Packet",
    ]).catch(() => []);
    if (!existingPkt || existingPkt.length === 0) {
      await client.talk([
        "/ip/firewall/mangle/add",
        "=chain=prerouting",
        "=connection-mark=speedtest_conn",
        "=action=mark-packet",
        "=new-packet-mark=speedtest_pkt",
        "=passthrough=no",
        "=comment=Speedtest Boost Packet",
      ]).catch(() => {});
    }

    const existingDl = await client.print([
      "/queue/tree/print",
      "?name=SPEEDTEST_BOOST_DOWNLOAD",
    ]).catch(() => []);
    if (!existingDl || existingDl.length === 0) {
      await client.talk([
        "/queue/tree/add",
        "=name=SPEEDTEST_BOOST_DOWNLOAD",
        "=parent=global",
        "=packet-mark=speedtest_pkt",
        "=max-limit=100M",
        "=limit-at=100M",
        "=priority=1",
        "=comment=100M Speedtest Boost",
      ]).catch(() => {});
    }

    const existingUl = await client.print([
      "/queue/tree/print",
      "?name=SPEEDTEST_BOOST_UPLOAD",
    ]).catch(() => []);
    if (!existingUl || existingUl.length === 0) {
      await client.talk([
        "/queue/tree/add",
        "=name=SPEEDTEST_BOOST_UPLOAD",
        "=parent=global",
        "=packet-mark=speedtest_pkt",
        "=max-limit=100M",
        "=limit-at=100M",
        "=priority=1",
        "=comment=100M Speedtest Boost",
      ]).catch(() => {});
    }

    return {
      success: true,
      message: "100 Mbps Speedtest Booster applied successfully on MikroTik!",
    };
  }

  async enforceStrictTimeout(): Promise<{ success: boolean; cookiesRemoved: number; message: string }> {
    const client = this.requireClient();

    const profiles = await client.print(["/ip/hotspot/profile/print"]).catch(() => []);
    for (const prof of profiles) {
      const id = prof[".id"];
      if (!id) continue;
      await client.talk([
        "/ip/hotspot/profile/set",
        `=.id=${id}`,
        "=login-by=http-chap,http-pap",
      ]).catch(() => {});
    }

    const cookies = await client.print(["/ip/hotspot/cookie/print"]).catch(() => []);
    let cookiesRemoved = 0;
    for (const cookie of cookies) {
      const id = cookie[".id"];
      if (!id) continue;
      await client.talk(["/ip/hotspot/cookie/remove", `=.id=${id}`]).catch(() => {});
      cookiesRemoved++;
    }

    const radiusServers = await client.print(["/radius/print"]).catch(() => []);
    for (const rad of radiusServers) {
      const id = rad[".id"];
      if (!id) continue;
      await client.talk([
        "/radius/set",
        `=.id=${id}`,
        "=interim-update=1m",
      ]).catch(() => {});
    }

    return {
      success: true,
      cookiesRemoved,
      message: `Strict 1-hour timeout enforced. Removed ${cookiesRemoved} cached cookie(s) and disabled silent re-auth.`,
    };
  }

  /** How many of "Block tunnelling apps"'s rules the router holds. */
  private async countAntiTunnelRules(): Promise<number> {
    const client = this.requireClient();
    const filter = await client.print(["/ip/firewall/filter/print", `?comment=${ANTI_TUNNEL_TAG}`]);
    const nat = await client.print(["/ip/firewall/nat/print", `?comment=${ANTI_TUNNEL_TAG}`]);
    return filter.length + nat.length;
  }

  /** Starts turning "Block tunnelling apps" on or off (see anti-tunnel.ts). The router runs the
   *  change as one background script, all or nothing; on a hAP lite that takes a minute or more,
   *  so this returns as soon as it has started. Follow it with getAntiTunnelStatus. */
  async startAntiTunnelShield(enabled: boolean): Promise<{ started: boolean }> {
    const expected = enabled ? antiTunnelRules().length : 0;
    // Already exactly as asked: rewriting the firewall again would only cost a small router minutes.
    if (enabled && (await this.countAntiTunnelRules().catch(() => -1)) === expected) return { started: false };
    await this.requireClient().talk(["/execute", `=script=${buildAntiTunnelScript(enabled)}`]);
    return { started: true };
  }

  /** Where the last change got to, from what the router itself recorded. "unknown" when the router
   *  is too busy to answer right now, which is normal while it rewrites its firewall. */
  async getAntiTunnelStatus(): Promise<{ state: "applying" | "done" | "failed" | "unknown"; rules: number | null; expected: number }> {
    const client = this.requireClient();
    const expected = antiTunnelRules().length;
    const env = await client.print(["/system/script/environment/print", `?name=${ANTI_TUNNEL_RESULT_VAR}`]).catch(() => null);
    if (env === null) return { state: "unknown", rules: null, expected };
    const value = env[0]?.["value"];
    const rules = await this.countAntiTunnelRules().catch(() => null);
    if (value === "running") return { state: "applying", rules, expected };
    if (value === "failed") return { state: "failed", rules, expected };
    // "done" only from the router's own "ok" plus a rule count we could read. No record at all
    // means the script never ran (or the router restarted): that is not a finished change.
    if (value === "ok" && rules !== null) return { state: "done", rules, expected };
    return { state: "unknown", rules, expected };
  }

  async enablePcqFairQueue(): Promise<{ success: boolean; message: string }> {
    const client = this.requireClient();

    // 1. Remove previous MKG PCQ queue types and trees if they exist
    const oldTrees = await client.print(["/queue/tree/print"]).catch(() => []);
    for (const t of oldTrees) {
      if ((t["name"] || "").startsWith("MKG_GLOBAL_") && t[".id"]) {
        await client.talk(["/queue/tree/remove", `=.id=${t[".id"]}`]).catch(() => {});
      }
    }

    const oldTypes = await client.print(["/queue/type/print"]).catch(() => []);
    for (const t of oldTypes) {
      if ((t["name"] || "").startsWith("mkg-pcq") && t[".id"]) {
        await client.talk(["/queue/type/remove", `=.id=${t[".id"]}`]).catch(() => {});
      }
    }

    // 2. Add PCQ queue types for fair-share sub-distribution
    await client.talk([
      "/queue/type/add",
      "=name=mkg-pcq-down",
      "=kind=pcq",
      "=pcq-rate=0",
      "=pcq-classifier=dst-address",
      "=pcq-limit=50KiB",
      "=pcq-total-limit=2000KiB",
    ]).catch(() => {});

    await client.talk([
      "/queue/type/add",
      "=name=mkg-pcq-up",
      "=kind=pcq",
      "=pcq-rate=0",
      "=pcq-classifier=src-address",
      "=pcq-limit=50KiB",
      "=pcq-total-limit=2000KiB",
    ]).catch(() => {});

    // 3. Attach PCQ to global queue tree so all active users dynamically share bandwidth without lagging
    await client.talk([
      "/queue/tree/add",
      "=name=MKG_GLOBAL_DOWNLOAD",
      "=parent=global",
      "=queue=mkg-pcq-down",
      "=priority=8",
      "=comment=MashupHost Fair Share PCQ Shaper",
    ]).catch(() => {});

    await client.talk([
      "/queue/tree/add",
      "=name=MKG_GLOBAL_UPLOAD",
      "=parent=global",
      "=queue=mkg-pcq-up",
      "=priority=8",
      "=comment=MashupHost Fair Share PCQ Shaper",
    ]).catch(() => {});

    return {
      success: true,
      message: "Dynamic Fair-Share (PCQ) Bandwidth Shaper activated across the router!",
    };
  }

  /**
   * Makes sure the router still has what its setup script gave it for the hotspot, repairing it
   * over the API when it doesn't — so a setup that was cut short, or settings changed by hand,
   * fix themselves without the operator touching the terminal:
   *  - hotspot/login.html, the page that sends customers to the branded portal (without it the
   *    router shows MikroTik's stock sign-in page);
   *  - exactly one platform RADIUS server, at `radiusHost`, with the router's shared secret.
   * Returns what it changed (empty when nothing needed fixing).
   */
  async ensureHotspotProvisioning(opts: {
    loginTemplateUrl: string;
    radiusHost: string;
    radiusSecret: string;
    /** RADIUS addresses the platform used before (e.g. its old default) — removed when stale. */
    retiredRadiusHosts?: string[];
    /** Hosts an unauthenticated customer must reach: the portal the login page redirects to and
     *  the API it calls. Missing from the walled garden, the redirect lands on a blocked page and
     *  the customer never sees a sign-in screen. IPs and hostnames both accepted. */
    walledGardenHosts?: string[];
    /** The per-app package filter (see app-filter.ts): installed when its rules are missing. */
    appFilter?: { scriptUrl: string; tag: string; expectedRules: number };
  }): Promise<string[]> {
    const client = this.requireClient();
    const changes: string[] = [];

    // Login by MAC, so a phone that has paid is logged back in when it reconnects. Added to the
    // RADIUS hotspot profiles of routers set up before this existed.
    const profiles = await client.print(["/ip/hotspot/profile/print"]).catch(() => []);
    for (const profile of profiles) {
      const loginBy = (profile["login-by"] ?? "").split(",").filter(Boolean);
      if (profile["use-radius"] !== "true" || loginBy.includes("mac") || !profile[".id"]) continue;
      await client.talk(["/ip/hotspot/profile/set", `=.id=${profile[".id"]}`, `=login-by=${["mac", ...loginBy].join(",")}`]);
      changes.push(`turned on login by MAC for hotspot profile ${profile["name"] ?? profile[".id"]}`);
    }

    if (opts.appFilter) {
      const rules = await client.print(["/ip/firewall/filter/print", `?comment=${opts.appFilter.tag}`]).catch(() => null);
      if (rules !== null && rules.length < opts.appFilter.expectedRules) {
        // Download and import both run on the router in the background: on a busy hAP lite the
        // fetch alone can outlast an API call's timeout, and the import takes ~20 s. A dropped API
        // session must not cut either short.
        const script = `:do {/tool fetch url="${opts.appFilter.scriptUrl}" dst-path=mkg-app-filter.rsc check-certificate=no; :delay 2s; /import mkg-app-filter.rsc} on-error={:log warning "MASHUPKGRID per-app filter install failed"}`;
        await client.talk(["/execute", `=script=${script}`]);
        changes.push(`installed the per-app package filter (had ${rules.length} of ${opts.appFilter.expectedRules} rules)`);
      }
    }

    if (opts.walledGardenHosts?.length) {
      const ipEntries = await client.print(["/ip/hotspot/walled-garden/ip/print"]);
      const httpEntries = await client.print(["/ip/hotspot/walled-garden/print"]);
      for (const host of [...new Set(opts.walledGardenHosts)]) {
        const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
        if (isIp) {
          if (!ipEntries.some((e) => e["dst-address"] === host)) {
            assertNoTrap(await client.talk(["/ip/hotspot/walled-garden/ip/add", `=dst-address=${host}`, "=action=accept", "=comment=MASHUPKGRID"]), "walled-garden ip add");
            changes.push(`allowed ${host} before login`);
          }
          continue;
        }
        if (!httpEntries.some((e) => e["dst-host"] === host)) {
          assertNoTrap(await client.talk(["/ip/hotspot/walled-garden/add", `=dst-host=${host}`, "=action=allow", "=comment=MASHUPKGRID"]), "walled-garden add");
          changes.push(`allowed ${host} before login`);
        }
        if (!host.includes("*") && !ipEntries.some((e) => e["dst-host"] === host)) {
          assertNoTrap(await client.talk(["/ip/hotspot/walled-garden/ip/add", `=dst-host=${host}`, "=action=accept", "=comment=MASHUPKGRID"]), "walled-garden ip add");
        }
      }
    }

    // Older setup scripts opened the API and WinBox to the whole internet. Once the restricted
    // management rule exists (current script), those leftovers are pure exposure — remove them.
    // Never before: without the new rule, removing them could cut the platform off the router.
    const filters = await client.print(["/ip/firewall/filter/print", "=.proplist=.id,comment"]);
    if (filters.some((f) => f["comment"] === "MASHUPKGRID MANAGEMENT")) {
      for (const f of filters) {
        if ((f["comment"] === "MASHUPKGRID ISP API" || f["comment"] === "MASHUPKGRID WINBOX REMOTE") && f[".id"]) {
          assertNoTrap(await client.talk(["/ip/firewall/filter/remove", `=.id=${f[".id"]}`]), "/ip/firewall/filter/remove");
          changes.push(`removed internet-open rule "${f["comment"]}"`);
        }
      }
    }

    const loginPage = await client.print(["/file/print", "?name=hotspot/login.html"]);
    if (loginPage.length === 0) {
      assertNoTrap(
        await client.talk(["/tool/fetch", `=url=${opts.loginTemplateUrl}`, "=dst-path=hotspot/login.html", "=check-certificate=no"]),
        "/tool/fetch login.html"
      );
      changes.push("downloaded hotspot/login.html");
    }

    // The branded "you're online" page (routers set up before it existed don't have it).
    const aloginPage = await client.print(["/file/print", "?name=hotspot/alogin.html"]);
    if (aloginPage.length === 0) {
      const aloginUrl = opts.loginTemplateUrl.replace(/mikrotik-login-template(\?|$)/, "mikrotik-alogin-template$1");
      assertNoTrap(
        await client.talk(["/tool/fetch", `=url=${aloginUrl}`, "=dst-path=hotspot/alogin.html", "=check-certificate=no"]),
        "/tool/fetch alogin.html"
      );
      changes.push("downloaded hotspot/alogin.html");
    }

    const servers = await client.print(["/radius/print"]);
    const retired = new Set(opts.retiredRadiusHosts ?? []);
    for (const s of servers) {
      const ours = s["comment"] === "MASHUPKGRID" || retired.has(s["address"] ?? "");
      if (ours && s["address"] !== opts.radiusHost && s[".id"]) {
        assertNoTrap(await client.talk(["/radius/remove", `=.id=${s[".id"]}`]), "/radius/remove");
        changes.push(`removed stale RADIUS ${s["address"]}`);
      }
    }
    const current = servers.find((s) => s["address"] === opts.radiusHost);
    if (!current) {
      assertNoTrap(
        await client.talk([
          "/radius/add",
          "=service=ppp,hotspot",
          `=address=${opts.radiusHost}`,
          `=secret=${opts.radiusSecret}`,
          "=authentication-port=1812",
          "=accounting-port=1813",
          "=timeout=3s",
          "=comment=MASHUPKGRID",
        ]),
        "/radius/add"
      );
      changes.push(`added RADIUS ${opts.radiusHost}`);
    }
    return changes;
  }

  async enableSafeFamilyDns(familyMode = true): Promise<{ success: boolean; message: string; servers: string }> {
    const client = this.requireClient();
    const servers = familyMode ? "1.1.1.3,1.0.0.3" : "8.8.8.8,1.1.1.1";

    await client.talk([
      "/ip/dns/set",
      `=servers=${servers}`,
      "=allow-remote-requests=yes",
    ]);

    return {
      success: true,
      servers,
      message: familyMode
        ? "Cloudflare Family DNS active (Automatic Malware and Adult Content blocking enabled)!"
        : "Standard High-Speed DNS restored (8.8.8.8, 1.1.1.1)!",
    };
  }

  async checkFirmwareUpdate(): Promise<{ currentVersion: string; latestVersion: string; status: string; upgradeAvailable: boolean }> {
    const client = this.requireClient();
    await client.talk(["/system/package/update/check-for-updates"]).catch(() => {});
    const updates = await client.print(["/system/package/update/print"]).catch(() => []);
    const row = updates[0] || {};
    const installed = row["installed-version"] || "Unknown";
    const latest = row["latest-version"] || installed;
    const status = row["status"] || "Up to date";
    const upgradeAvailable = Boolean(latest && installed && latest !== installed && status.toLowerCase().includes("new"));

    return {
      currentVersion: installed,
      latestVersion: latest,
      status,
      upgradeAvailable,
    };
  }

  async installFirmwareUpdate(): Promise<{ success: boolean; message: string }> {
    const client = this.requireClient();
    await client.talk(["/system/package/update/install"]);
    return {
      success: true,
      message: "RouterOS Firmware update initiated! The router will download the latest package and reboot automatically.",
    };
  }
  // --- Over-the-air updates ------------------------------------------------------------------

  async getDeviceInfo(): Promise<DeviceInfo> {
    const client = this.requireClient();
    const [resource] = await client.print(["/system/resource/print"]);
    // x86/CHR builds have no RouterBOARD menu; that is not an error.
    const [board] = await client.print(["/system/routerboard/print"]).catch(() => [] as Array<Record<string, string>>);
    return {
      routerOsVersion: resource?.["version"] ?? null,
      boardName: resource?.["board-name"] ?? board?.["model"] ?? null,
      firmwareCurrent: board?.["current-firmware"] ?? null,
      firmwareAvailable: board?.["upgrade-firmware"] ?? null,
    };
  }

  async upgradeRouterboardFirmware(): Promise<{ changed: boolean; from: string; to: string }> {
    const client = this.requireClient();
    const [board] = await client.print(["/system/routerboard/print"]);
    if (!board) throw new Error("This device has no RouterBOARD firmware to upgrade");
    const from = board["current-firmware"] ?? "unknown";
    const to = board["upgrade-firmware"] ?? from;
    if (from === to) return { changed: false, from, to };
    assertNoTrap(await client.talk(["/system/routerboard/upgrade"]), "/system/routerboard/upgrade");
    // The new firmware is only used after a reboot.
    await this.reboot();
    return { changed: true, from, to };
  }

  async reboot(): Promise<void> {
    // The router drops the API connection as it goes down; that is the expected outcome.
    await this.requireClient()
      .talk(["/system/reboot"])
      .catch(() => undefined);
  }

  async runScript(source: string): Promise<string> {
    const replies = await this.requireClient().talk(["/execute", `=script=${source}`, "=as-string="]);
    assertNoTrap(replies, "/execute");
    return replies.map((r) => r.attributes["ret"]).find((v) => v !== undefined) ?? "";
  }

  async exportConfig(): Promise<string> {
    const client = this.requireClient();
    const name = "mkg-backup.rsc";
    await client.print(["/file/print", `?name=${name}`]).then((rows) => (rows[0]?.[".id"] ? client.talk(["/file/remove", `=.id=${rows[0][".id"]}`]) : null)).catch(() => undefined);
    // RouterOS 7 hides passwords and keys in an export unless asked; a backup without them could
    // not bring a router back. RouterOS 6 has no such flag and includes them anyway.
    await client.talk(["/execute", `=script=:do {/export show-sensitive file=mkg-backup} on-error={/export file=mkg-backup}`]);
    let size = 0;
    for (let i = 0; i < 30; i++) {
      const [file] = await client.print(["/file/print", `?name=${name}`]).catch(() => []);
      const now = Number(file?.["size"] ?? 0);
      if (file && now > 0 && now === size) break;
      size = now;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!size) throw new Error("The router did not produce an export file");
    let content = "";
    try {
      // RouterOS 7.13+ reads a file in chunks; the only way to read a large export.
      for (let offset = 0; offset < size; ) {
        const replies = await client.talk(["/file/read", `=file=${name}`, "=chunk-size=32768", `=offset=${offset}`]);
        const data = replies.map((r) => r.attributes["data"]).find((d) => d !== undefined) ?? "";
        if (!data) break;
        content += data;
        offset += Buffer.byteLength(data);
      }
    } catch {
      content = "";
    }
    if (!content) {
      const [file] = await client.print(["/file/print", `?name=${name}`, "=.proplist=contents,size"]);
      content = file?.["contents"] ?? "";
      if (Buffer.byteLength(content) < size) throw new Error("This RouterOS version cannot hand over a large export; upgrade to RouterOS 7.13 or newer");
    }
    await client.print(["/file/print", `?name=${name}`]).then((rows) => (rows[0]?.[".id"] ? client.talk(["/file/remove", `=.id=${rows[0][".id"]}`]) : null)).catch(() => undefined);
    return content;
  }

  async restoreConfigFromUrl(url: string): Promise<void> {
    const client = this.requireClient();
    const name = "mkg-restore.rsc";
    // Download first and confirm the file arrived; only then reset. A failed download must never
    // reach the reset, or the router would come back empty.
    await client.talk(["/execute", `=script=/tool fetch url="${url}" dst-path=${name} check-certificate=no`]).catch(() => undefined);
    let size = 0;
    for (let i = 0; i < 40 && !size; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const [file] = await client.print(["/file/print", `?name=${name}`]).catch(() => []);
      size = Number(file?.["size"] ?? 0);
    }
    if (!size) throw new Error("The router could not download the backup, so nothing was changed");
    // The reset reboots the router and drops this connection; that is the expected end.
    await client.talk(["/execute", `=script=/system reset-configuration no-defaults=yes skip-backup=yes run-after-reset=${name}`]).catch(() => undefined);
  }

  // --- VLAN and addressing (spec section 9) ---------------------------------------------------
  // Every method here reports what the DEVICE said. None of them assume a topology: the parent
  // interface a VLAN stacks on is always supplied by the caller, because it is the ISP's network
  // design and not something this system may guess at.

  async listVlanInterfaces(): Promise<DeviceVlanInterface[]> {
    const rows = await this.requireClient().print(["/interface/vlan/print"]);
    return rows.map((r) => parseVlanInterfaceRow(r));
  }

  private async findVlanRow(name: string): Promise<Record<string, string> | null> {
    const rows = await this.requireClient().print(["/interface/vlan/print", `?name=${name}`]);
    return rows[0] ?? null;
  }

  async createVlanInterface(spec: CreateVlanInterfaceSpec): Promise<DeviceVlanInterface> {
    // Validate the parent exists before adding. RouterOS would reject an unknown interface
    // anyway, but its error is terse; naming the real problem is what lets an admin fix it.
    const parents = await this.requireClient().print([
      "/interface/print",
      `?name=${spec.parentInterface}`,
    ]);
    if (parents.length === 0) {
      throw new Error(
        `Interface "${spec.parentInterface}" does not exist on this router - pick one of its real interfaces to carry the VLAN.`
      );
    }

    const words = [
      "/interface/vlan/add",
      `=name=${spec.name}`,
      `=vlan-id=${spec.vlanId}`,
      `=interface=${spec.parentInterface}`,
    ];
    if (spec.mtu) words.push(`=mtu=${spec.mtu}`);
    if (spec.comment) words.push(`=comment=${spec.comment}`);
    await this.requireClient().talk(words);

    // Read back rather than returning what we sent. If the device normalized or quietly altered
    // anything, the caller must see the device's version, not our optimistic one.
    const created = await this.findVlanRow(spec.name);
    if (!created) {
      throw new Error(`Router accepted VLAN "${spec.name}" but it is absent on read-back.`);
    }
    return parseVlanInterfaceRow(created);
  }

  async updateVlanInterface(
    name: string,
    patch: Partial<CreateVlanInterfaceSpec>
  ): Promise<DeviceVlanInterface> {
    const row = await this.findVlanRow(name);
    if (!row) throw new Error(`No VLAN interface named "${name}" on this router.`);

    const words = ["/interface/vlan/set", `=.id=${row[".id"]}`];
    if (patch.name !== undefined) words.push(`=name=${patch.name}`);
    if (patch.vlanId !== undefined) words.push(`=vlan-id=${patch.vlanId}`);
    if (patch.parentInterface !== undefined) words.push(`=interface=${patch.parentInterface}`);
    if (patch.mtu !== undefined) words.push(`=mtu=${patch.mtu}`);
    if (patch.comment !== undefined) words.push(`=comment=${patch.comment}`);
    if (words.length === 2) return parseVlanInterfaceRow(row); // nothing asked to change

    await this.requireClient().talk(words);
    const after = await this.findVlanRow(patch.name ?? name);
    if (!after) throw new Error(`VLAN "${name}" vanished from the router during update.`);
    return parseVlanInterfaceRow(after);
  }

  async setVlanInterfaceEnabled(name: string, enabled: boolean): Promise<DeviceVlanInterface> {
    const row = await this.findVlanRow(name);
    if (!row) throw new Error(`No VLAN interface named "${name}" on this router.`);
    await this.requireClient().talk([
      enabled ? "/interface/vlan/enable" : "/interface/vlan/disable",
      `=.id=${row[".id"]}`,
    ]);
    const after = await this.findVlanRow(name);
    if (!after) throw new Error(`VLAN "${name}" vanished from the router.`);
    return parseVlanInterfaceRow(after);
  }

  /**
   * Removing a VLAN interface drops every subscriber riding it, so the target is confirmed twice
   * before anything is deleted: it must exist, AND its vlan-id must match what the caller
   * believes it is removing. A name collision, or a VLAN re-tagged on the device by hand, would
   * otherwise make this delete the wrong interface (spec section 9: validate the target and
   * configuration before destructive network changes).
   */
  async removeVlanInterface(name: string, expectedVlanId: number): Promise<void> {
    const row = await this.findVlanRow(name);
    if (!row) return; // already absent - removal is idempotent
    const actual = Number(row["vlan-id"] ?? 0);
    if (actual !== expectedVlanId) {
      throw new Error(
        `Refusing to remove "${name}": this router has it as VLAN ${actual}, not VLAN ${expectedVlanId}. ` +
          `It was changed on the device - reconcile before removing.`
      );
    }
    await this.requireClient().talk(["/interface/vlan/remove", `=.id=${row[".id"]}`]);
  }

  async listInterfaces(): Promise<Array<{ name: string; type: string; running: boolean }>> {
    const rows = await this.requireClient().print(["/interface/print"]);
    return rows.map((r) => ({
      name: r["name"] ?? "",
      type: r["type"] ?? "",
      running: r["running"] === "true",
    }));
  }

  async listIpPools(): Promise<DeviceIpPool[]> {
    const rows = await this.requireClient().print(["/ip/pool/print"]);
    return rows.map((r) => ({
      id: r[".id"] ?? "",
      name: r["name"] ?? "",
      ranges: r["ranges"] ?? "",
    }));
  }

  /** Idempotent by pool name: re-running a provisioning job must not stack duplicate pools,
   *  which is the requirement spec section 18 places on every job. */
  async upsertIpPool(name: string, ranges: string): Promise<DeviceIpPool> {
    const existing = await this.requireClient().print(["/ip/pool/print", `?name=${name}`]);
    if (existing[0]) {
      await this.requireClient().talk([
        "/ip/pool/set",
        `=.id=${existing[0][".id"]}`,
        `=ranges=${ranges}`,
      ]);
    } else {
      await this.requireClient().talk(["/ip/pool/add", `=name=${name}`, `=ranges=${ranges}`]);
    }
    const rows = await this.requireClient().print(["/ip/pool/print", `?name=${name}`]);
    const row = rows[0];
    if (!row) throw new Error(`IP pool "${name}" is absent on read-back.`);
    return { id: row[".id"] ?? "", name: row["name"] ?? "", ranges: row["ranges"] ?? "" };
  }

  /** Idempotent by (address, interface) so a retried job does not add the same gateway twice. */
  async assignIpAddress(interfaceName: string, addressCidr: string): Promise<void> {
    const existing = await this.requireClient().print([
      "/ip/address/print",
      `?address=${addressCidr}`,
      `?interface=${interfaceName}`,
    ]);
    if (existing.length > 0) return;
    await this.requireClient().talk([
      "/ip/address/add",
      `=address=${addressCidr}`,
      `=interface=${interfaceName}`,
    ]);
  }

  async listPppProfiles(): Promise<DeviceProfile[]> {
    const rows = await this.requireClient().print(["/ppp/profile/print"]);
    return rows.map((r) => ({
      id: r[".id"] ?? "",
      name: r["name"] ?? "",
      ...(r["rate-limit"] ? { rateLimit: r["rate-limit"] } : {}),
    }));
  }

  async listHotspotProfiles(): Promise<DeviceProfile[]> {
    const rows = await this.requireClient().print(["/ip/hotspot/user/profile/print"]);
    return rows.map((r) => ({
      id: r[".id"] ?? "",
      name: r["name"] ?? "",
      ...(r["rate-limit"] ? { rateLimit: r["rate-limit"] } : {}),
    }));
  }
}

/** RouterOS reports uptime as e.g. "4w2d3h4m5s" — parses it into whole seconds. */
export function parseRouterOSUptime(value: string): number {
  const pattern = /(\d+)([wdhms])/g;
  const unitSeconds: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    total += Number(match[1]) * (unitSeconds[match[2]!] ?? 0);
  }
  return total;
}

/**
 * Maps one `/interface/vlan/print` row to the vendor-agnostic shape. Exported so it can be tested
 * against real captured RouterOS output without a device on the network — the field names and the
 * string-typed booleans below were taken from a live hAP lite on RouterOS 7.12.1, not from docs.
 */
export function parseVlanInterfaceRow(row: Record<string, string>): DeviceVlanInterface {
  return {
    id: row[".id"] ?? "",
    name: row["name"] ?? "",
    vlanId: Number(row["vlan-id"] ?? 0),
    parentInterface: row["interface"] ?? "",
    ...(row["mtu"] ? { mtu: Number(row["mtu"]) } : {}),
    // RouterOS sends these as the STRINGS "true"/"false". A truthiness check would read every
    // row as disabled, since the non-empty string "false" is truthy in JavaScript.
    disabled: row["disabled"] === "true",
    ...(row["running"] !== undefined ? { running: row["running"] === "true" } : {}),
    ...(row["comment"] ? { comment: row["comment"] } : {}),
  };
}
