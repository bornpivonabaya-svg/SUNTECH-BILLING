import { prisma, type Router, type VlanType } from "@mashupkgrid/database";
import { createAdapterForRouter, type NetworkDeviceAdapter } from "@mashupkgrid/network";
import type { AutomationSummary } from "@mashupkgrid/shared";
import { buildVlanServiceScript, vlanInterfaceName, type VlanService } from "./vlan-script.js";

/**
 * Sets a VLAN's service up on its router with no pasting: the platform connects over the API,
 * runs the same script the VLAN manual shows, and checks the router now has the VLAN interface
 * and its hotspot or PPPoE server. A router that can't be reached leaves the VLAN PENDING, and
 * the worker's retryPendingVlans pass finishes the job once the router is back.
 */

export function vlanServiceFor(type: VlanType): VlanService | null {
  if (type === "HOTSPOT" || type === "GUEST") return "hotspot";
  if (type === "CUSTOMER_INTERNET" || type === "BUSINESS_INTERNET") return "pppoe";
  return null;
}

export interface VlanApplyResult {
  status: "ACTIVE" | "PENDING" | "FAILED";
  message: string;
  trunkInterface: string | null;
}

/** The port the switch trunk is most likely in: the highest-numbered ethernet or SFP port that
 *  isn't the WAN (ether1), a hotspot port, the direct LAN port or the plain PPPoE port. The same
 *  port serves every VLAN on this router, so one already in use as a trunk wins. */
export function chooseTrunkInterface(
  interfaces: Array<{ name: string; type: string }>,
  router: Pick<Router, "hotspotPorts" | "lanPort" | "pppoeInterface">,
  inUse: string[] = []
): string | null {
  const physical = interfaces.filter((i) => /^(ether|sfp|combo)/.test(i.name) && (i.type === "ether" || i.type === ""));
  const existing = inUse.find((name) => physical.some((i) => i.name === name));
  if (existing) return existing;
  const taken = new Set(["ether1", ...(router.hotspotPorts.length ? router.hotspotPorts : ["ether2", "ether3", "ether4"]), router.lanPort, router.pppoeInterface].filter(Boolean) as string[]);
  const free = physical.map((i) => i.name).filter((n) => !taken.has(n));
  const rank = (n: string) => (n.startsWith("sfp") ? 1000 : 0) + Number(n.replace(/\D+/g, "") || 0);
  free.sort((a, b) => rank(b) - rank(a));
  return free[0] ?? null;
}

async function record(vlanId: string, result: VlanApplyResult): Promise<VlanApplyResult> {
  await prisma.vlan.update({
    where: { id: vlanId },
    data: {
      provisioningStatus: result.status,
      lastProvisioningError: result.status === "ACTIVE" ? null : result.message,
      ...(result.status === "ACTIVE" ? { lastProvisionedAt: new Date() } : {}),
      ...(result.trunkInterface ? { trunkInterface: result.trunkInterface } : {}),
    },
  });
  return result;
}

