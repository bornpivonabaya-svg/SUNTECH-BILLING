import { describe, expect, it, vi } from "vitest";
import { MikroTikAdapter } from "../mikrotik/mikrotik.adapter.js";

type Row = Record<string, string>;

/** A router as the RouterOS API sees it: files, RADIUS servers, and a record of every write. */
/** The anti-tethering rules a correctly set-up router has (packages that ask for it only). */
const LIST_RULES: Row[] = ["63", "127", "254"].map((t, i) => ({ ".id": `*M${i}`, comment: "MASHUPKGRID ANTI-TETHER", "src-address-list": "mashup-anti-tether", ttl: `equal:${t}` }));

function fakeRouter(state: { files: string[]; radius: Row[]; walledIp?: Row[]; walledHttp?: Row[]; filters?: Row[]; mangles?: Row[] }) {
  const writes: string[][] = [];
  const client = {
    print: vi.fn(async (words: string[]) => {
      if (words[0] === "/file/print") return state.files.filter((f) => words[1] === `?name=${f}`).map((name) => ({ name }));
      if (words[0] === "/radius/print") return state.radius;
      if (words[0] === "/ip/hotspot/walled-garden/ip/print") return state.walledIp ?? [];
      if (words[0] === "/ip/hotspot/walled-garden/print") return state.walledHttp ?? [];
      if (words[0] === "/ip/firewall/filter/print") return state.filters ?? [];
      if (words[0] === "/ip/firewall/mangle/print") return state.mangles ?? LIST_RULES;
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
  radiusSecret: "router-secret",
  retiredRadiusHosts: ["68.210.187.104"],
};

describe("router hotspot self-repair", () => {
  it("does nothing on a correctly set-up router", async () => {
    const { adapter, writes } = fakeRouter({
      files: ["hotspot/login.html", "hotspot/alogin.html"],
      radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }],
    });
    expect(await adapter.ensureHotspotProvisioning(opts)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("downloads a missing login page and fixes RADIUS left pointing at the old server", async () => {
    const { adapter, writes } = fakeRouter({ files: [], radius: [{ ".id": "*1", address: "68.210.187.104" }] });
    const changes = await adapter.ensureHotspotProvisioning(opts);
    expect(changes).toEqual(["downloaded hotspot/login.html", "downloaded hotspot/alogin.html", "removed stale RADIUS 68.210.187.104", "added RADIUS 192.168.1.183"]);
    expect(writes[0]).toContain("=dst-path=hotspot/login.html");
    expect(writes[1]).toContain("=dst-path=hotspot/alogin.html");
    expect(writes[1]!.some((w) => w.includes("mikrotik-alogin-template"))).toBe(true);
    expect(writes[2]).toEqual(["/radius/remove", "=.id=*1"]);
    expect(writes[3]).toEqual(expect.arrayContaining(["/radius/add", "=address=192.168.1.183", "=secret=router-secret", "=comment=MASHUPKGRID"]));
  });

  it("lets customers reach the portal and API before login (walled garden)", async () => {
    const { adapter, writes } = fakeRouter({
      files: ["hotspot/login.html", "hotspot/alogin.html"],
      radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }],
      walledIp: [{ "dst-host": "captive.mashuphost.tech" }],
    });
    const changes = await adapter.ensureHotspotProvisioning({ ...opts, walledGardenHosts: ["192.168.1.183", "captive.mashuphost.tech"] });
    expect(changes).toEqual(["allowed 192.168.1.183 before login", "allowed captive.mashuphost.tech before login"]);
    expect(writes[0]).toEqual(expect.arrayContaining(["/ip/hotspot/walled-garden/ip/add", "=dst-address=192.168.1.183"]));
    expect(writes[1]).toEqual(expect.arrayContaining(["/ip/hotspot/walled-garden/add", "=dst-host=captive.mashuphost.tech"]));
    expect(writes).toHaveLength(2); // the IP walled-garden entry for the hostname already existed
  });

  it("limits walled-garden addresses to web pages, including entries made before that rule", async () => {
    const { adapter, writes } = fakeRouter({
      files: ["hotspot/login.html", "hotspot/alogin.html"],
      radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }],
      walledIp: [
        { ".id": "*W1", "dst-host": "captive.mashuphost.tech", comment: "MASHUPKGRID" },
        { ".id": "*W2", "dst-host": "api.mashuphost.tech", comment: "MASHUPKGRID", protocol: "tcp", "dst-port": "80,443" },
        { ".id": "*W3", "dst-host": "office.example", comment: "added by the ISP" },
      ],
      walledHttp: [{ "dst-host": "captive.mashuphost.tech" }, { "dst-host": "pay.pesapal.com" }],
    });
    const changes = await adapter.ensureHotspotProvisioning({ ...opts, walledGardenHosts: ["captive.mashuphost.tech", "pay.pesapal.com"] });
    const newEntry = writes.find((w) => w[0] === "/ip/hotspot/walled-garden/ip/add");
    expect(newEntry).toEqual(expect.arrayContaining(["=dst-host=pay.pesapal.com", "=protocol=tcp", "=dst-port=80,443"]));
    // Only the platform's own old entry is narrowed; the ISP's own entry is left alone.
    expect(writes).toContainEqual(["/ip/hotspot/walled-garden/ip/set", "=.id=*W1", "=protocol=tcp", "=dst-port=80,443"]);
    expect(writes.some((w) => w.includes("=.id=*W2") || w.includes("=.id=*W3"))).toBe(false);
    expect(changes).toContain("limited captive.mashuphost.tech to web pages before login");
  });

  it("leaves RADIUS servers the operator added themselves alone", async () => {
    const { adapter, writes } = fakeRouter({
      files: ["hotspot/login.html", "hotspot/alogin.html"],
      radius: [
        { ".id": "*1", address: "10.0.0.5", comment: "office NPS" },
        { ".id": "*2", address: "192.168.1.183", comment: "MASHUPKGRID" },
      ],
    });
    expect(await adapter.ensureHotspotProvisioning(opts)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("moves anti-tethering out of the forward chain, where it blocked every phone", async () => {
    const { adapter, writes } = fakeRouter({
      files: ["hotspot/login.html", "hotspot/alogin.html"],
      radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }],
      filters: [
        { ".id": "*A", comment: "MASHUPKGRID ANTI-TETHER", hotspot: "auth" },
        { ".id": "*B", comment: "MASHUPKGRID ANTI-TETHER" },
        { ".id": "*C", comment: "something the operator added" },
      ],
      mangles: [],
    });
    const changes = await adapter.ensureHotspotProvisioning(opts);
    expect(changes).toContain("moved anti-tethering to prerouting (all hotspot users); phones were being blocked");
    expect(writes).toContainEqual(["/ip/firewall/filter/remove", "=.id=*A"]);
    expect(writes).toContainEqual(["/ip/firewall/filter/remove", "=.id=*B"]);
    expect(writes).not.toContainEqual(["/ip/firewall/filter/remove", "=.id=*C"]);
    const mangles = writes.filter((w) => w[0] === "/ip/firewall/mangle/add");
    expect(mangles).toHaveLength(6);
    for (const m of mangles) expect(m).toEqual(expect.arrayContaining(["=chain=prerouting", "=action=change-ttl", "=new-ttl=set:1"]));
    expect(mangles.filter((m) => m.includes("=hotspot=auth"))).toHaveLength(3);
  });

  it("puts the rules back when someone removed them by hand", async () => {
    const { adapter, writes } = fakeRouter({ files: ["hotspot/login.html", "hotspot/alogin.html"], radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }], mangles: [] });
    const changes = await adapter.ensureHotspotProvisioning(opts);
    expect(changes).toEqual(["anti-tethering rules set for packages that ask for it"]);
    expect(writes.filter((w) => w[0] === "/ip/firewall/mangle/add")).toHaveLength(3);
  });

  it("follows the router's block-tethering switch, both ways", async () => {
    const on = fakeRouter({ files: ["hotspot/login.html", "hotspot/alogin.html"], radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }] });
    expect(await on.adapter.ensureHotspotProvisioning({ ...opts, blockTethering: true })).toEqual(["anti-tethering rules set for all hotspot users"]);
    const added = on.writes.filter((w) => w[0] === "/ip/firewall/mangle/add");
    expect(added).toHaveLength(6);
    expect(added.filter((w) => w.includes("=hotspot=auth"))).toHaveLength(3);

    const authRules: Row[] = ["63", "127", "254"].map((t, i) => ({ ".id": `*H${i}`, comment: "MASHUPKGRID ANTI-TETHER", hotspot: "auth", ttl: `equal:${t}` }));
    const off = fakeRouter({ files: ["hotspot/login.html", "hotspot/alogin.html"], radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }], mangles: [...authRules, ...LIST_RULES] });
    expect(await off.adapter.ensureHotspotProvisioning({ ...opts, blockTethering: false })).toEqual(["anti-tethering rules set for packages that ask for it"]);
    expect(off.writes.filter((w) => w[0] === "/ip/firewall/mangle/add")).toHaveLength(3);

    const steady = fakeRouter({ files: ["hotspot/login.html", "hotspot/alogin.html"], radius: [{ ".id": "*1", address: "192.168.1.183", comment: "MASHUPKGRID" }], mangles: [...authRules, ...LIST_RULES] });
    expect(await steady.adapter.ensureHotspotProvisioning({ ...opts, blockTethering: true })).toEqual([]);
  });
});
