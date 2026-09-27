import { describe, expect, it } from "vitest";
import type { Router } from "@mashupkgrid/database";
import {
  buildMikrotikProvisioningScript as buildRawScript,
  buildMikrotikWinboxScript,
  buildHeartbeatScript,
  deferred,
  managementSources,
  plainCommands,
} from "../setup-script.js";

/** The script as the plain commands it runs (each is wrapped in :parse on the router). */
const buildMikrotikProvisioningScript = (...args: Parameters<typeof buildRawScript>) => plainCommands(buildRawScript(...args));

const router = { id: "11111111-1111-1111-1111-111111111111", name: "hAP test", apiPort: 8728, useTls: false } as unknown as Router;
const credentials = { username: "mashupkgrid-api", password: "router-generated-secret" };
const callbackUrl = "https://api.example.com/api/v1/routers/provision/token123/callback";

/** Every firewall rule that accepts traffic to the router itself (chain=input). */
function inputAcceptRules(script: string): string[] {
  return script.split("\n").filter((l) => l.includes("/ip firewall filter add") && l.includes("chain=input") && l.includes("action=accept"));
}

describe("router setup script — management access", () => {
  const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
    managementSource: "68.210.187.104",
    vpnSubnet: "10.90.0.0/16",
    loginTemplateUrl: "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template",
  });

  it("never opens the API or WinBox to the whole internet", () => {
    const rules = inputAcceptRules(script);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).toContain('src-address-list="mashup-mgmt"');
    expect(script).not.toMatch(/dst-port=8291 action=accept/);
  });

  it("allows exactly the platform, its VPN and the router's LAN", () => {
    for (const source of ["68.210.187.104", "10.90.0.0/16", "192.168.88.0/24"]) {
      expect(script).toContain(`list="mashup-mgmt" address=${source}`);
    }
    expect(script).toContain("/ip service set api disabled=no port=8728 address=68.210.187.104,10.90.0.0/16,192.168.88.0/24");
    expect(script).toContain("/ip service set winbox disabled=no port=8291 address=68.210.187.104,10.90.0.0/16,192.168.88.0/24");
  });

  it("removes the old internet-open rules when re-run on an existing router", () => {
    expect(script).toContain('/ip firewall filter remove [find comment="MASHUPKGRID ISP API"]');
    expect(script).toContain('/ip firewall filter remove [find comment="MASHUPKGRID WINBOX REMOTE"]');
  });

  it("turns off the unused API variant, telnet and FTP", () => {
    expect(script).toContain("/ip service set api-ssl disabled=yes");
    expect(script).toContain("/ip service set telnet disabled=yes");
    expect(script).toContain("/ip service set ftp disabled=yes");
    expect(script).not.toContain("/ip service set api disabled=yes");
  });

  it("restricts api-ssl instead when the router uses TLS", () => {
    const tls = buildMikrotikProvisioningScript({ ...router, apiPort: 8729, useTls: true } as Router, credentials, callbackUrl, { managementSource: "68.210.187.104" });
    expect(tls).toContain("/ip service set api-ssl disabled=no port=8729 address=");
    expect(tls).toContain("/ip service set api disabled=yes");
    expect(tls).not.toContain("/ip service set api-ssl disabled=yes");
    expect(inputAcceptRules(tls).every((r) => r.includes("dst-port=8729,8291") && r.includes("mashup-mgmt"))).toBe(true);
  });

  it("adds the VPN only when the server has a WireGuard key, using the configured subnet", () => {
    expect(script).not.toContain("/interface wireguard add");
    const withVpn = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
      managementSource: "68.210.187.104",
      vpnSubnet: "10.77.0.0/16",
      serverPublicKey: "SERVERPUBLICKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      vpnIp: "10.77.0.9",
    });
    expect(withVpn).toContain("/interface wireguard add name=mkg-wg");
    expect(withVpn).toContain("allowed-address=10.77.0.0/16");
    expect(withVpn).toContain("list=\"mashup-mgmt\" address=10.77.0.0/16");
  });

  it("points RADIUS at the configured server", () => {
    const lan = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { radiusHost: "192.168.1.183", managementSource: "192.168.1.183" });
    expect(lan).toContain("/radius add service=ppp,hotspot address=192.168.1.183");
    expect(lan).toContain('list="mashup-mgmt" address=192.168.1.183');
  });
});

