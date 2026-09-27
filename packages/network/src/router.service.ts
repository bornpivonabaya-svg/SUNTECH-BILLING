import { prisma, type Router, type RouterVendor } from "@mashupkgrid/database";
import {
  NotFoundError,
  ConflictError,
  encryptAtRest,
  decryptAtRest,
  generateSecureToken,
  hashToken,
} from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { createAdapterForRouter } from "./factory.js";
import { MikroTikAdapter } from "./mikrotik/mikrotik.adapter.js";
import type { DeviceHealth, DeviceSession, ConnectedAccessPoint } from "./adapter.interface.js";
import { allocateNextVpnIp, registerWireguardPeer, removeWireguardPeer } from "./wireguard-peer.service.js";
import { ensureWinboxRelayPort } from "./winbox-relay.service.js";
import { APP_FILTER_RULE_COUNT, APP_FILTER_TAG } from "./app-filter.js";
import { rememberActiveDevices } from "./hotspot-device.service.js";
import { listWalledGardenHostsFor } from "./walled-garden.js";
import type { RouterHeartbeatMetrics } from "./heartbeat-report.js";

export type { RouterHeartbeatMetrics } from "./heartbeat-report.js";

export const MANAGED_API_USERNAME = "mashupkgrid-api";

export interface CreateRouterInput {
  name: string;
  vendor: RouterVendor;
  host: string;
  apiPort?: number;
  useTls?: boolean;
  username: string;
  password: string;
  siteName?: string | null;
  branchId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  routerOsMajor?: 6 | 7 | null;
  blockTethering?: boolean;
}

export type UpdateRouterInput = Partial<CreateRouterInput>;

export async function listRouters(tenantId: string): Promise<Router[]> {
  return prisma.router.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: "asc" } });
}

export async function getRouterOrThrow(tenantId: string, routerId: string): Promise<Router> {
  const router = await prisma.router.findFirst({ where: { id: routerId, tenantId, deletedAt: null } });
  if (!router) throw new NotFoundError("Router");
  return router;
}

export async function createRouter(tenantId: string, input: CreateRouterInput): Promise<Router> {
  const existing = await prisma.router.findFirst({
    where: { tenantId, name: input.name, deletedAt: null },
  });
  if (existing) throw new ConflictError(`A router named "${input.name}" already exists`);

  return prisma.router.create({
    data: {
      tenantId,
      name: input.name,
      vendor: input.vendor,
      siteName: input.siteName ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      routerOsMajor: input.routerOsMajor ?? null,
      host: input.host,
      apiPort: input.apiPort ?? 8728,
      useTls: input.useTls ?? false,
      usernameEncrypted: encryptAtRest(input.username, env.ENCRYPTION_KEY),
      passwordEncrypted: encryptAtRest(input.password, env.ENCRYPTION_KEY),
      status: "UNKNOWN",
    },
  });
}

/** Creates a router row with no known address yet — just a name plus generated credentials
 *  (a dedicated RouterOS user/password only this platform knows) and a one-time provisioning
 *  token. The admin never types a host/port/username/password for this path at all: the token
 *  gets embedded in a paste-and-run script (packages/radius's buildMikrotikProvisioningScript),
 *  and `host` is filled in automatically once the router calls back with it (see
 *  completeRouterProvisioning) — the request's own source address *is* the discovered host,
 *  which only works when the router is directly reachable at that address afterward (a public
 *  or port-forwarded IP, same assumption a WISP's edge/CPE routers typically already satisfy).
 *  Returns the plaintext provisioning token alongside the row — like an API key, it is never
 *  recoverable again once this call returns. */
export interface PendingRouterPppoe {
  pppoeInterface?: string;
  pppoeGatewayIp?: string;
  pppoePoolRange?: string;
  blockTethering?: boolean;
  hotspotPorts?: string[];
  lanPort?: string | null;
  routerOsMajor?: 6 | 7 | null;
}

export async function createPendingRouter(
  tenantId: string,
  name: string,
  pppoe: PendingRouterPppoe = {}
): Promise<{ router: Router; provisionToken: string }> {
  const existing = await prisma.router.findFirst({ where: { tenantId, name, deletedAt: null } });
  if (existing) throw new ConflictError(`A router named "${name}" already exists`);

  const generatedPassword = generateSecureToken(18);
  const provisionToken = generateSecureToken(24);

  const router = await prisma.router.create({
    data: {
      tenantId,
      name,
      vendor: "MIKROTIK",
      apiPort: 8728,
      useTls: false,
      usernameEncrypted: encryptAtRest(MANAGED_API_USERNAME, env.ENCRYPTION_KEY),
      passwordEncrypted: encryptAtRest(generatedPassword, env.ENCRYPTION_KEY),
      provisionTokenHash: hashToken(provisionToken),
      status: "UNKNOWN",
      // Empty strings are stored as null: "" would satisfy the "is PPPoE configured?" check in
      // the script builder and emit a server bound to no interface.
      pppoeInterface: pppoe.pppoeInterface?.trim() || null,
      pppoeGatewayIp: pppoe.pppoeGatewayIp?.trim() || null,
      pppoePoolRange: pppoe.pppoePoolRange?.trim() || null,
      blockTethering: pppoe.blockTethering === true,
      hotspotPorts: pppoe.hotspotPorts && pppoe.hotspotPorts.length > 0 ? pppoe.hotspotPorts : [],
      lanPort: pppoe.lanPort?.trim() || null,
      routerOsMajor: pppoe.routerOsMajor ?? null,
    },
  });

  return { router, provisionToken };
}