export async function applyVlanToRouter(tenantId: string, vlanId: string, opts: { trunkInterface?: string | null } = {}): Promise<VlanApplyResult> {
  const vlan = await prisma.vlan.findFirst({ where: { id: vlanId, tenantId, deletedAt: null }, include: { router: true } });
  if (!vlan) throw new Error("VLAN not found");
  const service = vlanServiceFor(vlan.type);
  const trunkWanted = opts.trunkInterface?.trim() || vlan.trunkInterface;
  const fail = (message: string) => record(vlan.id, { status: "FAILED", message, trunkInterface: trunkWanted ?? null });

  if (!service) return fail("Only hotspot, guest and internet (PPPoE) VLANs have a service to set up on the router.");
  if (!vlan.router || vlan.router.deletedAt) return fail("Choose the router this VLAN runs on, then set it up again.");
  if (!vlan.subnetCidr) return fail("Give the VLAN a subnet (like 10.20.0.0/22) so its customers get addresses.");
  if (!vlan.isEnabled) return fail("This VLAN is switched off. Switch it on first.");
  const router = vlan.router;
  if (!router.host) {
    return record(vlan.id, { status: "PENDING", message: "Waiting for the router to finish its setup script; this VLAN is set up automatically once it checks in.", trunkInterface: trunkWanted ?? null });
  }

  let adapter: NetworkDeviceAdapter | null = null;
  try {
    adapter = createAdapterForRouter({ ...router, host: router.host });
    await adapter.connect();
  } catch {
    return record(vlan.id, { status: "PENDING", message: "The router can't be reached right now; this VLAN is set up automatically when it's back online.", trunkInterface: trunkWanted ?? null });
  }

  try {
    if (!adapter.runScript) return await fail("This router type can't run setup scripts over the API.");
    let trunk = trunkWanted ?? null;
    if (!trunk) {
      const [interfaces, siblings] = await Promise.all([
        adapter.listInterfaces?.() ?? Promise.resolve([]),
        prisma.vlan.findMany({ where: { routerId: router.id, deletedAt: null, trunkInterface: { not: null } }, select: { trunkInterface: true } }),
      ]);
      trunk = chooseTrunkInterface(interfaces, router, siblings.map((s) => s.trunkInterface!));
      if (!trunk) return await fail("No free port for the switch trunk: every port is WAN, hotspot or LAN. Pick the trunk port on the VLAN and try again.");
    }

    let script: string;
    try {
      script = buildVlanServiceScript({ service, vlanTag: vlan.vlanTag, name: vlan.name, trunkInterface: trunk, subnetCidr: vlan.subnetCidr, gateway: vlan.gateway, dnsServers: vlan.dnsServers, mtu: vlan.mtu });
    } catch (err) {
      return await fail(err instanceof Error ? err.message : String(err));
    }
    await adapter.runScript(script);

    // Every line of the script is allowed to fail on its own, so check what the router has now.
    const iface = vlanInterfaceName(service, vlan.vlanTag);
    const check = service === "hotspot" ? `[/ip hotspot find name=mkg-hs-vlan${vlan.vlanTag}]` : `[/interface pppoe-server server find service-name=mkg-pppoe-vlan${vlan.vlanTag}]`;
    const out = await adapter.runScript(`:put ([:len [/interface vlan find name=${iface} vlan-id=${vlan.vlanTag}]] . "," . [:len ${check}])`);
    const [hasIface, hasServer] = out.trim().split(",").map(Number);
    if (!hasIface) return await fail(`The router didn't create ${iface} on ${trunk}. Check that ${trunk} exists and isn't used for something else, then try again.`);
    if (!hasServer) {
      return await fail(
        service === "hotspot"
          ? "The VLAN is on the router but its hotspot server didn't start. Run the router's main setup script (it sets up the hotspot profile and RADIUS), then try again."
          : "The VLAN is on the router but its PPPoE server didn't start. Check the router's log, then try again."
      );
    }
    return await record(vlan.id, { status: "ACTIVE", message: `${service === "hotspot" ? "Hotspot" : "PPPoE"} is running on VLAN ${vlan.vlanTag} over ${trunk}.`, trunkInterface: trunk });
  } catch (err) {
    return await fail(`The router refused the setup: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}

/** Worker pass: finishes VLANs left PENDING because their router was offline. */
export async function retryPendingVlans(): Promise<AutomationSummary> {
  const pending = await prisma.vlan.findMany({
    where: { provisioningStatus: "PENDING", deletedAt: null, isEnabled: true, routerId: { not: null }, router: { deletedAt: null, host: { not: null } } },
    select: { id: true, tenantId: true },
    take: 50,
  });
  let applied = 0;
  let waiting = 0;
  let failed = 0;
  for (const v of pending) {
    const r = await applyVlanToRouter(v.tenantId, v.id).catch(() => null);
    if (r?.status === "ACTIVE") applied++;
    else if (r?.status === "PENDING") waiting++;
    else failed++;
  }
  return { applied, waiting, failed };
}