describe("router setup script — one rejected command can't stop the rest", () => {
  const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
    managementSource: "192.168.1.183",
    portalHost: "http://192.168.1.183:3000",
    loginTemplateUrl: "http://192.168.1.183:4000/api/v1/hotspot/demo-isp/mikrotik-login-template",
    serverPublicKey: "SERVERPUBLICKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    blockTethering: true,
  });

  it("has no bare top-level command that could abort /import", () => {
    const bare = script.split("\n").filter((l) => l.startsWith("/"));
    expect(bare).toEqual([]);
  });

  it("never puts a wildcard host in the IP walled garden (RouterOS rejects it)", () => {
    const ipWalled = script.split("\n").filter((l) => l.includes("walled-garden ip add"));
    expect(ipWalled.length).toBeGreaterThan(0);
    for (const l of ipWalled) expect(l).not.toContain("*");
    expect(script).toContain('walled-garden add dst-host=*.safaricom.co.ke action=allow');
  });

  it("creates the management account before anything that can drop the operator's session", () => {
    const at = (needle: string) => script.indexOf(needle);
    const userAdd = at("/user add name=mashupkgrid-api");
    expect(userAdd).toBeGreaterThan(0);
    for (const disruptive of ["/interface bridge port", "/ip service set winbox", "/interface wireless set wlan1"]) {
      expect(userAdd).toBeLessThan(at(disruptive));
    }
    // Wi-Fi is renamed last of all.
    expect(at("/interface wireless set wlan1")).toBeGreaterThan(at("mkg-heartbeat"));
  });

  it("installs the light per-app filter on every router, after everything essential", () => {
    const at = (needle: string) => script.indexOf(needle);
    const filter = at('comment="MASHUPKGRID APP FILTER"');
    expect(filter).toBeGreaterThan(0);
    expect(script).not.toContain("total-memory"); // no memory threshold any more
    expect(at("/interface wireguard add name=mkg-wg")).toBeLessThan(filter);
    expect(at("mkg-heartbeat")).toBeLessThan(filter);
    // App-only customers can still reach the portal and API to buy full internet.
    expect(script).toContain('list="mashup-dest-portal" address=192.168.1.183');
  });

  it("still sets up the heartbeat and the VPN after the walled garden", () => {
    const at = (needle: string) => script.indexOf(needle);
    expect(at("mkg-heartbeat")).toBeGreaterThan(at("walled-garden"));
    expect(at("/interface wireguard add name=mkg-wg")).toBeGreaterThan(at("walled-garden"));
  });
});

describe("WinBox access script", () => {
  it("restricts WinBox to the platform, VPN and LAN instead of opening it", () => {
    const script = buildMikrotikWinboxScript("hAP test", { managementSource: "68.210.187.104", vpnSubnet: "10.90.0.0/16" });
    for (const rule of inputAcceptRules(script)) expect(rule).toContain('src-address-list="mashup-mgmt"');
    expect(script).not.toMatch(/dst-port=8291 action=accept/);
    expect(script).toContain("/ip service set winbox disabled=no port=8291 address=68.210.187.104,10.90.0.0/16,192.168.88.0/24");
  });

  it("ignores anything that isn't an IPv4 address or CIDR", () => {
    expect(managementSources({ managementSource: "evil;/system reset", vpnSubnet: "10.90.0.0/16" })).toEqual(["10.90.0.0/16", "192.168.88.0/24"]);
  });
});

