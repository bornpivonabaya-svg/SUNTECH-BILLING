import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma, type Router as RouterRow } from "@mashupkgrid/database";
import {
  listRouters,
  getRouterOrThrow,
  createRouter,
  createPendingRouter,
  getGeneratedCredentials,
  completeRouterProvisioning,
  hotspotProblems,
  type HotspotCheck,
  findRouterByProvisionToken,
  issueSetupCommand,
  isHeartbeatReport,
  parseHeartbeatReport,
  ensureRouterVpnIp,
  startVpnRegistration,
  completeVpnRegistration,
  updateRouter,
  deleteRouter,
  testRouterConnection,
  getRouterActiveSessions,
  getRouterConnectedAccessPoints,
  recordRouterReportedAccessPoints,
  type ConnectedAccessPoint,
  disconnectAllRouterSessions,
  applyRouterSpeedtestBoost,
  enforceRouterStrictTimeout,
  startRouterAntiTunnelShield,
  getRouterAntiTunnelStatus,
  enableRouterPcqFairQueue,
  enableRouterSafeFamilyDns,
  checkRouterFirmwareUpdate,
  installRouterFirmwareUpdate,
  routerFacingApiBase,
  appFilterPortalHosts,
  routerRadiusHost,
  platformPublicAddress,
  listWalledGardenHostsFor,
  reconcileRouterProvisioning,
  heartbeatOnlineWindowMs,
  heartbeatLateWindowMs,
  heartbeatIntervalRouterOs,
} from "@mashupkgrid/network";
import {
  buildMikrotikProvisioningScript,
  buildHeartbeatScript,
  buildMikrotikVpnStartScript,
  buildMikrotikVpnCompleteScript,
  buildMikrotikWinboxScript,
  buildSocialFirewallOnlyScript,
  hotspotWalledGardenHosts,
  type CardGateway,
  type VpnPeerSettings,
} from "@mashupkgrid/radius";
import { successResponse, ConflictError, NotFoundError } from "@mashupkgrid/shared";
import { env, isProduction } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { requireFeature } from "../plugins/require-feature.js";
import { writeAuditLog } from "../lib/audit.js";
import { assertWithinPlanLimit } from "../lib/plan-limits.js";
import { winboxRelayHost } from "../lib/winbox-relay-host.js";
import { portalPageSizes } from "../lib/router-pages.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

// Every one of these values gets interpolated directly into a generated RouterOS script or a
// FreeRADIUS clients.conf `client { }` block that staff are told to paste/copy verbatim (see
// packages/radius/src/setup-script.ts) — neither format has any quoting/escaping applied at
// render time, so an unrestricted string here is a real script-injection vector: a name
// containing a newline breaks out of a `#` comment line into a live command, and a value
// containing `}` breaks out of the FreeRADIUS client block into a second, attacker-controlled
// one. These allowlists (not blocklists) are the actual fix — reject anything that isn't a
// plain identifier/hostname rather than trying to escape special characters per-template.
const ROUTER_NAME_PATTERN = /^[a-zA-Z0-9 ._-]+$/;
const HOST_PATTERN = /^[a-zA-Z0-9.:-]+$/;

const createRouterSchema = z.object({
  name: z.string().min(1).max(64).regex(ROUTER_NAME_PATTERN, "Router name may only contain letters, numbers, spaces, and . _ -"),
  vendor: z.enum(["MIKROTIK"]),
  host: z.string().min(1).max(255).regex(HOST_PATTERN, "Host must be a plain hostname or IP address"),
  apiPort: z.number().int().positive().optional(),
  useTls: z.boolean().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  siteName: z.string().trim().max(80).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  routerOsMajor: z.union([z.literal(6), z.literal(7)]).nullable().optional(),
  /** Anti-tethering for every signed-in hotspot device on this router (see antiTetheringRules). */
  blockTethering: z.boolean().optional(),
});

const updateRouterSchema = createRouterSchema.partial();

/** PPPoE is optional per router. The interface is what turns it on; the address fields fall back
 *  to documented defaults in the script builder, so an operator who only knows their port can
 *  still get a working server. */
const pppoeFieldsSchema = {
  pppoeInterface: z
    .string()
    .max(64)
    // One port, or several separated by commas ("ether4,ether5"): joined in one PPPoE bridge.
    .regex(/^[a-zA-Z0-9_.,-]*$/, "Ports may only contain letters, numbers, and . _ - (several separated by commas)")
    .optional(),
  pppoeGatewayIp: z
    .string()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Gateway must be an IPv4 address like 10.10.0.1")
    .optional()
    .or(z.literal("")),
  pppoePoolRange: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/,
      "Pool must be a range like 10.10.0.2-10.10.255.254"
    )
    .optional()
    .or(z.literal("")),
  blockTethering: z.boolean().optional(),
  hotspotPorts: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+$/)).optional(),
  lanPort: z.string().regex(/^[a-zA-Z0-9_.-]*$/).optional().nullable(),
  /** RouterOS 6 or 7 as the ISP knows it; null or absent lets the script detect it. */
  routerOsMajor: z.union([z.literal(6), z.literal(7)]).nullable().optional(),
};

const createPendingRouterSchema = z.object({
  name: z.string().min(1).max(64).regex(ROUTER_NAME_PATTERN, "Router name may only contain letters, numbers, spaces, and . _ -"),
  ...pppoeFieldsSchema,
});

