import { describe, expect, it } from "vitest";
import type { Router } from "@mashupkgrid/database";
import {
  buildMikrotikProvisioningScript as buildRawScript,
  buildMikrotikWinboxScript,
  buildHeartbeatScript,
  ALOGIN_PAGE_MARKER,
  UNPAID_DNS_RULES,
  walledGardenSync,
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
    cardGateways: ["PAYSTACK"],
  });

  it("has no bare top-level command that could abort /import", () => {
    const bare = script.split("\n").filter((l) => l.startsWith("/"));
    expect(bare).toEqual([]);
  });

  it("never puts a wildcard host in the IP walled garden (RouterOS rejects it)", () => {
    const ipWalled = script.split("\n").filter((l) => l.includes("walled-garden ip add"));
    expect(ipWalled.length).toBeGreaterThan(0);
    for (const l of ipWalled) expect(l).not.toContain("*");
    expect(script).toContain("walled-garden add dst-host=*.paystack.com action=allow");
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

  it("leaves the per-app filter out for an ISP that sells no per-app packages", () => {
    const light = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { appFilter: false });
    expect(light).not.toContain('comment="MASHUPKGRID APP FILTER"');
    expect(light).toContain("# Not installed: this ISP sells no per-app packages.");
    expect(light).toContain("mkg-heartbeat");
  });

  it("installs the light per-app filter by default, after everything essential", () => {
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

  it("shares the internet with every customer (hotspot, PPPoE, VLAN) whichever port it comes in on", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { ...base, pppoeInterface: "ether5" });
    expect(script).toContain("/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade");
    for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) {
      expect(script).toContain(`/ip firewall address-list add list=mkg-private address=${range}`);
    }
    // Private to public only: traffic between the router's own networks is never touched.
    expect(script).toContain(
      '/ip firewall nat add chain=srcnat src-address-list=mkg-private dst-address-list=!mkg-private action=masquerade comment="MASHUPKGRID LAN NAT"'
    );
    // The PPPoE pool (10.10.x.x) is inside the private ranges, so its customers are covered.
    expect(script).toContain("ranges=10.10.0.2-10.10.255.254");
    // Replaced, not piled up, when the script runs again.
    expect(script.indexOf('remove [find comment="MASHUPKGRID LAN NAT"]')).toBeLessThan(script.indexOf("dst-address-list=!mkg-private"));
  });

  it("lets unpaid devices open only web pages on walled-garden addresses, and stops DNS tunnels", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, base);
    const ipEntries = script.split("\n").filter((l) => l.includes("/ip hotspot walled-garden ip add"));
    expect(ipEntries.length).toBeGreaterThan(0);
    for (const line of ipEntries) expect(line).toContain("protocol=tcp dst-port=80,443");
    // Unpaid devices only (hotspot=!auth), in the chain the hotspot keeps for such rules.
    expect(script).toContain("chain=pre-hs-input hotspot=!auth protocol=udp dst-port=53,64872 packet-size=220-65535 action=drop");
    expect(script).toContain("dst-limit=20,100,src-address/1m action=accept");
    expect(script.indexOf('remove [find comment="MASHUPKGRID UNPAID DNS"]')).toBeLessThan(script.indexOf("chain=pre-hs-input"));
    // The limited accept comes before the catch-all drop.
    expect(script.indexOf("dst-limit=20,100")).toBeLessThan(script.indexOf("dst-port=53,64872 action=drop"));
  });

  it("allows unpaid devices only the exact portal and API names, and card hosts only for card ISPs", () => {
    const mpesaOnly = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
      loginTemplateUrl: "https://api.mashuphost.tech/api/v1/hotspot/demo-isp/mikrotik-login-template",
      portalHost: "https://captive.mashuphost.tech",
    });
    const garden = mpesaOnly.split("\n").filter((l) => l.includes("walled-garden") && l.includes(" add "));
    const hosts = garden.map((l) => /dst-(?:host|address)=(\S+)/.exec(l)?.[1]);
    expect(hosts).toContain("captive.mashuphost.tech");
    expect(hosts).toContain("api.mashuphost.tech");
    // mashuphost.tech itself is behind Cloudflare, and a wildcard is matched on the name a device
    // claims to visit: both let tunnel apps through without paying.
    expect(hosts.some((h) => h?.includes("*"))).toBe(false);
    expect(hosts).not.toContain("mashuphost.tech");
    expect(mpesaOnly).not.toContain("safaricom");
    expect(mpesaOnly).not.toContain("paystack");

    const cards = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { cardGateways: ["PESAPAL"] });
    expect(cards).toContain("walled-garden add dst-host=*.pesapal.com action=allow");
    expect(cards).toContain("walled-garden add dst-host=*.visa.com action=allow");
    expect(cards).not.toContain("paystack");
  });

  it("serves PPPoE on several ports through one PPPoE bridge, never the hotspot's", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
      ...base,
      hotspotPorts: ["ether2", "ether3", "wlan1"],
      pppoeInterface: "ether4, ether5",
    });
    // Out of the hotspot bridge first, then into their own.
    expect(script).toContain("/interface bridge port remove [find interface=ether4]");
    expect(script).toContain("/interface bridge port remove [find interface=ether5]");
    expect(script).not.toContain("/interface bridge port add bridge=bridge interface=ether4");
    expect(script).toContain("/interface bridge add name=bridge-pppoe");
    expect(script).toContain("/interface bridge port add bridge=bridge-pppoe interface=ether4");
    expect(script).toContain("/interface bridge port add bridge=bridge-pppoe interface=ether5");
    expect(script).toContain("/interface pppoe-server server add service-name=mkg-pppoe interface=bridge-pppoe");
    expect(script.indexOf("remove [find interface=ether5]")).toBeLessThan(script.indexOf("bridge=bridge-pppoe interface=ether5"));
    // The hotspot keeps its own ports.
    expect(script).toContain("/interface bridge port add bridge=bridge interface=ether2");
  });

  it("serves PPPoE on a single port directly, and a PPPoE-only router keeps just the Wi-Fi on the hotspot", () => {
    const one = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { ...base, pppoeInterface: "ether5" });
    expect(one).toContain("/interface pppoe-server server add service-name=mkg-pppoe interface=ether5");
    expect(one).not.toContain("bridge-pppoe");
    const all = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
      ...base,
      hotspotPorts: ["wlan1"],
      pppoeInterface: "ether2,ether3,ether4,ether5",
    });
    for (const p of ["ether2", "ether3", "ether4", "ether5"]) {
      expect(all).not.toContain(`/interface bridge port add bridge=bridge interface=${p}`);
      expect(all).toContain(`/interface bridge port add bridge=bridge-pppoe interface=${p}`);
    }
    expect(all).toContain("/interface bridge port add bridge=bridge interface=wlan1");
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
    // The report repairs both (portalRepair); the separate scheduler is removed, for small routers.
    expect(script).toContain(":do {/system scheduler remove [find name=mkg-portal-page]} on-error={}");
    expect(script).not.toContain("scheduler add name=mkg-portal-page");
    // A re-run never swaps the ISP's page for MikroTik's stock one.
    expect(plainCommands(script)).toContain(':do {:if ([:len [/file find name="hotspot/login.html"]] = 0) do={/ip hotspot reset-html}} on-error={}');
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
    expect(line).toContain(`on-error={:set mkgHbFetch \\"\\"; :do {/tool fetch url=\\"${callbackUrl}\\" http-method=post keep-result=no} on-error={}}`);
    // Skipped while the previous download is still going (for up to 5 minutes), so stuck
    // downloads can't pile up every minute on a small router.
    expect(line).toContain(':global mkgHbFetch; :local up [/system resource get uptime]; :local run true; :if ([:typeof \\$mkgHbFetch] = \\"time\\") do={:if (\\$up > \\$mkgHbFetch) do={:if ((\\$up - \\$mkgHbFetch) < 00:05:00) do={:set run false}}}; :if (\\$run) do={:set mkgHbFetch \\$up; ');
    expect(line).not.toContain("dst-path"); // nothing written to flash every minute
  });

  it("sets a small router's check-in to every 5 minutes, only when it differs", () => {
    const small = buildHeartbeatScript(callbackUrl, undefined, { checkInEvery: "5m" });
    expect(small).toContain(':do {/system scheduler set [find where name="mkg-heartbeat" and interval!=5m] interval=5m} on-error={}');
    expect(buildHeartbeatScript(callbackUrl, undefined, { checkInEvery: "1m" })).toContain("interval!=1m] interval=1m");
    // Size not known yet: the schedule is left as it is.
    expect(buildHeartbeatScript(callbackUrl)).not.toContain("/system scheduler set");
    // RouterOS 6 small routers (hAP lite on v6) get it too, and stay under 4 KB.
    const v6 = buildHeartbeatScript(`https://api.mashuphost.tech/api/v1/routers/provision/${"a".repeat(64)}/callback`, "https://api.mashuphost.tech/api/v1/hotspot/a-rather-long-isp-name/mikrotik-login-template", { hotspotCheck: false, checkInEvery: "5m" });
    expect(v6).toContain("interval=5m");
    expect(v6.length).toBeLessThan(3950);
  });

  it("puts back a missing management VPN piece by piece, and reports the router's key (RouterOS 7)", () => {
    const vpn = { serverPublicKey: "SERVERKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", endpointHost: "68.210.187.104", endpointPort: 51820, subnet: "10.90.0.0/16", vpnIp: "10.90.0.35" };
    const report = buildHeartbeatScript(callbackUrl, undefined, { vpn });
    const repair = plainCommands(report);
    expect(repair).toContain(":if ([:len [/interface wireguard find name=mkg-wg]] = 0) do={/interface wireguard add name=mkg-wg listen-port=51820}");
    expect(repair).toContain('/ip address add address=10.90.0.35/32 interface=mkg-wg');
    // The peer: added when this server's key isn't there (the "no peer" case), replacing a wrong one.
    expect(repair).toContain(
      ':if ([:len [/interface wireguard peers find interface=mkg-wg public-key="SERVERKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]] = 0) do={/interface wireguard peers remove [find interface=mkg-wg]; /interface wireguard peers add interface=mkg-wg public-key="SERVERKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" endpoint-address=68.210.187.104 endpoint-port=51820 allowed-address=10.90.0.0/16 persistent-keepalive=25s}'
    );
    // Through :parse, so a router without WireGuard skips only this.
    expect(report).toContain(':do {:local mkgCmd [:parse ":if ([:len [/interface wireguard find name=mkg-wg]]');
    expect(report).toContain('"&wgkey="');
    // RouterOS 6 and a router with no VPN address: nothing.
    expect(buildHeartbeatScript(callbackUrl, undefined, { vpn, hotspotCheck: false })).not.toContain("wireguard peers add");
    expect(buildHeartbeatScript(callbackUrl)).not.toContain("wireguard peers add");
  });

  it("keeps building the VPN when sending the router's key fails", () => {
    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, { routerOsMajor: 7, serverPublicKey: "SERVERKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
    expect(script).toContain(":do {/tool fetch url=");
    expect(script).toMatch(/http-data=\$routerPublicKey keep-result=no\} on-error=\{\}/);
  });

  it("runs one report at a time, on RouterOS 6 and 7", () => {
    for (const report of [buildHeartbeatScript(callbackUrl), buildHeartbeatScript(callbackUrl, undefined, { hotspotCheck: false })]) {
      const lines = report.trimEnd().split("\n");
      expect(lines[1]).toBe(
        ':global mkgHbBusy; :local mkgUp [/system resource get uptime]; :local mkgRun true; :if ([:typeof $mkgHbBusy] = "time") do={:if ($mkgUp > $mkgHbBusy) do={:if (($mkgUp - $mkgHbBusy) < 00:05:00) do={:set mkgRun false}}}; :if ($mkgRun) do={:set mkgHbBusy $mkgUp'
      );
      // The check-in itself can't leave the lock set by failing: its error is caught, then the lock clears.
      expect(lines.at(-3)).toMatch(/^:do \{\/tool fetch url=".*" http-method=post http-data=\$d keep-result=no\} on-error=\{\}$/);
      expect(lines.at(-2)).toBe(':set mkgHbBusy ""}');
      expect(lines.at(-1)).toBe("}");
    }
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
  });

  it("repairs the sign-in page in the folder the hotspot really serves from", () => {
    const login = "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template";
    const report = buildHeartbeatScript(callbackUrl, login);
    // Reads each profile's own html-directory; without known sizes, missing or under 200 bytes is broken.
    expect(report).toContain(":local dir [/ip hotspot profile get $p html-directory]");
    expect(report).toContain(':local f [/file find name=($dir . "/login.html")]');
    expect(report).toContain("[:tonum [/file get ($f->0) size]] >= 200");
    // Never reads the file's contents (unreliable on RouterOS 7, slow on a hAP lite).
    expect(report).not.toContain("contents");
    // Downloads over the page in the same folder, never restoring MikroTik's stock page first:
    // reset-html only when the folder itself is missing.
    expect(report).toContain(':if ([:len [/file find name=$dir]] = 0) do={:foreach h in=[/ip hotspot find profile=[/ip hotspot profile get $p name]] do={:do {:local r [:parse ("/ip hotspot reset-html " . $h)]; $r} on-error={}}}');
    expect(report).toContain(`/tool fetch url="${login}" dst-path=($dir . "/login.html")`);
    expect(report).toContain('dst-path=($dir . "/alogin.html")');
    expect(report).not.toContain('dst-path=flash/hotspot/login.html');
  });

  it("spots a stock or outdated page by the exact size the platform serves", () => {
    const login = "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template";
    const report = buildHeartbeatScript(callbackUrl, login, { pageSizes: { login: 1234, alogin: 5678 } });
    expect(report).toContain(":if ([:len $f] > 0) do={:if ([:tonum [/file get ($f->0) size]] = 1234) do={:set ok true}}");
    expect(report).toContain(":if ([:len $a] > 0) do={:if ([:tonum [/file get ($a->0) size]] = 5678) do={:set aok true}}");
    expect(report).not.toContain(">= 200");
  });

  it("shares the internet with every customer whichever port it arrives on, on routers set up earlier too", () => {
    for (const report of [buildHeartbeatScript(callbackUrl)]) {
      // Fills the private-ranges list and replaces the first, hotspot-only rule; a healthy router
      // (3 list entries, 1 current rule) writes nothing.
      expect(report).toContain(':if ([:len [/ip firewall address-list find list=mkg-private]] != 3) do={');
      expect(report).toContain(
        ':if ([:len [/ip firewall nat find comment="MASHUPKGRID LAN NAT" src-address-list=mkg-private]] != 1) do={/ip firewall nat remove [find comment="MASHUPKGRID LAN NAT"]; /ip firewall nat add chain=srcnat src-address-list=mkg-private dst-address-list=!mkg-private action=masquerade comment="MASHUPKGRID LAN NAT"}'
      );
    }
  });

  it("brings routers set up earlier to the same unpaid-device limits", () => {
    const report = buildHeartbeatScript(callbackUrl);
    expect(report).toContain(
      ':if ([:len [/ip hotspot walled-garden ip get $w dst-port]] = 0) do={/ip hotspot walled-garden ip set $w protocol=tcp dst-port=80,443}'
    );
    expect(report).toContain(`[:len [/ip firewall filter find comment="MASHUPKGRID UNPAID DNS"]] != ${UNPAID_DNS_RULES.length}`);
    // RouterOS 6 gets them from its setup script: its report must stay under 4 KB.
    expect(buildHeartbeatScript(callbackUrl, undefined, { hotspotCheck: false })).not.toContain("UNPAID DNS");
  });

  it("keeps a router's walled garden to exactly this ISP's list", () => {
    const report = buildHeartbeatScript(callbackUrl, undefined, { walledGarden: ["68.210.187.104", "captive.mashuphost.tech", "*.pesapal.com"] });
    const sync = walledGardenSync(["68.210.187.104", "captive.mashuphost.tech", "*.pesapal.com"]);
    expect(report).toContain(sync);
    // IP addresses stay as dst-address entries, untouched.
    expect(sync).toContain(':local ok {"captive.mashuphost.tech";"*.pesapal.com"}');
    // Removes only the platform's own entries that are no longer on the list, in both menus.
    expect(sync).toContain(':foreach e in=[/ip hotspot walled-garden find comment="MASHUPKGRID"] do={:local h [/ip hotspot walled-garden get $e dst-host]; :if ([:len $h] > 0 && [:typeof [:find $ok $h]] = "nil") do={/ip hotspot walled-garden remove $e}}');
    expect(sync).toContain("[/ip hotspot walled-garden ip find comment=\"MASHUPKGRID\"]");
    // Adds what is missing; the IP menu gets names only, never a wildcard, web pages only.
    expect(sync).toContain('/ip hotspot walled-garden ip add dst-host=$h protocol=tcp dst-port=80,443 action=accept comment="MASHUPKGRID"');
    expect(sync).toContain(':if ([:typeof [:find $h "*"]] = "nil"');
    // Nothing to sync: nothing emitted (never an empty list that would remove everything).
    expect(walledGardenSync([])).toBe("");
    expect(buildHeartbeatScript(callbackUrl)).not.toContain(":local ok {");
    expect(buildHeartbeatScript(callbackUrl, undefined, { hotspotCheck: false, walledGarden: ["captive.mashuphost.tech"] })).not.toContain(":local ok {");
  });

  it("keeps the RouterOS 6 report under the 4 KB its fetch returns", () => {
    const long = `https://api.mashuphost.tech/api/v1/routers/provision/${"a".repeat(64)}/callback`;
    const login = "https://api.mashuphost.tech/api/v1/hotspot/a-rather-long-isp-name/mikrotik-login-template";
    const v6 = buildHeartbeatScript(long, login, { hotspotCheck: false });
    expect(v6.length).toBeLessThan(3900);
    expect(v6).not.toContain(ALOGIN_PAGE_MARKER);
    // v6 gets the NAT rule from its setup script.
    expect(v6).not.toContain("MASHUPKGRID LAN NAT");
  });

  it("downloads the newest 'you're online' page onto routers that have an older one", () => {
    const login = "https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-login-template";
    const report = buildHeartbeatScript(callbackUrl, login);
    expect(report).toContain(':local a [/file find name=($dir . "/alogin.html")]');
    expect(report).toContain("[:tonum [/file get ($a->0) size]] >= 200");
    expect(report).toContain(
      ':if ($aok = false) do={:do {/tool fetch url="https://api.example.com/api/v1/hotspot/demo-isp/mikrotik-alogin-template" dst-path=($dir . "/alogin.html")'
    );
  });
});