describe("router setup script — RouterOS version chosen when adding the router", () => {
  const base = { serverPublicKey: "SERVERPUBLICKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=", loginTemplateUrl: "https://api.example.com/t" };

  it("v6: no WireGuard, v6 NTP syntax, and a warning if the router runs something else", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { ...base, routerOsMajor: 6 });
    expect(script).not.toContain("/interface wireguard");
    expect(script).toContain("server-dns-names=pool.ntp.org,time.google.com");
    expect(script).not.toContain("/system ntp client servers add");
    expect(script).toContain('# RouterOS version: made for v6');
    expect(script).toContain(':if ([:pick [/system resource get version] 0 1] != "6") do={');
    expect(script).not.toContain("/interface wifi set");
  });

  it("v7: WireGuard, v7 NTP servers, and both radio packages (a v7 hAP lite still has the older one)", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { ...base, routerOsMajor: 7 });
    expect(script).toContain("/interface wireguard add name=mkg-wg");
    expect(script).toContain("/system ntp client servers add address=pool.ntp.org");
    expect(script).not.toContain("server-dns-names");
    expect(script).toContain('!= "7") do={');
    expect(script).toContain("/interface wifi set [find default-name=wifi1]");
    expect(script).toContain("/interface wireless set wlan1");
  });

  it("hands every version- or package-only command to :parse, so a router without it still runs the rest", () => {
    // RouterOS checks the whole file before /import runs any of it: one bare "/interface wifi"
    // on a hAP lite rejected the entire script, check-in included.
    const onlySome = /\/interface (wifi|wireless|wireguard)\b|\/system ntp client/;
    for (const routerOsMajor of [6, 7, null]) {
      const script = buildRawScript(router, credentials, callbackUrl, { ...base, routerOsMajor });
      for (const line of script.split("\n").filter((l) => !l.startsWith("#") && onlySome.test(l))) {
        expect(line).toMatch(/^:do \{:local mkgCmd \[:parse "/);
      }
    }
  });

  it("hands every command to :parse, so no line can make RouterOS reject the whole file", () => {
    for (const routerOsMajor of [6, 7, null]) {
      const script = buildRawScript(router, credentials, callbackUrl, { ...base, routerOsMajor, blockTethering: true, pppoeInterface: "ether5" });
      const commands = script.split("\n").filter((l) => l.includes("/") && !l.startsWith("#") && !l.startsWith(":put"));
      expect(commands.length).toBeGreaterThan(100);
      for (const line of commands) {
        expect(line.startsWith(":do {:local mkgCmd [:parse \"") || line.startsWith(":if ([:pick [/system resource get version]")).toBe(true);
      }
      // The check-in still comes before anything that could drop the connection.
      expect(plainCommands(script).indexOf("/callback\" http-method=post keep-result=no")).toBeLessThan(plainCommands(script).indexOf("/user add"));
    }
  });

  it("not chosen: detects on the router and carries both variants", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, base);
    expect(script).toContain("# RouterOS version: detected on the router");
    expect(script).toContain("server-dns-names=");
    expect(script).toContain("/system ntp client servers add");
    expect(script).toContain("/interface wireguard add name=mkg-wg");
    expect(script).not.toContain("WARNING: MASHUPKGRID");
  });
});

describe("router setup script — the 'you're online' page", () => {
  it("downloads alogin.html next to login.html and repairs both", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { loginTemplateUrl: "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template" });
    expect(script).toContain('url="https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-alogin-template" dst-path=hotspot/alogin.html');
    expect(script).toMatch(/mkg-portal-page.*hotspot\/login\.html.*hotspot\/alogin\.html/);
  });
});

describe("router setup script — anti-tethering", () => {
  it("matches TTL in mangle prerouting, never in the forward chain where every phone looks tethered", () => {
    for (const blockTethering of [true, false]) {
      const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { blockTethering });
      expect(script).not.toMatch(/\/ip firewall filter add[^\n]*ttl=/);
      expect(script).toContain('/ip firewall filter remove [find comment="MASHUPKGRID ANTI-TETHER"]');
      expect(script).toContain('/ip firewall mangle add chain=prerouting src-address-list="mashup-anti-tether" ttl=equal:63 action=change-ttl new-ttl=set:1');
      expect(script.includes("chain=prerouting hotspot=auth ttl=equal:63")).toBe(blockTethering);
    }
  });
});

