import { describe, expect, it } from "vitest";
import { buildVlanServiceScript, planVlanSubnet } from "../vlan-script.js";

describe("VLAN subnet plan", () => {
  it("puts the gateway first and the rest in the pool", () => {
    expect(planVlanSubnet("10.20.0.0/22")).toEqual({ network: "10.20.0.0", prefix: 22, gateway: "10.20.0.1", poolRange: "10.20.0.2-10.20.3.254" });
  });
  it("normalises a host address to its network and honours a gateway at the top", () => {
    expect(planVlanSubnet("192.168.30.77/24", "192.168.30.254")).toEqual({ network: "192.168.30.0", prefix: 24, gateway: "192.168.30.254", poolRange: "192.168.30.1-192.168.30.253" });
  });
  it("refuses nonsense with a message the ISP can act on", () => {
    expect(() => planVlanSubnet("10.20.0.0")).toThrow(/10.20.0.0\/22/);
    expect(() => planVlanSubnet("10.20.0.0/8")).toThrow();
    expect(() => planVlanSubnet("10.20.0.0/24", "10.21.0.1")).toThrow(/inside/);
  });
});

describe("VLAN service script", () => {
  const base = { vlanTag: 20, name: "Estate A", trunkInterface: "ether5", subnetCidr: "10.20.0.0/22" };

  it("hotspot: its own VLAN interface, DHCP and hotspot server, trunk out of the bridge", () => {
    const s = buildVlanServiceScript({ ...base, service: "hotspot" });
    expect(s).toContain(":do {/interface bridge port remove [find interface=ether5]} on-error={}");
    expect(s).toContain("/interface vlan add name=vlan20-hs vlan-id=20 interface=ether5");
    expect(s).toContain("/ip address add address=10.20.0.1/22 interface=vlan20-hs");
    expect(s).toContain("/ip pool add name=mkg-vlan20-pool ranges=10.20.0.2-10.20.3.254");
    expect(s).toContain("/ip dhcp-server add name=mkg-vlan20-dhcp interface=vlan20-hs");
    expect(s).toContain("/ip hotspot add name=mkg-hs-vlan20 interface=vlan20-hs address-pool=mkg-vlan20-pool profile=default");
    expect(s).not.toContain("pppoe-server");
    // Clean-up runs before the adds, so a re-run doesn't leave a hotspot on a deleted interface.
    expect(s.indexOf("/ip hotspot remove")).toBeLessThan(s.indexOf("/interface vlan remove"));
    expect(s.indexOf("/interface vlan remove")).toBeLessThan(s.indexOf("/interface vlan add"));
  });

  it("pppoe: a PPPoE server on the VLAN, RADIUS on, no IP on the interface", () => {
    const s = buildVlanServiceScript({ ...base, vlanTag: 30, service: "pppoe", subnetCidr: "10.30.0.0/20", dnsServers: ["9.9.9.9"] });
    expect(s).toContain("/interface vlan add name=vlan30-pppoe vlan-id=30 interface=ether5");
    expect(s).toContain("/ppp profile add name=mkg-vlan30-pppoe local-address=10.30.0.1 remote-address=mkg-vlan30-pool dns-server=9.9.9.9");
    expect(s).toContain("/interface pppoe-server server add service-name=mkg-pppoe-vlan30 interface=vlan30-pppoe default-profile=mkg-vlan30-pppoe");
    expect(s).toContain("/ppp aaa set use-radius=yes");
    expect(s).not.toContain("/ip address add");
    expect(s).not.toContain("/ip hotspot add");
  });

  it("every command can fail on its own", () => {
    const s = buildVlanServiceScript({ ...base, service: "hotspot" });
    for (const line of s.split("\n")) expect(line.startsWith("/")).toBe(false);
  });

  it("rejects a bad tag or port name", () => {
    expect(() => buildVlanServiceScript({ ...base, service: "hotspot", vlanTag: 1 })).toThrow();
    expect(() => buildVlanServiceScript({ ...base, service: "hotspot", trunkInterface: "ether5; /system reset" })).toThrow();
  });
});
