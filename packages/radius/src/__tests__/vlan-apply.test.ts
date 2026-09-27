import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  vlan: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  adapter: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listInterfaces: vi.fn(),
    runScript: vi.fn(),
  },
}));
vi.mock("@mashupkgrid/database", () => ({ prisma: { vlan: h.vlan } }));
vi.mock("@mashupkgrid/network", () => ({ createAdapterForRouter: () => h.adapter }));

import { applyVlanToRouter, chooseTrunkInterface, vlanServiceFor } from "../vlan-apply.service.js";

const router = { id: "r1", host: "10.8.0.2", deletedAt: null, hotspotPorts: ["ether2", "ether3"], lanPort: "ether4", pppoeInterface: null };
const ports = ["ether1", "ether2", "ether3", "ether4", "ether5", "wlan1", "bridge"].map((name) => ({ name, type: name.startsWith("ether") ? "ether" : name === "bridge" ? "bridge" : "wlan", running: true }));
const vlan = (over: Record<string, unknown> = {}) => ({ id: "v1", tenantId: "t1", vlanTag: 20, name: "Estate", type: "HOTSPOT", subnetCidr: "10.20.0.0/22", gateway: null, dnsServers: [], mtu: null, isEnabled: true, trunkInterface: null, router, ...over });

describe("choosing the trunk port", () => {
  it("takes a free ethernet port, never WAN, hotspot or LAN", () => {
    expect(chooseTrunkInterface(ports, router)).toBe("ether5");
    expect(chooseTrunkInterface(ports.filter((p) => p.name !== "ether5"), router)).toBeNull();
  });
  it("prefers SFP and reuses the trunk other VLANs already use", () => {
    expect(chooseTrunkInterface([...ports, { name: "sfp1", type: "ether", running: false }], router)).toBe("sfp1");
    expect(chooseTrunkInterface([...ports, { name: "sfp1", type: "ether", running: false }], router, ["ether5"])).toBe("ether5");
  });
  it("maps VLAN types to services", () => {
    expect(vlanServiceFor("HOTSPOT")).toBe("hotspot");
    expect(vlanServiceFor("GUEST")).toBe("hotspot");
    expect(vlanServiceFor("CUSTOMER_INTERNET")).toBe("pppoe");
    expect(vlanServiceFor("MANAGEMENT")).toBeNull();
  });
});

describe("applying a VLAN to its router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.adapter.connect.mockResolvedValue(undefined);
    h.adapter.listInterfaces.mockResolvedValue(ports);
    h.vlan.findMany.mockResolvedValue([]);
  });

  it("runs the script on a detected trunk and marks it active when the router confirms", async () => {
    h.vlan.findFirst.mockResolvedValue(vlan());
    h.adapter.runScript.mockResolvedValueOnce("").mockResolvedValueOnce("1,1");
    const r = await applyVlanToRouter("t1", "v1");
    expect(r).toMatchObject({ status: "ACTIVE", trunkInterface: "ether5" });
    expect(h.adapter.runScript.mock.calls[0]![0]).toContain("/ip hotspot add name=mkg-hs-vlan20 interface=vlan20-hs");
    expect(h.vlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provisioningStatus: "ACTIVE", trunkInterface: "ether5", lastProvisioningError: null }) }));
  });

  it("fails with a clear reason when the hotspot server didn't start", async () => {
    h.vlan.findFirst.mockResolvedValue(vlan());
    h.adapter.runScript.mockResolvedValueOnce("").mockResolvedValueOnce("1,0");
    const r = await applyVlanToRouter("t1", "v1");
    expect(r.status).toBe("FAILED");
    expect(r.message).toMatch(/main setup script/);
  });

  it("leaves it pending when the router is offline", async () => {
    h.vlan.findFirst.mockResolvedValue(vlan({ type: "CUSTOMER_INTERNET" }));
    h.adapter.connect.mockRejectedValue(new Error("timeout"));
    const r = await applyVlanToRouter("t1", "v1");
    expect(r.status).toBe("PENDING");
    expect(h.adapter.runScript).not.toHaveBeenCalled();
  });

  it("uses the trunk the ISP chose and sets PPPoE up", async () => {
    h.vlan.findFirst.mockResolvedValue(vlan({ type: "CUSTOMER_INTERNET", vlanTag: 30, subnetCidr: "10.30.0.0/20" }));
    h.adapter.runScript.mockResolvedValueOnce("").mockResolvedValueOnce("1,1");
    const r = await applyVlanToRouter("t1", "v1", { trunkInterface: "sfp1" });
    expect(r).toMatchObject({ status: "ACTIVE", trunkInterface: "sfp1" });
    expect(h.adapter.runScript.mock.calls[0]![0]).toContain("interface pppoe-server server add service-name=mkg-pppoe-vlan30 interface=vlan30-pppoe");
    expect(h.adapter.listInterfaces).not.toHaveBeenCalled();
  });

  it("refuses a VLAN with no subnet", async () => {
    h.vlan.findFirst.mockResolvedValue(vlan({ subnetCidr: null }));
    expect((await applyVlanToRouter("t1", "v1")).status).toBe("FAILED");
  });
});