/** Reveals the plaintext RouterOS credentials this platform generated for a pending router —
 *  needed once, to embed in the provisioning script (never stored or shown as plaintext, same
 *  as the RADIUS password reveal pattern). */
export async function getGeneratedCredentials(
  tenantId: string,
  routerId: string
): Promise<{ username: string; password: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  return {
    username: MANAGED_API_USERNAME,
    password: decryptAtRest(router.passwordEncrypted, env.ENCRYPTION_KEY),
  };
}

/** Pre-allocates or returns the reserved WireGuard tunnel IP for a router */
export async function ensureRouterVpnIp(routerId: string): Promise<string> {
  const router = await prisma.router.findUnique({ where: { id: routerId } });
  if (!router) throw new NotFoundError("Router");
  if (router.vpnIp) return router.vpnIp;

  const vpnIp = await prisma.$transaction(async (tx) => {
    const existing = await tx.router.findUnique({ where: { id: routerId } });
    if (existing?.vpnIp) return existing.vpnIp;
    const inUse = await tx.router.findMany({
      where: { vpnIp: { not: null }, id: { not: routerId } },
      select: { vpnIp: true },
    });
    const candidate = allocateNextVpnIp(env.WIREGUARD_SUBNET_CIDR, inUse.map((r) => r.vpnIp!));
    await tx.router.update({ where: { id: routerId }, data: { vpnIp: candidate } });
    return candidate;
  });

  return vpnIp;
}

/** Completes provisioning for the router that owns `provisionToken`: records the address the
 *  callback actually arrived from as its `host`, and if a WireGuard public key is provided,
 *  registers the peer and sets the tunnel IP as `host` automatically. */
/** Registers this router as a RADIUS NAS at the address its packets actually come FROM.
 *
 *  The embedded RADIUS server (packages/radius/src/radius-server.ts, getNasSecret) authorizes a
 *  NAS purely by the UDP source address of the incoming Access-Request, looking it up as
 *  RadiusNas.nasname. With no matching row it logs a warning and returns WITHOUT replying at
 *  all — and a MikroTik with no RADIUS reply leaves the login attempt pending, which the user
 *  sees on the captive portal as "Already authorizing, retry later". So a router that is
 *  otherwise perfectly provisioned can never authenticate anyone until this row exists.
 *
 *  `sourceAddress` is the address this callback arrived from, NOT router.host: when remote
 *  access is on, host becomes the WireGuard tunnel IP, but the router still sends RADIUS out
 *  its WAN to the platform's public address, so the packets keep arriving from the public IP.
 *  Registering the tunnel IP here would look right and still drop every Access-Request.
 *
 *  The secret is the router's own generated password because that is exactly what
 *  buildMikrotikProvisioningScript embeds as the RADIUS shared secret (its `radiusSecret`
 *  defaults to `credentials.password`) — the two must not drift apart.
 *
 *  Re-run on every heartbeat rather than once at provisioning, so a router on a dynamic or
 *  CGNAT address re-registers itself within a minute of its address changing instead of
 *  silently losing hotspot auth. */
async function syncRadiusNasRegistration(router: Router, sourceAddress: string): Promise<void> {
  const secret = decryptAtRest(router.passwordEncrypted, env.ENCRYPTION_KEY);
  const existing = await prisma.radiusNas.findFirst({ where: { routerId: router.id } });

  if (existing && existing.nasname === sourceAddress && existing.secret === secret) return;

  // `nasname` is globally unique (one source IP can only mean one NAS). A row already holding
  // this address that belongs to a DIFFERENT router is not ours to take — two routers sharing
  // one public address is unsupportable under source-IP-keyed auth, and stealing the row would
  // silently break whichever one lost the race. Leave it and make the reason visible instead.
  const conflict = await prisma.radiusNas.findFirst({
    where: { nasname: sourceAddress },
    include: { router: { select: { deletedAt: true, lastSeenAt: true } } },
  });
  // A row left behind by a removed router is not a live claim on the address, and neither is one
  // whose router has been silent for 10 minutes: on a mobile network (CGNAT) addresses move from
  // one subscriber to the next, and the router checking in right now is the one really there.
  const conflictIsLive =
    !conflict?.router?.deletedAt &&
    Boolean(conflict?.router?.lastSeenAt && Date.now() - conflict.router.lastSeenAt.getTime() < 10 * 60_000);
  if (conflict && conflict.routerId && conflict.routerId !== router.id && conflictIsLive) {
    console.warn(
      `[radius] Cannot register router ${router.id} at ${sourceAddress}: already registered to router ${conflict.routerId}. ` +
        `Both routers appear to share one public address — hotspot/PPPoE auth cannot work for both.`
    );
    return;
  }
  if (conflict) await prisma.radiusNas.delete({ where: { id: conflict.id } });

  if (existing) {
    await prisma.radiusNas.update({
      where: { id: existing.id },
      data: { nasname: sourceAddress, secret, shortname: router.name.slice(0, 32) },
    });
    return;
  }

  await prisma.radiusNas.create({
    data: {
      tenantId: router.tenantId,
      routerId: router.id,
      nasname: sourceAddress,
      shortname: router.name.slice(0, 32),
      type: "mikrotik",
      secret,
    },
  });
}

