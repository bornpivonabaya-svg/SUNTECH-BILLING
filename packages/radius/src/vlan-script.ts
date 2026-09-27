import { wrapTopLevelCommands } from "./setup-script.js";

/**
 * RouterOS script that puts one service on one VLAN: its own hotspot (DHCP, pool and hotspot
 * server on the VLAN interface) or its own PPPoE server. Each VLAN's service runs on its own, so
 * a hotspot VLAN comes up (and can be switched off) independently of the main hotspot and of any
 * PPPoE VLAN. It shares what the router's main setup script already configured: RADIUS, the
 * login page, the walled garden and internet NAT. Commands are identical on RouterOS 6 and 7.
 *
 * Re-running is safe: everything it made is removed first (in dependency order) and re-added.
 */

export type VlanService = "hotspot" | "pppoe";

export interface VlanScriptInput {
  service: VlanService;
  vlanTag: number;
  name: string;
  /** The router port the switch's trunk is patched into (tagged frames arrive here). */
  trunkInterface: string;
  /** The VLAN's subnet, e.g. 10.20.0.0/22. The gateway defaults to its first address. */
  subnetCidr: string;
  gateway?: string | null;
  dnsServers?: string[];
  mtu?: number | null;
}

const IFACE_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipToInt(ip: string): number | null {
  const m = IPV4.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

export interface VlanSubnet {
  network: string;
  prefix: number;
  gateway: string;
  /** The pool: every usable address after the gateway. */
  poolRange: string;
}

/** Works out the gateway and address pool of a VLAN subnet; throws with a message the ISP can act on. */
export function planVlanSubnet(subnetCidr: string, gateway?: string | null): VlanSubnet {
  const [addr, bits] = subnetCidr.trim().split("/");
  const prefix = Number(bits);
  const base = addr ? ipToInt(addr) : null;
  if (base === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 29) {
    throw new Error(`"${subnetCidr}" isn't a subnet this can use. Write it like 10.20.0.0/22 (between /16 and /29).`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const gw = gateway?.trim() ? ipToInt(gateway) : network + 1;
  if (gw === null || gw <= network || gw >= broadcast) {
    throw new Error(`The gateway ${gateway} must be an address inside ${intToIp(network)}/${prefix}.`);
  }
  // The pool is the larger side of the gateway, so a gateway at either end leaves one clean range.
  const [from, to] = gw - network - 1 >= broadcast - gw - 1 ? [network + 1, gw - 1] : [gw + 1, broadcast - 1];
  return { network: intToIp(network), prefix, gateway: intToIp(gw), poolRange: `${intToIp(from)}-${intToIp(to)}` };
}

export function vlanInterfaceName(service: VlanService, vlanTag: number): string {
  return `vlan${vlanTag}-${service === "hotspot" ? "hs" : "pppoe"}`;
}

export function buildVlanServiceScript(input: VlanScriptInput): string {
  if (!Number.isInteger(input.vlanTag) || input.vlanTag < 2 || input.vlanTag > 4094) {
    throw new Error("VLAN tags run from 2 to 4094 (1 is the untagged default on most switches).");
  }
  if (!IFACE_PATTERN.test(input.trunkInterface)) throw new Error(`"${input.trunkInterface}" isn't a router port name like ether5 or sfp1.`);
  const net = planVlanSubnet(input.subnetCidr, input.gateway);
  const tag = input.vlanTag;
  const iface = vlanInterfaceName(input.service, tag);
  const trunk = input.trunkInterface;
  const label = input.name.replace(/[^\w .-]/g, "").trim() || `VLAN ${tag}`;
  const comment = `MASHUPKGRID VLAN ${tag}`;
  const pool = `mkg-vlan${tag}-pool`;
  const dns = (input.dnsServers ?? []).filter((d) => ipToInt(d) !== null);
  const mtuSet = input.mtu ? ` mtu=${input.mtu}` : "";

  const header = `# MASHUPKGRID ISP — ${input.service === "hotspot" ? "hotspot" : "PPPoE"} on VLAN ${tag} ("${label}") over ${trunk}
# Run the router's main setup script first: RADIUS, the login page, the walled garden and
# internet NAT come from it, and this VLAN shares them. Safe to run again.

# 1. ${trunk} carries tagged VLANs from the switch trunk, so it must not be in the LAN bridge
#    (a bridged port hands the tagged frames to the bridge and the VLAN never sees them).
/interface bridge port remove [find interface=${trunk}]
/interface ethernet set [find default-name=${trunk}] disabled=no`;

  if (input.service === "hotspot") {
    const dnsLine = (dns.length ? dns : [net.gateway]).join(",");
    return wrapTopLevelCommands(`${header}

# 2. Clear what an earlier run made, newest first.
/ip hotspot remove [find name=mkg-hs-vlan${tag}]
/ip dhcp-server remove [find name=mkg-vlan${tag}-dhcp]
/ip dhcp-server network remove [find comment="${comment}"]
/ip address remove [find comment="${comment}"]
/ip pool remove [find name=${pool}]
/interface vlan remove [find name=${iface}]

# 3. The VLAN interface: tag ${tag} on ${trunk}.
/interface vlan add name=${iface} vlan-id=${tag} interface=${trunk}${mtuSet} comment="${comment}"

# 4. Its own addresses: gateway ${net.gateway}, customers get ${net.poolRange}.
/ip address add address=${net.gateway}/${net.prefix} interface=${iface} comment="${comment}"
/ip pool add name=${pool} ranges=${net.poolRange}
/ip dhcp-server add name=mkg-vlan${tag}-dhcp interface=${iface} address-pool=${pool} lease-time=1h disabled=no
/ip dhcp-server network add address=${net.network}/${net.prefix} gateway=${net.gateway} dns-server=${dnsLine} comment="${comment}"
/ip dns set allow-remote-requests=yes

# 5. Its own hotspot server. Same RADIUS, login page and walled garden as the main hotspot
#    (profile "default"), but it starts, stops and fails on its own.
/ip hotspot add name=mkg-hs-vlan${tag} interface=${iface} address-pool=${pool} profile=default idle-timeout=5m disabled=no

:put "Hotspot on VLAN ${tag} is up: plug an access point into a switch port untagged on VLAN ${tag}."
`);
  }

  const dnsLine = (dns.length ? dns : ["1.1.1.1", "8.8.8.8"]).join(",");
  const pppMtu = input.mtu ? Math.min(1480, input.mtu - 8) : 1480;
  return wrapTopLevelCommands(`${header}

# 2. Clear what an earlier run made, newest first.
/interface pppoe-server server remove [find service-name=mkg-pppoe-vlan${tag}]
/ppp profile remove [find name=mkg-vlan${tag}-pppoe]
/ip pool remove [find name=${pool}]
/interface vlan remove [find name=${iface}]

# 3. The VLAN interface: tag ${tag} on ${trunk}. PPPoE needs no IP address on it.
/interface vlan add name=${iface} vlan-id=${tag} interface=${trunk}${mtuSet} comment="${comment}"

# 4. Addresses handed to PPPoE customers: the router side is ${net.gateway}, customers get
#    ${net.poolRange} (a fixed IP set on a customer in the dashboard overrides the pool).
/ip pool add name=${pool} ranges=${net.poolRange}
/ppp profile add name=mkg-vlan${tag}-pppoe local-address=${net.gateway} remote-address=${pool} dns-server=${dnsLine} change-tcp-mss=yes only-one=yes use-encryption=no

# 5. Its own PPPoE server. Usernames, passwords and speeds come from RADIUS (the platform), so
#    a customer added in the dashboard can dial in straight away.
/interface pppoe-server server add service-name=mkg-pppoe-vlan${tag} interface=${iface} default-profile=mkg-vlan${tag}-pppoe authentication=pap,chap,mschap1,mschap2 one-session-per-host=yes max-mtu=${pppMtu} max-mru=${pppMtu} disabled=no
/ppp aaa set use-radius=yes accounting=yes interim-update=1m

:put "PPPoE on VLAN ${tag} is up: customer routers on VLAN ${tag} dial in with their PPPoE username and password."
`);
}