describe("deferred commands", () => {
  it("reads back as the exact command it wraps", () => {
    const command = '/system scheduler add name=x on-event=":do {/tool fetch url=\\"https://x\\" http-data=\\$k} on-error={}"';
    expect(plainCommands(deferred(command))).toBe(`:do {${command}} on-error={}`);
  });

  it("escapes quotes and variables so the text reaches :parse unchanged", () => {
    expect(deferred('/tool fetch url="https://x/y" http-data=$key\n:delay 2s')).toBe(
      ':do {:local mkgCmd [:parse "/tool fetch url=\\"https://x/y\\" http-data=\\$key; :delay 2s"]; $mkgCmd} on-error={}'
    );
  });
});

describe("router health report", () => {
  it("checks in each minute by running the platform's report script in memory, falling back to a plain check-in", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {});
    const line = script.split("\n").find((l) => l.includes("name=mkg-heartbeat interval=1m"))!;
    const reportUrl = callbackUrl.replace(/\/callback$/, "/heartbeat.rsc");
    expect(line).toContain(`/tool fetch url=\\"${reportUrl}\\" output=user as-value`);
    expect(line).toContain(':local f [:parse (\\$r->\\"data\\")]; \\$f}');
    expect(line).toContain(`on-error={:do {/tool fetch url=\\"${callbackUrl}\\" http-method=post keep-result=no} on-error={}}`);
    expect(line).not.toContain("dst-path"); // nothing written to flash every minute
  });

  it("reports CPU, memory, storage, uptime, version, board, users and sensors, and fits a v6 fetch", () => {
    const report = buildHeartbeatScript(callbackUrl);
    for (const field of ["cpu-load", "uptime", "free-memory", "total-memory", "free-hdd-space", "total-hdd-space", "version", "board-name"]) {
      expect(report).toContain(`[/system resource get ${field}]`);
    }
    expect(report).toContain("[:len [/ip hotspot active find]]");
    expect(report).toContain('[:parse ":return [:tostr [/system health print as-value]]"]');
    expect(report).toContain(`/tool fetch url="${callbackUrl}" http-method=post http-data=$d keep-result=no`);
    // RouterOS 6 returns at most 4 KB from fetch: its report leaves out the hotspot self-check.
    expect(buildHeartbeatScript(callbackUrl, "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template", { hotspotCheck: false }).length).toBeLessThan(4000);
  });

  it("repairs the hotspot without piling up rules or rewriting settings every minute", () => {
    const report = buildHeartbeatScript(callbackUrl, "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template");
    // DNS redirect: only when the count of its rules isn't exactly 2, and old ones removed first.
    expect(report).toContain('[:len [/ip firewall nat find comment="MASHUPKGRID DNS"]] != 2) do={/ip firewall nat remove [find comment="MASHUPKGRID DNS"]');
    expect(report).not.toMatch(/^:do \{\/ip firewall nat add/m);
    // Settings change only when wrong, never unconditionally.
    expect(report).not.toContain("/ip hotspot profile set [find]");
    expect(report).not.toMatch(/^:do \{\/ip dns set/m);
    // Radio menus a router may lack can't fail the whole report.
    for (const line of report.split("\n").filter((l) => /\/interface (wifi|wireless)\b/.test(l))) {
      expect(line).toMatch(/^:do \{:local mkgCmd \[:parse "/);
    }
    expect(buildHeartbeatScript(callbackUrl, undefined, { hotspotCheck: false }).length).toBeLessThan(4000);
  });

  it("checks its own hotspot and reports the counts, before posting", () => {
    const report = buildHeartbeatScript(callbackUrl);
    const check = report.indexOf('&hs=');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(report.indexOf("http-data=$d"));
    for (const probe of ["[/ip hotspot find disabled=no]", "[/ip hotspot host find]", "[/ping 8.8.8.8 count=2]", ":resolve google.com", 'comment="MASHUPKGRID DNS"']) {
      expect(report).toContain(probe);
    }
    expect(buildHeartbeatScript(callbackUrl, undefined, { hotspotCheck: false })).not.toContain("&hs=");
    // A broken sign-in page is removed before the repair that refetches a missing one.
    expect(report.indexOf("[/file get $f size] < 200")).toBeLessThan(report.indexOf("/ip hotspot reset-html"));
  });
});