/** The router a setup/heartbeat token belongs to: its current token, or the previous one it
 *  still runs with until a freshly issued setup command has been run (see issueSetupCommand). */
export async function findRouterByProvisionToken(provisionToken: string): Promise<Router | null> {
  const hash = hashToken(provisionToken);
  return prisma.router.findFirst({
    where: { deletedAt: null, OR: [{ provisionTokenHash: hash }, { previousProvisionTokenHash: hash }] },
  });
}

/**
 * A new setup command for a router that already exists: the dashboard only keeps the token's
 * hash, so the original command can't be shown again. The token the router runs with now stays
 * valid (previousProvisionTokenHash) until the router first checks in with the new one, so it
 * never drops Offline in between — and asking twice before running either keeps the router's
 * working token, replacing only the unused new one.
 */
export async function issueSetupCommand(tenantId: string, routerId: string): Promise<string> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const provisionToken = generateSecureToken(24);
  await prisma.router.update({
    where: { id: router.id },
    data: {
      provisionTokenHash: hashToken(provisionToken),
      previousProvisionTokenHash: router.previousProvisionTokenHash ?? router.provisionTokenHash,
    },
  });
  return provisionToken;
}

export async function completeRouterProvisioning(
  provisionToken: string,
  remoteHost: string,
  wgPublicKey?: string,
  metrics?: RouterHeartbeatMetrics
): Promise<Router> {
  const router = await findRouterByProvisionToken(provisionToken);
  if (!router) throw new NotFoundError("Provisioning token");

  const cleanWgKey = wgPublicKey ? wgPublicKey.replace(/["'\r\n]/g, "").trim().replace(/ /g, "+") : "";

  const updateData: Record<string, unknown> = {
    // The router checked in with its new token: the old one has done its job.
    ...(router.previousProvisionTokenHash && router.provisionTokenHash === hashToken(provisionToken)
      ? { previousProvisionTokenHash: null }
      : {}),
    status: "ONLINE",
    lastSeenAt: new Date(),
    lastError: null,
    provisionedAt: router.provisionedAt ?? new Date(),
  };

  // Everything the router reported about itself; a field it didn't send keeps its last value.
  for (const [key, value] of Object.entries(metrics ?? {})) {
    if (value !== undefined) updateData[key] = value;
  }
  if (metrics?.routerOsVersion || metrics?.boardName) updateData.versionCheckedAt = new Date();

  // Always keyed to the WAN source address, in both the tunnel and no-tunnel paths below.
  try {
    await syncRadiusNasRegistration(router, remoteHost);
  } catch (err) {
    // A provisioning callback that reached us must still mark the router online; a NAS-sync
    // failure degrades hotspot auth but is not a reason to drop the heartbeat entirely.
    console.warn("RADIUS NAS registration warning on provisioning:", err);
  }

  let updated: Router;

  if (cleanWgKey) {
    const vpnIp = router.vpnIp || (await ensureRouterVpnIp(router.id));
    try {
      await registerWireguardPeer(env.WIREGUARD_INTERFACE, cleanWgKey, vpnIp);
    } catch (err) {
      console.warn("WireGuard peer registration warning on provisioning:", err);
    }

    updated = await prisma.router.update({
      where: { id: router.id },
      data: {
        ...updateData,
        host: vpnIp,
        vpnIp,
        vpnPublicKey: cleanWgKey,
        vpnConfiguredAt: router.vpnConfiguredAt ?? new Date(),
      },
    });
  } else {
    updated = await prisma.router.update({
      where: { id: router.id },
      data: {
        ...updateData,
        host: router.host || remoteHost,
      },
    });
  }

  syncRouterVlans(router.id).catch((err) => {
    console.warn(`[vlans] Auto-sync VLANs warning on provisioning:`, err);
  });

  // A router that just came up on the VPN gets its remote-WinBox port straight away, so the
  // dashboard can show it before the relay's next refresh.
  if (env.ENABLE_WINBOX_RELAY && updated.vpnIp && !updated.winboxRelayPort) {
    await ensureWinboxRelayPort(updated.id, env.WINBOX_RELAY_PORT_RANGE).catch((err) =>
      console.warn("[winbox-relay] Could not assign a relay port on provisioning:", err)
    );
  }

  return updated;
}

/** Automatically provisions any configured VLANs in the database directly onto the MikroTik router */
export async function syncRouterVlans(routerId: string): Promise<void> {
  const router = await prisma.router.findUnique({ where: { id: routerId, deletedAt: null } });
  if (!router?.host) return;

  const vlans = await prisma.vlan.findMany({
    where: { routerId, isEnabled: true, deletedAt: null },
  });
  if (vlans.length === 0) return;

  const adapter = createAdapterForRouter({ ...router, host: router.host });
  try {
    await adapter.connect();
    const ifaces = (await adapter.listInterfaces?.()) || [];
    // Default to ether2 or bridge or first available interface
    const parent = ifaces.find((i) => i.name === "ether2" || i.name === "bridge")?.name || ifaces[0]?.name || "ether2";

    for (const v of vlans) {
      try {
        await adapter.createVlanInterface?.({
          name: `vlan${v.vlanTag}`,
          vlanId: v.vlanTag,
          parentInterface: parent,
          comment: `MashupHost ${v.name}`,
        });
        await prisma.vlan.update({
          where: { id: v.id },
          data: { provisioningStatus: "ACTIVE", lastProvisionedAt: new Date() },
        });
      } catch {
        // Continue if interface already exists or error
      }
    }
    await adapter.disconnect().catch(() => {});
  } catch (err) {
    console.warn(`[syncRouterVlans] Failed to sync VLANs to router ${router.name}:`, err);
  }
}

/** Starts a router's WireGuard remote-access handshake: issues a one-time token (same pattern
 *  as provisioning) that the RouterOS-side script embeds in its own callback, so the platform
 *  never has to be told which router is calling — the token says so. */
export async function startVpnRegistration(
  tenantId: string,
  routerId: string
): Promise<{ router: Router; vpnRegisterToken: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const vpnRegisterToken = generateSecureToken(24);
  const updated = await prisma.router.update({
    where: { id: router.id },
    data: { vpnRegisterTokenHash: hashToken(vpnRegisterToken) },
  });
  return { router: updated, vpnRegisterToken };
}

/** Completes the handshake: the router has generated its own WireGuard keypair and is telling
 *  us its public key (its private key never leaves the router). Allocates a tunnel IP, adds the
 *  router as a peer on the platform's own WireGuard interface, and — the key behavioral change —
 *  overwrites `host` with that tunnel IP, so every existing host-based feature starts using the
 *  VPN path automatically without any of that code needing to know VPN exists. */
export async function completeVpnRegistration(vpnRegisterToken: string, publicKey: string): Promise<Router> {
  const router = await prisma.router.findFirst({
    where: { vpnRegisterTokenHash: hashToken(vpnRegisterToken), deletedAt: null },
  });
  if (!router) throw new NotFoundError("VPN registration token");

  const vpnIp = await prisma.$transaction(async (tx) => {
    if (router.vpnIp) return router.vpnIp;
    const inUse = await tx.router.findMany({
      where: { vpnIp: { not: null }, id: { not: router.id } },
      select: { vpnIp: true },
    });
    const candidate = allocateNextVpnIp(env.WIREGUARD_SUBNET_CIDR, inUse.map((r) => r.vpnIp!));
    const clash = await tx.router.findFirst({ where: { vpnIp: candidate, id: { not: router.id } } });
    if (clash) {
      throw new ConflictError("VPN IP allocation raced with another router — please retry registration");
    }
    return candidate;
  });

  try {
    await registerWireguardPeer(env.WIREGUARD_INTERFACE, publicKey, vpnIp);
  } catch (err) {
    console.warn("WireGuard peer registration deferred or host wg interface unavailable:", err);
  }

  const updated = await prisma.router.update({
    where: { id: router.id },
    data: {
      status: "ONLINE",
      lastSeenAt: new Date(),
      lastError: null,
      vpnPublicKey: publicKey,
      vpnIp,
      vpnConfiguredAt: router.vpnConfiguredAt ?? new Date(),
      host: vpnIp,
    },
  });
  if (env.ENABLE_WINBOX_RELAY) {
    const port = await ensureWinboxRelayPort(router.id, env.WINBOX_RELAY_PORT_RANGE).catch((err) => {
      console.warn("[winbox-relay] Could not assign a relay port on VPN registration:", err);
      return null;
    });
    if (port) updated.winboxRelayPort = port;
  }
  return updated;
}

export async function updateRouter(tenantId: string, routerId: string, patch: UpdateRouterInput): Promise<Router> {
  await getRouterOrThrow(tenantId, routerId);
  return prisma.router.update({
    where: { id: routerId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.vendor !== undefined ? { vendor: patch.vendor } : {}),
      ...(patch.host !== undefined ? { host: patch.host } : {}),
      ...(patch.apiPort !== undefined ? { apiPort: patch.apiPort } : {}),
      ...(patch.useTls !== undefined ? { useTls: patch.useTls } : {}),
      ...(patch.siteName !== undefined ? { siteName: patch.siteName || null } : {}),
      ...(patch.branchId !== undefined ? { branchId: patch.branchId } : {}),
      ...(patch.latitude !== undefined ? { latitude: patch.latitude } : {}),
      ...(patch.longitude !== undefined ? { longitude: patch.longitude } : {}),
      ...(patch.routerOsMajor !== undefined ? { routerOsMajor: patch.routerOsMajor } : {}),
      ...(patch.blockTethering !== undefined ? { blockTethering: patch.blockTethering } : {}),
      ...(patch.username !== undefined
        ? { usernameEncrypted: encryptAtRest(patch.username, env.ENCRYPTION_KEY) }
        : {}),
      ...(patch.password !== undefined
        ? { passwordEncrypted: encryptAtRest(patch.password, env.ENCRYPTION_KEY) }
        : {}),
    },
  });
}

/** Re-adds every VPN-linked router as a peer on the platform's WireGuard interface, and reports
 *  how many were restored.
 *
 *  A WireGuard peer table lives only in the kernel's copy of the interface, so it is emptied
 *  every time that interface is recreated — which, now that the interface is brought up inside
 *  the API container, is *every deploy and every restart*. The routers themselves reconnect on
 *  their own (their side holds the tunnel open with persistent-keepalive), but the server would
 *  refuse them, so remote access to every router would silently go dead after a routine redeploy
 *  and only come back if someone re-ran the registration by hand. The durable record is
 *  Router.vpnPublicKey/vpnIp in Postgres; this replays it onto the fresh interface at boot.
 *
 *  Best-effort by design: a deployment with WireGuard switched off, or one where the interface
 *  isn't up yet, must not stop the API from starting. */
export async function syncWireguardPeersFromDatabase(): Promise<number> {
  if (!env.ENABLE_WIREGUARD_REMOTE_ACCESS) return 0;
  const linked = await prisma.router.findMany({
    where: { deletedAt: null, vpnPublicKey: { not: null }, vpnIp: { not: null } },
    select: { vpnPublicKey: true, vpnIp: true },
  });

  let restored = 0;
  for (const router of linked) {
    try {
      await registerWireguardPeer(env.WIREGUARD_INTERFACE, router.vpnPublicKey!, router.vpnIp!);
      restored++;
    } catch {
      // One unreachable peer shouldn't abort the rest of the replay.
    }
  }
  return restored;
}

export async function deleteRouter(tenantId: string, routerId: string): Promise<void> {
  const router = await getRouterOrThrow(tenantId, routerId);
  if (router.vpnPublicKey) {
    await removeWireguardPeer(env.WIREGUARD_INTERFACE, router.vpnPublicKey);
  }
  // Its RADIUS client registration goes too: a leftover row keeps the router's address claimed,
  // and the same hardware re-added (or another router behind that address) could then never
  // register — hotspot logins would get no RADIUS reply at all. The relay port is freed with it.
  await prisma.$transaction([
    prisma.radiusNas.deleteMany({ where: { routerId } }),
    prisma.router.update({ where: { id: routerId }, data: { deletedAt: new Date(), winboxRelayPort: null } }),
  ]);
}

/** How long after its last heartbeat a router is still considered alive when the platform
 *  cannot open a management connection to it. buildMikrotikProvisioningScript schedules that
 *  heartbeat every 60s (1m), so 2.5 minutes represents 2 missed heartbeats: responsive enough
 *  that staff immediately see when a router is powered off, yet tolerant of a momentary dropped packet. */
const HEARTBEAT_LIVENESS_WINDOW_MS = 2.5 * 60 * 1000;

/** Opens a real connection to the router, runs a health check, and persists the result onto
 *  the Router row (status/lastSeenAt/lastError/resource usage) so the routers list reflects
 *  reality without a separate polling round-trip from the caller. */
/** Base URL routers use to reach the API (see ROUTER_API_BASE_URL). */
export function routerFacingApiBase(): string {
  return (env.ROUTER_API_BASE_URL || env.APP_API_PUBLIC_URL).replace(/\/+$/, "");
}

/** The platform's historical default RADIUS/management address, still baked into older scripts. */
export const LEGACY_PLATFORM_ADDRESS = "68.210.187.104";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
let resolvedPlatformAddress: { host: string; ip: string; at: number } | null = null;
let warnedAboutFallback = false;

/**
 * The public IPv4 address routers reach this platform on. RADIUS packets go here, and it is the
 * address allowed to manage a router's API and WinBox.
 *
 * RADIUS_SERVER_HOST when set (the right thing on any real deployment: RouterOS takes an IP, not
 * a name, and a name behind a CDN proxy resolves to the CDN, which does not forward UDP).
 * Otherwise the API's own host from routerFacingApiBase, resolved through DNS when it is a name.
 * Only when neither gives a usable address does it fall back to the historical server, and it
 * says so in the log: a router pointed at the wrong address fails every login with no error the
 * customer or the operator can see.
 */
export async function platformPublicAddress(): Promise<string> {
  const explicit = process.env["RADIUS_SERVER_HOST"]?.trim();
  if (explicit) return explicit;

  const host = hostOf(routerFacingApiBase());
  if (isIP(host) === 4) return host;
  if (host && !LOCAL_HOSTS.has(host)) {
    const cached = resolvedPlatformAddress;
    if (cached && cached.host === host && Date.now() - cached.at < 5 * 60_000) return cached.ip;
    try {
      const { address } = await lookup(host, { family: 4 });
      resolvedPlatformAddress = { host, ip: address, at: Date.now() };
      return address;
    } catch (err) {
      console.warn(`[routers] could not resolve ${host} to an IPv4 address:`, err instanceof Error ? err.message : err);
    }
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      `[routers] RADIUS_SERVER_HOST is not set and the API URL (${host || "unset"}) gives no public IPv4 address. ` +
        `Routers will be pointed at ${LEGACY_PLATFORM_ADDRESS}; set RADIUS_SERVER_HOST to this server's public IP.`
    );
  }
  return LEGACY_PLATFORM_ADDRESS;
}