const idParamsSchema = z.object({ routerId: z.string().uuid() });
/** A tenant's own portal hostnames, for the router's walled garden. A white-labelled tenant
 *  sends its customers to its own domain, not the platform's, so a router that only allows the
 *  platform host blocks the exact page it just redirected the customer to — which presents as
 *  the captive portal "not loading" with no clue as to why.
 *
 *  SSL_PENDING is included alongside the fully-live statuses deliberately: allowing a host the
 *  router will need shortly is harmless, whereas re-running the provisioning script every time a
 *  certificate finishes issuing is the kind of step that silently never happens. */
async function getTenantPortalDomains(tenantId: string): Promise<string[]> {
  const domains = await prisma.domain.findMany({
    where: { tenantId, status: { in: ["VERIFIED", "SSL_PENDING", "SSL_ACTIVE"] } },
    select: { hostname: true },
  });
  return domains.map((d) => d.hostname);
}

/** The card gateways this ISP takes hotspot payments with (switched on, and not hidden from the
 *  portal): only these get their checkout hosts in the walled garden. */
async function tenantCardGateways(tenantId: string): Promise<CardGateway[]> {
  const [configs, tenant] = await Promise.all([
    prisma.paymentProviderConfig.findMany({ where: { tenantId, isActive: true }, select: { provider: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { portalPaymentsDisabled: true } }),
  ]);
  const disabled = new Set<string>(tenant?.portalPaymentsDisabled ?? []);
  return (["PAYSTACK", "PESAPAL"] as const).filter(
    (g) => configs.some((c) => (c.provider as string) === g) && !disabled.has(g)
  );
}

function portalHostname(): string {
  return env.APP_PORTAL_URL ? new URL(env.APP_PORTAL_URL).hostname : "captive.mashuphost.tech";
}

/** What an unpaid device on this ISP's routers may reach; the heartbeat keeps routers to it. */
async function tenantWalledGarden(tenantId: string): Promise<string[]> {
  const [portalDomains, cardGateways, extraHosts] = await Promise.all([
    getTenantPortalDomains(tenantId),
    tenantCardGateways(tenantId),
    listWalledGardenHostsFor(tenantId),
  ]);
  return hotspotWalledGardenHosts({
    apiHost: new URL(routerApiBase()).hostname,
    portalHost: portalHostname(),
    portalDomains,
    cardGateways,
    extraHosts,
  });
}

/** The platform's end of the management VPN: its public key (from the environment, else from
 *  wg0 itself) and the host routers dial. */
async function wireguardServer(): Promise<{ serverPublicKey: string; serverHost: string; serverPort: number }> {
  // The key the interface is really running with comes first: a WIREGUARD_SERVER_PUBLIC_KEY left
  // over from an earlier key would send every router to a peer that doesn't exist.
  let serverPublicKey = "";
  try {
    const { execFileSync } = await import("node:child_process");
    serverPublicKey = execFileSync("wg", ["show", env.WIREGUARD_INTERFACE, "public-key"], { encoding: "utf-8" }).trim();
  } catch {
    serverPublicKey = "";
  }
  if (!serverPublicKey) serverPublicKey = env.WIREGUARD_SERVER_PUBLIC_KEY;
  const serverHost = env.WIREGUARD_SERVER_ENDPOINT
    ? env.WIREGUARD_SERVER_ENDPOINT.includes(":") ? env.WIREGUARD_SERVER_ENDPOINT.split(":")[0]! : env.WIREGUARD_SERVER_ENDPOINT
    : await platformPublicAddress();
  return { serverPublicKey, serverHost, serverPort: env.WIREGUARD_LISTEN_PORT || 51820 };
}

/** What a router needs to rebuild its end of the VPN, when the VPN is on and it has an address. */
async function routerVpnSettings(router: RouterRow): Promise<VpnPeerSettings | null> {
  if (!env.ENABLE_WIREGUARD_REMOTE_ACCESS || !router.vpnIp) return null;
  const { serverPublicKey, serverHost, serverPort } = await wireguardServer();
  if (!serverPublicKey || !serverHost) return null;
  return { serverPublicKey, endpointHost: serverHost, endpointPort: serverPort, subnet: env.WIREGUARD_SUBNET_CIDR, vpnIp: router.vpnIp };
}

/** The address routers use to reach this API: ROUTER_API_BASE_URL when set (e.g. a LAN address
 *  for testing a router next to a dev machine), otherwise the public API URL. */
function routerApiBase(): string {
  return routerFacingApiBase();
}

const provisioningScriptQuerySchema = z.object({ provisionToken: z.string().min(1) });
// A WireGuard public key is exactly 32 bytes, standard-base64 encoded: 43 characters plus one
// "=" of padding. Enforcing that shape matters because the value arrives as the raw body of an
// UNAUTHENTICATED callback and is then (a) passed as an argv element to the `wg` binary, where a
// leading "-" would be read as a flag rather than a key, and (b) persisted verbatim to
// Router.vpnPublicKey with no length bound of its own.
// The final character before the padding carries only 4 significant bits, so it is restricted
// to the base64 symbols whose index is a multiple of 4 (A E I M Q U Y c g k o s w 0 4 8).
const WIREGUARD_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const provisionCallbackParamsSchema = z.object({ token: z.string().min(1) });

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("Router management is not available at the platform level");
  return tenantId;
}

