import { describe, expect, it, vi } from "vitest";
import { APP_FILTER_RULE_COUNT, APP_FILTER_TAG, buildAppFilterSection } from "../app-filter.js";
import { MikroTikAdapter } from "../mikrotik/mikrotik.adapter.js";

describe("per-app package filter", () => {
  const script = buildAppFilterSection({ portalHosts: ["captive.mashuphost.tech"] });
  const lines = script.split("\n");

  it("checks only new connections, one jump per app", () => {
    const forward = lines.filter((l) => l.includes("chain=forward"));
    expect(forward.length).toBe(6);
    for (const l of forward) expect(l).toContain("connection-state=new");
    for (const l of forward) expect(l).toContain("action=jump");
  });

  it("learns app addresses from DNS with forwarding entries RouterOS accepts", () => {
    const dns = lines.filter((l) => l.includes("/ip dns static add"));
    expect(dns.length).toBeGreaterThan(20);
    for (const l of dns) expect(l).toMatch(/type=FWD forward-to=\S+ match-subdomain=yes address-list="mashup-dest-\w+"/);
    expect(script).toContain('name="tiktok.com" type=FWD');
  });

  it("ends each app chain with a drop, and keeps the portal reachable", () => {
    for (const app of ["tiktok", "youtube", "facebook", "instagram", "whatsapp", "social"]) {
      const chain = lines.filter((l) => l.includes(`chain=mkg-app-${app} `));
      expect(chain.at(-1)).toContain("action=drop");
      expect(chain.some((l) => l.includes('dst-address-list="mashup-dest-portal"'))).toBe(true);
    }
    expect(script).toContain('list="mashup-dest-portal" address=captive.mashuphost.tech');
  });

  it("never answers DNS from the internet side, and only redirects hotspot customers' DNS", () => {
    expect(script).toContain("chain=input in-interface=ether1 protocol=udp dst-port=53 action=drop");
    for (const l of lines.filter((l) => l.includes("action=redirect"))) expect(l).toContain("hotspot=auth");
  });

  it("replaces the old heavy filter and is safe to re-run", () => {
    expect(lines[1]).toContain('/ip firewall filter remove [find comment~"MASHUPKGRID SOCIAL"]');
    for (const l of lines.filter((l) => l.startsWith(":do {/ip") && l.includes(" add "))) expect(l).toContain(APP_FILTER_TAG);
    expect(lines.filter((l) => l.startsWith("/"))).toEqual([]); // every line wrapped: one rejection can't stop /import
  });

  it("knows how many rules a complete install has", () => {
    expect(APP_FILTER_RULE_COUNT).toBe(lines.filter((l) => l.includes("/ip firewall filter add")).length);
  });
});

describe("per-app filter self-repair", () => {
  function fakeRouter(installedRules: number) {
    const writes: string[][] = [];
    const client = {
      print: vi.fn(async (words: string[]) => {
        if (words[0] === "/ip/firewall/filter/print") return Array.from({ length: installedRules }, (_, i) => ({ ".id": `*${i}` }));
        if (words[0] === "/file/print") return [{ name: "hotspot/login.html" }];
        if (words[0] === "/radius/print") return [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }];
        if (words[0] === "/ip/firewall/mangle/print")
          return ["63", "127", "254"].map((t, i) => ({ ".id": `*M${i}`, comment: "MASHUPKGRID ANTI-TETHER", "src-address-list": "mashup-anti-tether", ttl: `equal:${t}` }));
        return [];
      }),
      talk: vi.fn(async (words: string[]) => {
        writes.push(words);
        return [{ type: "!done", attributes: {} }];
      }),
    };
    const adapter = new MikroTikAdapter({ host: "192.168.1.198", port: 8728, useTls: false, username: "u", password: "p" });
    (adapter as unknown as { client: unknown }).client = client;
    return { adapter, writes };
  }
  const opts = {
    loginTemplateUrl: "http://192.168.1.183:4000/api/v1/hotspot/demo-isp/mikrotik-login-template",
    radiusHost: "192.168.1.183",
    radiusSecret: "s",
    appFilter: { scriptUrl: "http://192.168.1.183:4000/api/v1/hotspot/demo-isp/mikrotik-app-filter.rsc", tag: APP_FILTER_TAG, expectedRules: APP_FILTER_RULE_COUNT },
  };

  it("installs the filter in the background when it is missing", async () => {
    const { adapter, writes } = fakeRouter(0);
    const changes = await adapter.ensureHotspotProvisioning(opts);
    expect(changes).toEqual([`installed the per-app package filter (had 0 of ${APP_FILTER_RULE_COUNT} rules)`]);
    // One background job on the router: download, then import. Nothing waits on the API.
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toBe("/execute");
    expect(writes[0]![1]).toContain(`/tool fetch url="${opts.appFilter.scriptUrl}" dst-path=mkg-app-filter.rsc`);
    expect(writes[0]![1]).toContain("/import mkg-app-filter.rsc");
  });

  it("leaves a complete install alone", async () => {
    const { adapter, writes } = fakeRouter(APP_FILTER_RULE_COUNT);
    expect(await adapter.ensureHotspotProvisioning(opts)).toEqual([]);
    expect(writes).toEqual([]);
  });
});
