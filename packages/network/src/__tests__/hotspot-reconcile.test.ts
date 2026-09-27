import { describe, expect, it, vi } from "vitest";
import { MikroTikAdapter } from "../mikrotik/mikrotik.adapter.js";

type Row = Record<string, string>;

/** A router as the RouterOS API sees it: files, RADIUS servers, and a record of every write. */
function fakeRouter(state: { files: string[]; radius: Row[]; walledIp?: Row[]; walledHttp?: Row[] }) {
  const writes: string[][] = [];
  const client = {
    print: vi.fn(async (words: string[]) => {
      if (words[0] === "/file/print") return state.files.filter((f) => words[1] === `?name=${f}`).map((name) => ({ name }));
      if (words[0] === "/radius/print") return state.radius;
      if (words[0] === "/ip/hotspot/walled-garden/ip/print") return state.walledIp ?? [];
      if (words[0] === "/ip/hotspot/walled-garden/print") return state.walledHttp ?? [];
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
});