/** Never send `usernameEncrypted`/`passwordEncrypted`/`provisionTokenHash` to a client — the
 *  first two are AES-256-GCM ciphertext and the third a SHA-256 hash, harmless in isolation, but
 *  there's no reason to put any of them on the wire at all. `memoryUsedBytes`/`memoryTotalBytes`
 *  are Prisma `BigInt`s (a real device's health check can report a memory size past Postgres's
 *  32-bit Int range) — native `JSON.stringify` has no BigInt support at all, so this was a
 *  latent 500 waiting for the first router that ever actually connected and reported real
 *  memory stats. Converting to `Number` here is safe: even a device with gigabytes of RAM stays
 *  many orders of magnitude under Number.MAX_SAFE_INTEGER measured in bytes. */
function computeLiveRouterStatus(
  status: "UNKNOWN" | "ONLINE" | "WARNING" | "DOWN",
  lastSeenAt: Date | string | null,
  size: { memoryTotalBytes?: bigint | number | null; boardName?: string | null } = {}
): "UNKNOWN" | "ONLINE" | "WARNING" | "DOWN" {
  if (status === "UNKNOWN" || !lastSeenAt) {
    return "UNKNOWN";
  }
  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (isNaN(lastSeenMs)) return status;

  const elapsedMs = Date.now() - lastSeenMs;
  // The router checks in every minute, or every 5 on a small router (heartbeat-interval.ts).
  // 1. Within 2.5 intervals = healthy ONLINE.
  if (elapsedMs <= heartbeatOnlineWindowMs(size)) {
    return "ONLINE";
  }
  // 2. Up to 4 intervals = WARNING (delayed / lagging heartbeat).
  if (elapsedMs <= heartbeatLateWindowMs(size)) {
    return "WARNING";
  }
  // 3. Longer without a single heartbeat = the router is OFF / DOWN.
  return "DOWN";
}

function toRouterSummary(router: RouterRow) {
  const { usernameEncrypted: _u, passwordEncrypted: _p, provisionTokenHash: _t, previousProvisionTokenHash: _pt, vpnRegisterTokenHash: _vt, ...summary } = router;
  const effectiveStatus = computeLiveRouterStatus(summary.status, summary.lastSeenAt, summary);

  // Auto-sync database row if a router has silently died / been powered off
  if (summary.status === "ONLINE" && effectiveStatus !== "ONLINE") {
    prisma.router.update({
      where: { id: router.id },
      data: {
        status: effectiveStatus,
        lastError: "Router stopped sending heartbeats (device is offline or powered off)",
      },
    }).catch(() => {});
  }

  return {
    ...summary,
    status: effectiveStatus,
    memoryUsedBytes: summary.memoryUsedBytes === null ? null : Number(summary.memoryUsedBytes),
    memoryTotalBytes: summary.memoryTotalBytes === null ? null : Number(summary.memoryTotalBytes),
    // What the router's own hotspot check found wrong, in plain words (empty = all fine).
    hotspotProblems: hotspotProblems(summary.hotspotCheck as HotspotCheck | null),
    diskFreeBytes: summary.diskFreeBytes === null ? null : Number(summary.diskFreeBytes),
    diskTotalBytes: summary.diskTotalBytes === null ? null : Number(summary.diskTotalBytes),
  };
}

const MAX_REPORTED_ACCESS_POINTS = 200;
const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);

/** Parses a router's "iface;mac;identity;ip;board|…" report. Bounded, since it comes off the wire. */
export function parseAccessPointReport(raw: string): ConnectedAccessPoint[] {
  const aps: ConnectedAccessPoint[] = [];
  for (const rec of raw.slice(0, 64_000).split("|")) {
    if (aps.length >= MAX_REPORTED_ACCESS_POINTS) break;
    const parts = rec.split(";").map((p) => p.trim());
    const mac = parts[1];
    if (!mac || !/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(mac)) continue;
    const ip = parts[3];
    aps.push({
      identity: clip(parts[2], 64) || "Access Point",
      macAddress: mac.toUpperCase(),
      interface: clip(parts[0], 32) || "ether2",
      ipAddress: ip && ip !== "0.0.0.0" && ip !== "none" ? clip(ip, 45) : undefined,
      board: clip(parts[4], 64),
      detectionSource: "NEIGHBOR",
    });
  }
  return aps;
}

/** The one line an ISP pastes into the router's terminal. It checks in as soon as the download
 *  works, so a router that reached us always shows up on the dashboard, whatever happens in the
 *  setup after it. The import runs as a background job (:execute) — see the provisioning-script
 *  route — with its output in mkg-setup.txt on the router. */
function setupFetchCommand(provisionToken: string): string {
  const provisionBase = `${routerApiBase()}/api/v1/routers/provision/${provisionToken}`;
  return `/tool fetch url="${provisionBase}/setup.rsc" dst-path=setup.rsc; :do {/tool fetch url="${provisionBase}/callback" http-method=post keep-result=no} on-error={}; :delay 2s; :execute script="/import setup.rsc" file=mkg-setup.txt; :put "Setup is running on the router. It shows Online in MashupHost within a minute."`;
}