/** Where routers send RADIUS. */
export function routerRadiusHost(): Promise<string> {
  return platformPublicAddress();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The portal and the API behind it: reachable even for app-only customers, so they can buy more. */
export function appFilterPortalHosts(): string[] {
  return [...new Set([hostOf(env.APP_PORTAL_URL || "https://captive.mashuphost.tech"), hostOf(routerFacingApiBase())].filter(Boolean))];
}

const RECONCILE_INTERVAL_MS = 10 * 60_000;
/** Leave a just-linked router alone while its setup script is still running on it. */
const RECONCILE_GRACE_AFTER_LINK_MS = 3 * 60_000;
const lastReconciledAt = new Map<string, number>();

/**
 * Server-side self-repair for a linked router's hotspot essentials (login page + RADIUS server).
 * Runs over the management API at most every 10 minutes per router, so an operator never has to
 * fix a half-applied setup by hand. Returns what was changed, or null when it didn't run.
 */
export async function reconcileRouterProvisioning(routerId: string, options: { force?: boolean } = {}): Promise<string[] | null> {
  const now = Date.now();
  if (!options.force && now - (lastReconciledAt.get(routerId) ?? 0) < RECONCILE_INTERVAL_MS) return null;

  const router = await prisma.router.findFirst({ where: { id: routerId, deletedAt: null }, include: { tenant: { select: { slug: true } } } });
  if (!router?.host || router.vendor !== "MIKROTIK" || !router.tenant?.slug) return null;
  if (!options.force && router.provisionedAt && now - router.provisionedAt.getTime() < RECONCILE_GRACE_AFTER_LINK_MS) return null;
  lastReconciledAt.set(routerId, now);

  const adapter = createAdapterForRouter({ ...router, host: router.host });
  if (!(adapter instanceof MikroTikAdapter)) return null;
  const radiusHost = await routerRadiusHost();
  try {
    await adapter.connect();
    // Phones online right now that the server doesn't know yet: remembered so they reconnect by MAC.
    // Done first and on its own, so a slow router timing out on the setup checks below can't skip it.
    let learned = 0;
    try {
      const sessions = await adapter.getActiveSessions();
      learned = await rememberActiveDevices(router.tenantId, sessions.map((s) => ({ username: s.username, callerId: s.callerId })));
    } catch (err) {
      console.warn(`[routers] could not read connected phones on "${router.name}":`, err instanceof Error ? err.message : err);
    }
    if (learned > 0) console.log(`[routers] remembered ${learned} connected phone${learned === 1 ? "" : "s"} on "${router.name}" for automatic reconnect`);

    const changes = await adapter.ensureHotspotProvisioning({
      loginTemplateUrl: `${routerFacingApiBase()}/api/v1/hotspot/${router.tenant.slug}/mikrotik-login-template`,
      radiusHost,
      radiusSecret: decryptAtRest(router.passwordEncrypted, env.ENCRYPTION_KEY),
      retiredRadiusHosts: radiusHost === LEGACY_PLATFORM_ADDRESS ? [] : [LEGACY_PLATFORM_ADDRESS],
      walledGardenHosts: [
        hostOf(env.APP_PORTAL_URL || "https://captive.mashuphost.tech"),
        hostOf(routerFacingApiBase()),
        // What a super admin and this ISP allowed from the dashboard — this pass is how a router
        // that is already online picks up a host added after it was linked.
        ...(await listWalledGardenHostsFor(router.tenantId)),
      ].filter(Boolean),
      blockTethering: router.blockTethering,
      appFilter: {
        scriptUrl: `${routerFacingApiBase()}/api/v1/hotspot/${router.tenant.slug}/mikrotik-app-filter.rsc`,
        tag: APP_FILTER_TAG,
        expectedRules: APP_FILTER_RULE_COUNT,
      },
    });
    if (changes.length > 0) console.log(`[routers] repaired "${router.name}": ${changes.join("; ")}`);
    return changes;
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function testRouterConnection(tenantId: string, routerId: string): Promise<DeviceHealth> {
  const router = await getRouterOrThrow(tenantId, routerId);
  if (!router.host) {
    const health: DeviceHealth = {
      reachable: false,
      error: "Waiting for the router to check in — paste the provisioning script on the router first.",
    };
    await prisma.router.update({
      where: { id: router.id },
      data: { status: "UNKNOWN", lastError: health.error },
    });
    return health;
  }
  const adapter = createAdapterForRouter({ ...router, host: router.host });

  let health: DeviceHealth = { reachable: false };
  // True when "reachable" was inferred from a recent heartbeat rather than an actual connection.
  // The distinction decides whether lastSeenAt may be advanced below — see the update call.
  let inferredFromHeartbeat = false;
  try {
    await adapter.connect();
    health = await adapter.healthCheck();
  } catch (err) {
    if (router.vpnIp && router.vpnIp !== router.host) {
      try {
        const vpnAdapter = createAdapterForRouter({ ...router, host: router.vpnIp });
        await vpnAdapter.connect();
        const vpnHealth = await vpnAdapter.healthCheck();
        await vpnAdapter.disconnect().catch(() => {});
        if (vpnHealth.reachable) {
          health = vpnHealth;
          await prisma.router.update({ where: { id: router.id }, data: { host: router.vpnIp } });
          router.host = router.vpnIp;
        } else if (router.lastSeenAt && Date.now() - router.lastSeenAt.getTime() < HEARTBEAT_LIVENESS_WINDOW_MS) {
          inferredFromHeartbeat = true;
          health = {
            reachable: true,
            cpuLoadPercent: router.cpuLoadPercent ?? undefined,
            uptimeSeconds: router.uptimeSeconds ?? undefined,
            memoryUsedBytes: router.memoryUsedBytes ?? undefined,
            memoryTotalBytes: router.memoryTotalBytes ?? undefined,
            temperatureC: router.temperatureC ?? undefined,
          };
        } else {
          health = { reachable: false, error: err instanceof Error ? err.message : String(err) };
        }
      } catch {
        if (router.lastSeenAt && Date.now() - router.lastSeenAt.getTime() < HEARTBEAT_LIVENESS_WINDOW_MS) {
          inferredFromHeartbeat = true;
          health = {
            reachable: true,
            cpuLoadPercent: router.cpuLoadPercent ?? undefined,
            uptimeSeconds: router.uptimeSeconds ?? undefined,
            memoryUsedBytes: router.memoryUsedBytes ?? undefined,
            memoryTotalBytes: router.memoryTotalBytes ?? undefined,
            temperatureC: router.temperatureC ?? undefined,
          };
        } else {
          health = { reachable: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    } else if (router.lastSeenAt && Date.now() - router.lastSeenAt.getTime() < HEARTBEAT_LIVENESS_WINDOW_MS) {
      inferredFromHeartbeat = true;
      health = {
        reachable: true,
        cpuLoadPercent: router.cpuLoadPercent ?? undefined,
        uptimeSeconds: router.uptimeSeconds ?? undefined,
        memoryUsedBytes: router.memoryUsedBytes ?? undefined,
        memoryTotalBytes: router.memoryTotalBytes ?? undefined,
        temperatureC: router.temperatureC ?? undefined,
      };
    } else {
      health = { reachable: false, error: err instanceof Error ? err.message : String(err) };
    }
  } finally {
    await adapter.disconnect().catch(() => {});
  }

  await prisma.router.update({
    where: { id: router.id },
    data: {
      status: health.reachable ? "ONLINE" : "DOWN",
      // Only a genuinely successful connection advances lastSeenAt. A real heartbeat writes it
      // itself (completeRouterProvisioning), so nothing is lost here — whereas advancing it on
      // an INFERRED result makes the liveness check self-refreshing: the branches above read
      // lastSeenAt to conclude the router is alive, and writing it back means the next poll
      // reads a timestamp this poll just set. With poll-router-health running every 20 seconds,
      // that window never expires and a router physically unplugged from the wall reports
      // ONLINE indefinitely. Confirmed live on a disconnected hAP.
      ...(health.reachable && !inferredFromHeartbeat ? { lastSeenAt: new Date() } : {}),
      lastError: health.error ?? null,
      // Figures only from a live read. An inferred result carries the values this poll read at
      // its start, and connecting takes seconds to time out — writing them back would overwrite
      // the report the router posted meanwhile, freezing its CPU/memory/temperature on screen.
      ...(inferredFromHeartbeat || !health.reachable
        ? {}
        : {
            cpuLoadPercent: health.cpuLoadPercent ?? router.cpuLoadPercent ?? null,
            memoryUsedBytes: health.memoryUsedBytes ?? router.memoryUsedBytes ?? null,
            memoryTotalBytes: health.memoryTotalBytes ?? router.memoryTotalBytes ?? null,
            uptimeSeconds: health.uptimeSeconds ?? router.uptimeSeconds ?? null,
            temperatureC: health.temperatureC ?? router.temperatureC ?? null,
          }),
    },
  });

  return health;
}

export async function getRouterActiveSessions(tenantId: string, routerId: string): Promise<DeviceSession[]> {
  const router = await getRouterOrThrow(tenantId, routerId);
  if (!router.host) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router, or link it manually.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: router.host });
  try {
    await adapter.connect();
    return await adapter.getActiveSessions();
  } catch (err) {
    // A router being offline is a routine, expected condition here — same as
    // testRouterConnection's `{ reachable: false }` path — not a server bug, so it must not
    // surface as a raw 500. Empty sessions would be misleading (implies a real check that found
    // nothing); a clear "couldn't check" error is what the caller actually needs to show.
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Could not reach "${router.name}" to list active sessions: ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

const routerReportedApsCache = new Map<string, ConnectedAccessPoint[]>();

export function recordRouterReportedAccessPoints(routerId: string, aps: ConnectedAccessPoint[], tenantId?: string): void {
  routerReportedApsCache.set(routerId, aps);
  if (tenantId) routerReportedApsCache.set(tenantId, aps);
  routerReportedApsCache.set("global_last_reported", aps);
}

export function getRouterReportedAccessPoints(routerId: string): ConnectedAccessPoint[] | undefined {
  return routerReportedApsCache.get(routerId) || routerReportedApsCache.get("global_last_reported");
}

export async function getRouterConnectedAccessPoints(
  tenantId: string,
  routerId: string
): Promise<ConnectedAccessPoint[]> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const cached =
    routerReportedApsCache.get(router.id) ||
    routerReportedApsCache.get(router.tenantId) ||
    routerReportedApsCache.get("global_last_reported");
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    if (cached && cached.length > 0) return cached;
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router, or link it manually.`
    );
  }
  let adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    try {
      await adapter.connect();
    } catch (err) {
      if (router.vpnIp && router.vpnIp !== primaryHost) {
        const vpnAdapter = createAdapterForRouter({ ...router, host: router.vpnIp });
        await vpnAdapter.connect();
        adapter = vpnAdapter;
        await prisma.router.update({ where: { id: router.id }, data: { host: router.vpnIp } }).catch(() => {});
      } else {
        throw err;
      }
    }
    if (adapter.getConnectedAccessPoints) {
      const aps = await adapter.getConnectedAccessPoints();
      if (aps.length > 0) {
        routerReportedApsCache.set(router.id, aps);
      }
      return aps;
    }
    return cached || [];
  } catch (err) {
    // If live connection to port 8728 timed out / failed (e.g. router behind locked modem/CGNAT)
    // but the router reported its access points via outbound sync, return them!
    if (cached && cached.length > 0) {
      return cached;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Could not reach "${router.name}" to detect connected access points: ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

/** Bulk maintenance/incident-response action — kicks every PPPoE and hotspot session this
 *  router currently has, all at once. Returns how many were actually removed. */
export async function disconnectAllRouterSessions(tenantId: string, routerId: string): Promise<number> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router, or link it manually.`
    );
  }
  let adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    try {
      await adapter.connect();
    } catch (err) {
      if (router.vpnIp && router.vpnIp !== primaryHost) {
        const vpnAdapter = createAdapterForRouter({ ...router, host: router.vpnIp });
        await vpnAdapter.connect();
        adapter = vpnAdapter;
        await prisma.router.update({ where: { id: router.id }, data: { host: router.vpnIp } }).catch(() => {});
      } else {
        throw err;
      }
    }
    return await adapter.disconnectAllSessions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Could not reach "${router.name}" to disconnect sessions: ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function applyRouterSpeedtestBoost(
  tenantId: string,
  routerId: string
): Promise<{ success: boolean; message: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  if (!router.host) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: router.host });
  try {
    await adapter.connect();
    if (!adapter.applySpeedtestBoost) {
      throw new ConflictError("Speedtest booster is not supported on this router model");
    }
    return await adapter.applySpeedtestBoost();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to apply Speedtest boost on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function enforceRouterStrictTimeout(
  tenantId: string,
  routerId: string
): Promise<{ success: boolean; cookiesRemoved: number; message: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  if (!router.host) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: router.host });
  try {
    await adapter.connect();
    if (!adapter.enforceStrictTimeout) {
      throw new ConflictError("Strict timeout enforcement is not supported on this router model");
    }
    return await adapter.enforceStrictTimeout();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to enforce strict timeout on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export type AntiTunnelStatus = { state: "applying" | "on" | "off" | "failed" | "unknown"; rules: number | null; expected: number };

async function withRouterAdapter<T>(tenantId: string, routerId: string, fn: (adapter: ReturnType<typeof createAdapterForRouter>, name: string) => Promise<T>): Promise<T> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(`"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`);
  }
  const adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    await adapter.connect();
    return await fn(adapter, router.name);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

/** Starts turning "Block tunnelling apps" on or off (see anti-tunnel.ts). The router applies it in
 *  the background; follow up with getRouterAntiTunnelStatus. */
export async function startRouterAntiTunnelShield(tenantId: string, routerId: string, enabled: boolean): Promise<{ started: boolean }> {
  return withRouterAdapter(tenantId, routerId, async (adapter, name) => {
    if (!adapter.startAntiTunnelShield) throw new ConflictError("Tunnel blocking isn't supported on this router model.");
    try {
      return await adapter.startAntiTunnelShield(enabled);
    } catch (err) {
      throw new ConflictError(`Couldn't start turning tunnel blocking ${enabled ? "on" : "off"} on "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Where the router is with tunnel blocking, from what it recorded itself. */
export async function getRouterAntiTunnelStatus(tenantId: string, routerId: string): Promise<AntiTunnelStatus> {
  return withRouterAdapter<AntiTunnelStatus>(tenantId, routerId, async (adapter) => {
    if (!adapter.getAntiTunnelStatus) throw new ConflictError("Tunnel blocking isn't supported on this router model.");
    const s = await adapter.getAntiTunnelStatus();
    const state: AntiTunnelStatus["state"] = s.state === "done" ? (s.rules === 0 ? "off" : "on") : s.state;
    return { state, rules: s.rules, expected: s.expected };
  }).catch((err) => {
    // A router busy rewriting its firewall may refuse the login; that's "still working", not an error.
    if (err instanceof ConflictError) throw err;
    return { state: "unknown" as const, rules: null, expected: 0 };
  });
}

export async function enableRouterPcqFairQueue(
  tenantId: string,
  routerId: string
): Promise<{ success: boolean; message: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    await adapter.connect();
    if (!adapter.enablePcqFairQueue) {
      throw new ConflictError("PCQ Fair-Queue is not supported on this router model");
    }
    return await adapter.enablePcqFairQueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to activate Fair-Share PCQ Shaper on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function enableRouterSafeFamilyDns(
  tenantId: string,
  routerId: string,
  familyMode = true
): Promise<{ success: boolean; message: string; servers: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    await adapter.connect();
    if (!adapter.enableSafeFamilyDns) {
      throw new ConflictError("Safe Family DNS is not supported on this router model");
    }
    return await adapter.enableSafeFamilyDns(familyMode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to apply Safe Family DNS on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function checkRouterFirmwareUpdate(
  tenantId: string,
  routerId: string
): Promise<{ currentVersion: string; latestVersion: string; status: string; upgradeAvailable: boolean }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    await adapter.connect();
    if (!adapter.checkFirmwareUpdate) {
      throw new ConflictError("Firmware check is not supported on this router model");
    }
    return await adapter.checkFirmwareUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to check firmware on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

export async function installRouterFirmwareUpdate(
  tenantId: string,
  routerId: string
): Promise<{ success: boolean; message: string }> {
  const router = await getRouterOrThrow(tenantId, routerId);
  const primaryHost = router.host || router.vpnIp;
  if (!primaryHost) {
    throw new ConflictError(
      `"${router.name}" hasn't checked in yet — paste the provisioning script on the router first.`
    );
  }
  const adapter = createAdapterForRouter({ ...router, host: primaryHost });
  try {
    await adapter.connect();
    if (!adapter.installFirmwareUpdate) {
      throw new ConflictError("Firmware update is not supported on this router model");
    }
    return await adapter.installFirmwareUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConflictError(`Failed to install firmware update on "${router.name}": ${message}`);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}