export async function routerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    if (request.url.includes("push-aps") && !request.headers["content-type"]) {
      request.headers["content-type"] = "text/plain";
    }
  });

  app.addContentTypeParser(
    ["application/x-www-form-urlencoded", "text/plain", "application/octet-stream", "*"],
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, typeof body === "string" ? body : "");
    }
  );

  app.get(
    "/",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const routers = await listRouters(tenantId);
      reply.send(successResponse(routers.map(toRouterSummary), request.id));
    }
  );

  app.post(
    "/",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = createRouterSchema.parse(request.body);
      await assertWithinPlanLimit(tenantId, "routers");
      const router = await createRouter(tenantId, body);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.created",
        resourceType: "Router",
        resourceId: router.id,
        after: toRouterSummary(router),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(201).send(successResponse(toRouterSummary(router), request.id));
    }
  );

  /** Script-first linking: creates a router with generated credentials and no known address —
   *  the admin only ever names it. Pair with GET /:routerId/provisioning-script and the public
   *  POST /provision/:token/callback below. */
  app.post(
    "/pending",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = createPendingRouterSchema.parse(request.body);
      await assertWithinPlanLimit(tenantId, "routers");
      const { router, provisionToken } = await createPendingRouter(tenantId, body.name, {
        pppoeInterface: body.pppoeInterface,
        pppoeGatewayIp: body.pppoeGatewayIp,
        pppoePoolRange: body.pppoePoolRange,
        blockTethering: body.blockTethering,
        hotspotPorts: body.hotspotPorts,
        lanPort: body.lanPort,
        routerOsMajor: body.routerOsMajor,
      });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.pending_created",
        resourceType: "Router",
        resourceId: router.id,
        after: toRouterSummary(router),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      // The only point in this router's lifetime the raw provisioning token is available — from
      // here on only its hash is stored, same one-time-reveal pattern as an API key.
      reply.status(201).send(successResponse({ ...toRouterSummary(router), provisionToken }, request.id));
    }
  );

  /** Reveals the ready-to-paste RouterOS script for a pending router — sensitive (it carries the
   *  router's generated API password and provisioning token), so it's audit-logged the same way
   *  the RADIUS setup script and password reveals are. */
  app.get(
    "/:routerId/provisioning-script",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const router = await getRouterOrThrow(tenantId, routerId);
      if (!router.provisionTokenHash) {
        throw new ConflictError(
          `"${router.name}" was linked manually and has no provisioning script — remove and re-add it to use the script-first flow.`
        );
      }

      const { provisionToken } = provisioningScriptQuerySchema.parse(request.query);
      const managementSource = env.ROUTER_MANAGEMENT_SOURCE || (await platformPublicAddress());
      const vpnIp = await ensureRouterVpnIp(router.id);

      const { serverPublicKey, serverHost } = await wireguardServer();

      const credentials = await getGeneratedCredentials(tenantId, routerId);
      const callbackUrl = `${routerApiBase()}/api/v1/routers/provision/${provisionToken}/callback`;
      // No "demo-isp" fallback: the slug decides which tenant's captive portal this router
      // sends its customers to, so guessing it would quietly provision a router to serve
      // ANOTHER tenant's branding, packages and payment accounts. Failing loudly is the only
      // safe behaviour when we cannot tell whose router this is.
      const tenantSlug = request.tenantCtx?.slug;
      if (!tenantSlug) {
        throw new ConflictError("Could not determine this tenant's portal address — reload the dashboard and try again.");
      }
      const loginTemplateUrl = `${routerApiBase()}/api/v1/hotspot/${tenantSlug}/mikrotik-login-template`;

      const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
        radiusHost: await routerRadiusHost(),
        managementSource,
        vpnSubnet: env.WIREGUARD_SUBNET_CIDR,
        serverPublicKey,
        serverHost,
        serverPort: env.WIREGUARD_LISTEN_PORT || 51820,
        vpnIp,
        loginTemplateUrl,
        portalHost: env.APP_PORTAL_URL ? new URL(env.APP_PORTAL_URL).hostname : "captive.mashuphost.tech",
        portalDomains: await getTenantPortalDomains(tenantId),
        extraWalledGardenHosts: await listWalledGardenHostsFor(tenantId),
        cardGateways: await tenantCardGateways(tenantId),
        pppoeInterface: router.pppoeInterface,
        pppoeGatewayIp: router.pppoeGatewayIp,
        pppoePoolRange: router.pppoePoolRange,
        blockTethering: router.blockTethering,
        hotspotPorts: router.hotspotPorts,
        lanPort: router.lanPort,
        routerOsMajor: router.routerOsMajor,
        appFilter: await tenantSellsAppPackages(tenantId),
      });

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.provisioning_script_revealed",
        resourceType: "Router",
        resourceId: router.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      // The import runs as a background job (:execute), not in the operator's terminal: the script
      // reconfigures Wi-Fi, the bridge and management access, which drops a WinBox session made
      // through them — and an /import run inside that session dies with it, half-applied. Its
      // output goes to mkg-setup.txt on the router for troubleshooting.
      const fetchCommand = setupFetchCommand(provisionToken);
      reply.send(successResponse({ script, fetchCommand, oneLiner: fetchCommand }, request.id));
    }
  );

  /** A fresh setup command for a router that already exists — to re-run setup after an update,
   *  or on a router reset to factory settings. The original can't be shown again (only its hash is
   *  kept); the router's current token keeps working until it runs the new one. */
  app.post(
    "/:routerId/setup-command",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const provisionToken = await issueSetupCommand(tenantId, routerId);
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.setup_command_issued",
        resourceType: "Router",
        resourceId: routerId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.send(successResponse({ fetchCommand: setupFetchCommand(provisionToken) }, request.id));
    }
  );

  app.get(
    "/social-firewall-script",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const script = buildSocialFirewallOnlyScript({ portalHosts: appFilterPortalHosts() });
      reply.send(successResponse({ script }, request.id));
    }
  );

  app.get(
    "/:routerId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const router = await getRouterOrThrow(tenantId, routerId);
      reply.send(successResponse(toRouterSummary(router), request.id));
    }
  );

  app.patch(
    "/:routerId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const body = updateRouterSchema.parse(request.body);
      const before = await getRouterOrThrow(tenantId, routerId);
      const after = await updateRouter(tenantId, routerId, body);
      // A changed anti-tethering switch is applied on the router now, not at the next 10-minute
      // self-repair — in the background, so an unreachable router doesn't hold up the save.
      if (body.blockTethering !== undefined && body.blockTethering !== before.blockTethering && after.host) {
        void reconcileRouterProvisioning(routerId, { force: true }).catch((err) =>
          request.log.warn({ err, routerId }, "could not apply the anti-tethering change on the router now; the next self-repair will")
        );
      }

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.updated",
        resourceType: "Router",
        resourceId: routerId,
        before: toRouterSummary(before),
        after: toRouterSummary(after),
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(toRouterSummary(after), request.id));
    }
  );

  app.delete(
    "/:routerId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      await getRouterOrThrow(tenantId, routerId);
      await deleteRouter(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.deleted",
        resourceType: "Router",
        resourceId: routerId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ deleted: true }, request.id));
    }
  );

  app.post(
    "/:routerId/test-connection",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const health = await testRouterConnection(tenantId, routerId);
      // Same BigInt-can't-JSON.stringify issue as toRouterSummary above — DeviceHealth carries
      // the same raw bigint fields straight from the adapter, not just the persisted Router row.
      reply.send(
        successResponse(
          {
            ...health,
            memoryUsedBytes: health.memoryUsedBytes === undefined ? undefined : Number(health.memoryUsedBytes),
            memoryTotalBytes: health.memoryTotalBytes === undefined ? undefined : Number(health.memoryTotalBytes),
          },
          request.id
        )
      );
    }
  );


  /** Step 1: issues a fresh registration token and hands back the paste-and-run script that
   *  makes the router generate its own keypair and call home with the public half. */
  app.post(
    "/:routerId/vpn-start",
    {
      config: { audience: "staff" },
      preHandler: [...preHandler, requirePermission("routers.manage")],
    },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const { router, vpnRegisterToken } = await startVpnRegistration(tenantId, routerId);

      const callbackUrl = `${routerApiBase()}/api/v1/routers/vpn/${vpnRegisterToken}/register-peer`;
      const script = buildMikrotikVpnStartScript(router, callbackUrl, env.WIREGUARD_LISTEN_PORT);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.vpn_start_script_revealed",
        resourceType: "Router",
        resourceId: router.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ script }, request.id));
    }
  );

  /** Step 2: only buildable once the router has actually called back with its public key (see
   *  the public callback below) — the assigned tunnel IP it needs doesn't exist before that. */
  app.get(
    "/:routerId/vpn-complete-script",
    {
      config: { audience: "staff" },
      preHandler: [...preHandler, requirePermission("routers.manage")],
    },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const router = await getRouterOrThrow(tenantId, routerId);
      if (!router.vpnIp) {
        throw new ConflictError(
          `"${router.name}" hasn't checked back in with a WireGuard key yet — run the step-1 script first.`
        );
      }

      let serverPublicKey = env.WIREGUARD_SERVER_PUBLIC_KEY;
      if (!serverPublicKey) {
        try {
          const { execFileSync } = await import("node:child_process");
          serverPublicKey = execFileSync("wg", ["show", env.WIREGUARD_INTERFACE, "public-key"], {
            encoding: "utf-8",
          }).trim();
        } catch {
          serverPublicKey = "";
        }
      }

      const script = buildMikrotikVpnCompleteScript({
        serverPublicKey,
        serverEndpoint: env.WIREGUARD_SERVER_ENDPOINT || `${await platformPublicAddress()}:${env.WIREGUARD_LISTEN_PORT || 51820}`,
        serverListenPort: env.WIREGUARD_LISTEN_PORT,
        assignedVpnIp: router.vpnIp,
        tunnelSubnetCidr: env.WIREGUARD_SUBNET_CIDR,
      });

      reply.send(successResponse({ script }, request.id));
    }
  );

  app.get(
    "/:routerId/winbox-access",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const router = await getRouterOrThrow(tenantId, routerId);

      const script = buildMikrotikWinboxScript(router.name, {
        managementSource: env.ROUTER_MANAGEMENT_SOURCE || (await platformPublicAddress()),
        vpnSubnet: env.WIREGUARD_SUBNET_CIDR,
        apiPort: router.apiPort,
        useTls: router.useTls,
      });
      const cloudHost = await platformPublicAddress();
      const relayHost =
        (await winboxRelayHost({
          override: env.WINBOX_RELAY_PUBLIC_HOST,
          apiUrl: env.APP_API_PUBLIC_URL,
          fallback: (env.WIREGUARD_SERVER_ENDPOINT || cloudHost).split(":")[0] || cloudHost,
        })) || null;
      reply.send(
        successResponse(
          {
            routerId: router.id,
            routerName: router.name,
            host: router.host,
            vpnIp: router.vpnIp,
            winboxPort: 8291,
            status: router.status,
            script,
            connectionTargets: {
              direct: router.host ? `${router.host}:8291` : null,
              vpn: router.vpnIp ? `${router.vpnIp}:8291` : null,
              cloudHost,
            },
            // Remote WinBox through this server (see packages/network winbox-relay.service.ts).
            relay: {
              enabled: env.ENABLE_WINBOX_RELAY,
              // Only once the router has registered its tunnel: a reserved vpnIp alone is not a tunnel.
              vpnConnected: Boolean(router.vpnConfiguredAt && router.vpnPublicKey),
              address: env.ENABLE_WINBOX_RELAY && router.winboxRelayPort && relayHost ? `${relayHost}:${router.winboxRelayPort}` : null,
            },
          },
          request.id
        )
      );
    }
  );

  app.get(
    "/:routerId/sessions",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const sessions = await getRouterActiveSessions(tenantId, routerId);
      reply.send(successResponse(sessions, request.id));
    }
  );

  app.get(
    "/:routerId/access-points",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const accessPoints = await getRouterConnectedAccessPoints(tenantId, routerId);
      reply.send(successResponse(accessPoints, request.id));
    }
  );

  // Outbound push from a router: its access-point discovery report, sent with /tool fetch so it
  // works behind locked modems and CGNAT. Keyed by the router's own provisioning token, the same
  // secret its heartbeat proves, so a caller can only ever write its own router's list.
  app.all("/provision/:token/push-aps", { config: { audience: "system-critical" } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const router = await findRouterByProvisionToken(token);
    if (!router) throw new NotFoundError("Router");

    const query = (request.query as Record<string, string>) || {};
    let raw = typeof request.body === "string" ? request.body : "";
    if (!raw && typeof query.data === "string") raw = query.data;
    const aps = parseAccessPointReport(raw);
    if (aps.length > 0) recordRouterReportedAccessPoints(router.id, aps, router.tenantId);
    reply.status(200).send({ success: true, count: aps.length });
  });

  // The old unauthenticated form. It trusted any router id, then the caller's IP, then fell back
  // to whichever router of ANY tenant was seen last, so anyone could overwrite another ISP's
  // access-point list. Nothing generated today calls it.
  const gonePushAps = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(410).send({ success: false, error: { code: "GONE", message: "Re-run the router setup script." } });
  };
  app.all("/:routerId/push-aps", { config: { audience: "system-critical" } }, gonePushAps);
  app.all("/push-aps", { config: { audience: "system-critical" } }, gonePushAps);

  /** Bulk maintenance/incident-response action, not a routine one — requires the same
   *  `routers.manage` permission as deleting a router, not just `routers.read`. */
  app.post(
    "/:routerId/kick-all-sessions",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const router = await getRouterOrThrow(tenantId, routerId);
      const removed = await disconnectAllRouterSessions(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.all_sessions_kicked",
        resourceType: "Router",
        resourceId: router.id,
        after: { removed },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ removed }, request.id));
    }
  );

  app.post(
    "/:routerId/apply-speedtest-boost",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await applyRouterSpeedtestBoost(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.speedtest_boost_applied",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

  app.post(
    "/:routerId/enforce-strict-timeout",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await enforceRouterStrictTimeout(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.strict_timeout_enforced",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

  // "Block tunnelling apps": /enable-anti-vpn-shield turns it on, /disable-anti-vpn-shield off.
  for (const [path, enabled] of [["enable-anti-vpn-shield", true], ["disable-anti-vpn-shield", false]] as const) {
  app.post(
    `/:routerId/${path}`,
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await startRouterAntiTunnelShield(tenantId, routerId, enabled);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: enabled ? "router.anti_vpn_shield_enabled" : "router.anti_vpn_shield_disabled",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );
  }

  // Where the router is with tunnel blocking; the dashboard polls this after turning it on or off.
  app.get(
    "/:routerId/anti-vpn-shield/status",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      reply.send(successResponse(await getRouterAntiTunnelStatus(tenantId, routerId), request.id));
    }
  );

  app.post(
    "/:routerId/enable-pcq-shaper",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await enableRouterPcqFairQueue(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.pcq_shaper_enabled",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

  app.post(
    "/:routerId/apply-family-dns",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const body = z.object({ familyMode: z.boolean().optional().default(true) }).parse(request.body ?? {});
      const result = await enableRouterSafeFamilyDns(tenantId, routerId, body.familyMode);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.family_dns_applied",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

  app.get(
    "/:routerId/firmware",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await checkRouterFirmwareUpdate(tenantId, routerId);
      reply.send(successResponse(result, request.id));
    }
  );

  app.post(
    "/:routerId/upgrade-firmware",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = idParamsSchema.parse(request.params);
      const result = await installRouterFirmwareUpdate(tenantId, routerId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "router.firmware_upgrade_initiated",
        resourceType: "Router",
        resourceId: routerId,
        after: result,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(result, request.id));
    }
  );

function getClientIp(request: { headers: Record<string, string | string[] | undefined>; ip: string }): string {
  const cfIp = request.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  const xRealIp = request.headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }
  const xForwardedFor = request.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim().length > 0) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

  // No per-address rate limit on the three /provision routes below: the token is the auth, and a
  // router shares its public address with every phone and PC behind the same NAT, so their
  // traffic could otherwise use up the limit and drop its heartbeat (router shows Offline).
  // --- Public callback (the router itself, via /tool fetch in the provisioning script) —
  // audience "system-critical" bypasses maintenance mode (a router mid-provisioning shouldn't
  // silently fail to link just because maintenance mode is on) and carries no staff auth, since
  // RouterOS cannot send our bearer tokens. The provisioning token in the URL *is* the auth: it
  // was generated per-router and is only ever known to whoever pasted the script. -------------
  /**
   * 1-Line Remote Provisioning Fetcher:
   * /tool fetch url="https://api.mashuphost.tech/api/v1/routers/provision/<token>/setup.rsc" dst-path=setup.rsc; :delay 2s; /import setup.rsc;
   * Serves the generated .rsc script dynamically to the MikroTik router.
   */
  app.get("/provision/:token/setup.rsc", { config: { audience: "system-critical", rateLimit: false } }, async (request, reply) => {
    const { token } = provisionCallbackParamsSchema.parse(request.params);
    const found = await findRouterByProvisionToken(token);
    const router = found ? await prisma.router.findUnique({ where: { id: found.id }, include: { tenant: true } }) : null;
    if (!router) {
      reply.status(404).header("Content-Type", "text/plain").send("# Error: Invalid or expired provisioning token\n");
      return;
    }

    const managementSource = env.ROUTER_MANAGEMENT_SOURCE || (await platformPublicAddress());
    const vpnIp = await ensureRouterVpnIp(router.id);

    let serverPublicKey = env.WIREGUARD_SERVER_PUBLIC_KEY;
    if (!serverPublicKey) {
      try {
        const { execFileSync } = await import("node:child_process");
        serverPublicKey = execFileSync("wg", ["show", env.WIREGUARD_INTERFACE, "public-key"], {
          encoding: "utf-8",
        }).trim();
      } catch {
        serverPublicKey = "";
      }
    }

    const serverHost = env.WIREGUARD_SERVER_ENDPOINT
      ? (env.WIREGUARD_SERVER_ENDPOINT.includes(":") ? env.WIREGUARD_SERVER_ENDPOINT.split(":")[0] : env.WIREGUARD_SERVER_ENDPOINT)
      : await platformPublicAddress();

    const credentials = await getGeneratedCredentials(router.tenantId, router.id);
    const callbackUrl = `${routerApiBase()}/api/v1/routers/provision/${token}/callback`;
    // Same reasoning as the provisioning-script route above — never guess the tenant.
    const tenantSlug = router.tenant?.slug;
    if (!tenantSlug) {
      reply.status(500).header("Content-Type", "text/plain").send("# Error: router is not linked to a tenant\n");
      return;
    }
    const loginTemplateUrl = `${routerApiBase()}/api/v1/hotspot/${tenantSlug}/mikrotik-login-template`;

    const script = buildMikrotikProvisioningScript(router, credentials, callbackUrl, {
      radiusHost: await routerRadiusHost(),
      managementSource,
      vpnSubnet: env.WIREGUARD_SUBNET_CIDR,
      serverPublicKey,
      serverHost,
      serverPort: env.WIREGUARD_LISTEN_PORT || 51820,
      vpnIp,
      loginTemplateUrl,
      portalHost: env.APP_PORTAL_URL ? new URL(env.APP_PORTAL_URL).hostname : "captive.mashuphost.tech",
      portalDomains: await getTenantPortalDomains(router.tenantId),
      extraWalledGardenHosts: await listWalledGardenHostsFor(router.tenantId),
      cardGateways: await tenantCardGateways(router.tenantId),
      pppoeInterface: router.pppoeInterface,
      pppoeGatewayIp: router.pppoeGatewayIp,
      pppoePoolRange: router.pppoePoolRange,
      blockTethering: router.blockTethering,
      hotspotPorts: router.hotspotPorts,
      lanPort: router.lanPort,
      routerOsMajor: router.routerOsMajor,
      appFilter: await tenantSellsAppPackages(router.tenantId),
    });

    reply.header("Content-Type", "text/plain; charset=utf-8").send(script);
  });

  app.get("/provision/:token/callback", { config: { audience: "system-critical", rateLimit: false } }, async (request, reply) => {
    const remoteIp = getClientIp(request);
    reply.status(200).send({
      success: true,
      message: "Provisioning callback is online and active.",
      clientIp: remoteIp,
    });
  });

  /** The script the router's mkg-heartbeat scheduler fetches into memory and runs once a minute:
   *  it reads the router's CPU, memory, disk, temperature, uptime and users and posts them to the
   *  callback below. Served fresh, so an improvement reaches every router without a re-run of
   *  setup. The token is the auth, as for setup.rsc. */
  app.get("/provision/:token/heartbeat.rsc", { config: { audience: "system-critical", rateLimit: false } }, async (request, reply) => {
    const { token } = provisionCallbackParamsSchema.parse(request.params);
    const router = await findRouterByProvisionToken(token);
    if (!router) {
      reply.status(404).header("Content-Type", "text/plain").send("# Unknown provisioning token\n");
      return;
    }
    const callbackUrl = `${routerApiBase()}/api/v1/routers/provision/${token}/callback`;
    // The ISP's own sign-in page, which the report puts back if the router ever loses it.
    const tenant = await prisma.tenant.findUnique({ where: { id: router.tenantId }, select: { slug: true, name: true } });
    const tenantSlug = tenant?.slug;
    const loginTemplateUrl = tenantSlug
      ? `${routerApiBase()}/api/v1/hotspot/${tenantSlug}/mikrotik-login-template`
      : undefined;
    // RouterOS 6's fetch returns at most 4 KB, too little for the hotspot self-check as well.
    const isV6 = Boolean(router.routerOsVersion?.startsWith("6"));
    reply.header("Content-Type", "text/plain; charset=utf-8").send(
      buildHeartbeatScript(callbackUrl, loginTemplateUrl, {
        hotspotCheck: !isV6,
        walledGarden: isV6 ? [] : await tenantWalledGarden(router.tenantId),
        // Every 5 minutes on a small router (hAP lite and the like), every minute otherwise.
        checkInEvery: heartbeatIntervalRouterOs(router),
        vpn: isV6 ? null : await routerVpnSettings(router),
        // RADIUS goes to this server's own address, put back if the router has another.
        radiusHost: await routerRadiusHost(),
        // The router compares its pages with these sizes: no need to read the files.
        pageSizes: tenant ? portalPageSizes(tenant.slug, tenant.name) : undefined,
      })
    );
  });

  app.post("/provision/:token/callback", { config: { audience: "system-critical", rateLimit: false } }, async (request, reply) => {
    const { token } = provisionCallbackParamsSchema.parse(request.params);
    const remoteIp = getClientIp(request);
    const query = (request.query as Record<string, unknown>) || {};
    const rawBody = typeof request.body === "string" ? request.body : "";
    // The body is either the router's once-a-minute report (see buildHeartbeatScript) or, from
    // the setup script's VPN step, its WireGuard public key. Older routers put figures in the query.
    const isReport = isHeartbeatReport(rawBody);
    let wgpubkey = isReport ? "" : rawBody;
    if (!wgpubkey && typeof query === "object" && "wgpubkey" in query) {
      wgpubkey = String(query.wgpubkey || "");
    }
    wgpubkey = wgpubkey.replace(/["'\r\n]/g, "").trim().replace(/ /g, "+");
    const metrics = parseHeartbeatReport(isReport ? rawBody : "", query);

    try {
      const router = await completeRouterProvisioning(token, remoteIp, wgpubkey || undefined, metrics);
      await writeAuditLog({
        tenantId: router.tenantId,
        action: "router.provisioned_via_callback",
        resourceType: "Router",
        resourceId: router.id,
        after: { host: router.host, vpnIp: router.vpnIp },
        ipAddress: remoteIp,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.status(200).send({ linked: true, host: router.host, vpnIp: router.vpnIp });
    } catch (err) {
      if (err instanceof NotFoundError) {
        reply.status(404).send({ linked: false, error: "Unknown or already-superseded provisioning token" });
        return;
      }
      throw err;
    }
  });

  /** Public callback for VPN step 1 — the router's own public key arrives as the raw POST body
   *  (see the content-type parser above and buildMikrotikVpnStartScript's doc comment for why),
   *  not a query parameter. A registration failure (e.g. `wg` unavailable on this deployment)
   *  surfaces as a real error in the response body rather than a silent 200, since — unlike the
   *  provisioning callback, where "money already moved" reasoning applies to M-Pesa but not
   *  here — there's no harm in the router's own log showing the fetch actually failed. */
  app.get("/vpn/:token/register-peer", { config: { audience: "system-critical" } }, async (request, reply) => {
    const { token } = provisionCallbackParamsSchema.parse(request.params);
    const pubkey = (request.query as Record<string, string | undefined>)?.pubkey || "";
    if (!pubkey) {
      reply.status(200).send({
        success: true,
        message: "VPN register-peer endpoint is online. Provide public key via POST body or ?pubkey=",
      });
      return;
    }
    const cleanKey = pubkey.replace(/["'\r\n]/g, "").trim().replace(/ /g, "+");
    try {
      const router = await completeVpnRegistration(token, cleanKey);
      reply.status(200).send({ registered: true, vpnIp: router.vpnIp });
    } catch (err) {
      if (err instanceof NotFoundError) {
        reply.status(404).send({ registered: false, error: "Unknown or already-superseded VPN registration token" });
        return;
      }
      throw err;
    }
  });

  app.post("/vpn/:token/register-peer", { config: { audience: "system-critical" } }, async (request, reply) => {
    const { token } = provisionCallbackParamsSchema.parse(request.params);
    let publicKey = typeof request.body === "string" ? request.body : "";
    if (!publicKey && typeof request.query === "object" && request.query && "pubkey" in request.query) {
      publicKey = String((request.query as Record<string, unknown>).pubkey || "");
    }
    publicKey = publicKey.replace(/["'\r\n]/g, "").trim().replace(/ /g, "+");
    if (!publicKey) {
      reply.status(400).send({ registered: false, error: "Missing WireGuard public key in request body or query" });
      return;
    }

    try {
      const router = await completeVpnRegistration(token, publicKey);
      await writeAuditLog({
        tenantId: router.tenantId,
        action: "router.vpn_peer_registered",
        resourceType: "Router",
        resourceId: router.id,
        after: { vpnIp: router.vpnIp },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.status(200).send({ registered: true, vpnIp: router.vpnIp });
    } catch (err) {
      if (err instanceof NotFoundError) {
        reply.status(404).send({ registered: false, error: "Unknown or already-superseded VPN registration token" });
        return;
      }
      throw err;
    }
  });
}

/** Whether this ISP sells per-app packages (TikTok only, …). Only then does setup install the app
 *  filter, which routes every customer's DNS through the router: a small router (hAP lite) is
 *  spared that load when nobody needs it. */
async function tenantSellsAppPackages(tenantId: string): Promise<boolean> {
  const where = { tenantId, appPolicy: { notIn: ["ALL", ""] } };
  const [packages, vouchers] = await Promise.all([
    prisma.hotspotPackage.count({ where: { ...where, isActive: true } }),
    prisma.hotspotVoucher.count({ where }),
  ]);
  return packages + vouchers > 0;
}
