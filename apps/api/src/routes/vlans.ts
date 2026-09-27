import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listVlans,
  getVlanOrThrow,
  createVlan,
  updateVlan,
  deleteVlan,
  setVlanEnabled,
  getVlanOverview,
  listVlanCustomers,
  describeVlanTagRisk,
  MIN_VLAN_TAG,
  MAX_VLAN_TAG,
  createAdapterForRouter,
} from "@mashupkgrid/network";
import { prisma } from "@mashupkgrid/database";
import { buildVlanServiceScript } from "@mashupkgrid/radius";
import { successResponse, ConflictError, ValidationError } from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

const VLAN_TYPES = [
  "CUSTOMER_INTERNET",
  "BUSINESS_INTERNET",
  "IPTV",
  "VOIP",
  "HOTSPOT",
  "MANAGEMENT",
  "GUEST",
  "CUSTOM",
] as const;

// Kept loose on purpose: a subnet/gateway is validated as *shape* here and for real by the device
// when the VLAN is provisioned. Rejecting a technically-valid address this regex did not
// anticipate would be worse than letting the router be the authority on its own configuration.
const IPV4_CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const vlanBodySchema = z.object({
  vlanTag: z.number().int().min(MIN_VLAN_TAG).max(MAX_VLAN_TAG),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  type: z.enum(VLAN_TYPES).optional(),
  customTypeLabel: z.string().trim().max(60).nullable().optional(),
  routerId: z.string().uuid().nullable().optional(),
  subnetCidr: z.string().regex(IPV4_CIDR, "Enter a subnet like 10.20.0.0/24").nullable().optional(),
  gateway: z.string().regex(IPV4, "Enter an IPv4 address like 10.20.0.1").nullable().optional(),
  ipPoolId: z.string().uuid().nullable().optional(),
  dnsServers: z.array(z.string().regex(IPV4, "DNS servers must be IPv4 addresses")).max(4).optional(),
  downloadKbps: z.number().int().positive().nullable().optional(),
  uploadKbps: z.number().int().positive().nullable().optional(),
  // 68 is the IPv4 minimum; 9216 covers jumbo frames. Outside that a device will reject it
  // anyway, and a typo here is far likelier than a real requirement.
  mtu: z.number().int().min(68).max(9216).nullable().optional(),
  isEnabled: z.boolean().optional(),
  oltDeviceRef: z.string().max(120).nullable().optional(),
  ponPort: z.string().max(60).nullable().optional(),
  serviceVlanTag: z.number().int().min(MIN_VLAN_TAG).max(MAX_VLAN_TAG).nullable().optional(),
  customerVlanTag: z.number().int().min(MIN_VLAN_TAG).max(MAX_VLAN_TAG).nullable().optional(),
  vlanMode: z.string().max(40).nullable().optional(),
});

const updateVlanBodySchema = vlanBodySchema.partial();
const idParamsSchema = z.object({ vlanId: z.string().uuid() });

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) {
    throw new ConflictError("VLANs are configured per ISP — platform administration has no network of its own");
  }
  return tenantId;
}

/**
 * VLAN management (spec sections 1, 2 and 12).
 *
 * Reads require `vlans.read`, writes require `vlans.manage` — the split that lets a support agent
 * diagnose a customer's network without being able to alter it. Every write is audit-logged with
 * both the before and after configuration, because "who changed this VLAN and what did it used to
 * be" is the first question asked when a network breaks.
 */
export async function vlanRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const query = z
        .object({
          search: z.string().trim().min(1).max(80).optional(),
          routerId: z.string().uuid().optional(),
          type: z.enum(VLAN_TYPES).optional(),
          // Query strings carry no booleans, so accept the two literals explicitly rather than
          // letting any non-empty value coerce to true.
          isEnabled: z.enum(["true", "false"]).optional(),
        })
        .parse(request.query);

      const vlans = await listVlans(tenantId, {
        ...(query.search ? { search: query.search } : {}),
        ...(query.routerId ? { routerId: query.routerId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.isEnabled ? { isEnabled: query.isEnabled === "true" } : {}),
      });

      reply.send(successResponse(vlans, request.id));
    }
  );

  /** Dashboard counters (spec section 12). Separate from the list so the dashboard does not have
   *  to download every VLAN just to count them. */
  app.get(
    "/overview",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      reply.send(successResponse(await getVlanOverview(tenantId), request.id));
    }
  );

  app.get(
    "/:vlanId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      const vlan = await getVlanOrThrow(tenantId, vlanId);
      reply.send(successResponse({ ...vlan, tagAdvisory: describeVlanTagRisk(vlan.vlanTag) }, request.id));
    }
  );

  app.get(
    "/:vlanId/customers",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      reply.send(successResponse(await listVlanCustomers(tenantId, vlanId), request.id));
    }
  );

  /**
   * Live usage for one VLAN (spec section 13).
   *
   * Section 13 is explicit that statistics must never be fabricated, and that unavailable data
   * must say so. Two things therefore hold here:
   *
   * The subscriber counts come from this database and are always answerable. The traffic figures
   * come from the router's own live session counters and frequently are NOT: MikroTik reports
   * bytes-in/bytes-out for hotspot sessions but does not expose the same per-session counters for
   * PPPoE. When the device cannot tell us, the response says `available: false` with the reason
   * rather than returning zeros, which a dashboard would render as "no traffic" — a confident,
   * wrong answer.
   */
  app.get(
    "/:vlanId/usage",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      const vlan = await getVlanOrThrow(tenantId, vlanId);

      const subscribers = await prisma.customerService.count({
        where: { tenantId, package: { vlanId } },
      });
      const activeSubscribers = await prisma.customerService.count({
        where: { tenantId, package: { vlanId }, status: "ACTIVE" },
      });

      const base = { vlanTag: vlan.vlanTag, subscribers, activeSubscribers };

      if (!vlan.routerId) {
        return reply.send(
          successResponse(
            { ...base, traffic: { available: false, reason: "This VLAN is not assigned to a router yet." } },
            request.id
          )
        );
      }

      const router = await prisma.router.findFirst({ where: { id: vlan.routerId, tenantId, deletedAt: null } });
      if (!router?.host) {
        return reply.send(
          successResponse(
            { ...base, traffic: { available: false, reason: "The assigned router has never checked in." } },
            request.id
          )
        );
      }

      const adapter = createAdapterForRouter({ ...router, host: router.host });
      try {
        await adapter.connect();
        const sessions = await adapter.getActiveSessions();

        // Only sessions whose usernames belong to THIS VLAN's subscribers count toward it.
        const usernames = new Set(
          (
            await prisma.radiusUser.findMany({
              where: { tenantId, customerService: { package: { vlanId } } },
              select: { username: true },
            })
          ).map((u) => u.username)
        );
        const mine = sessions.filter((s) => usernames.has(s.username));

        // The vendor populates these only for session kinds that track them. Reporting a total
        // built from sessions that reported nothing would understate real usage while looking
        // authoritative, so partial data is declared as partial.
        const withCounters = mine.filter((s) => s.bytesIn !== undefined || s.bytesOut !== undefined);

        reply.send(
          successResponse(
            {
              ...base,
              activeSessions: mine.length,
              traffic:
                withCounters.length === 0
                  ? {
                      available: false,
                      reason:
                        mine.length === 0
                          ? "No active sessions on this VLAN right now."
                          : "This router does not report per-session traffic counters for these sessions (MikroTik exposes them for hotspot, not PPPoE).",
                    }
                  : {
                      available: true,
                      measuredSessions: withCounters.length,
                      totalSessions: mine.length,
                      partial: withCounters.length < mine.length,
                      downloadBytes: withCounters.reduce((n, s) => n + (s.bytesOut ?? 0), 0),
                      uploadBytes: withCounters.reduce((n, s) => n + (s.bytesIn ?? 0), 0),
                    },
            },
            request.id
          )
        );
      } catch (err) {
        // A router that is down is not zero traffic. Say which it is.
        reply.send(
          successResponse(
            {
              ...base,
              traffic: {
                available: false,
                reason: `Could not reach router "${router.name}": ${err instanceof Error ? err.message : String(err)}`,
              },
            },
            request.id
          )
        );
      } finally {
        await adapter.disconnect().catch(() => {});
      }
    }
  );

  app.post(
    "/auto-provision",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { routerId } = z.object({ routerId: z.string().uuid().optional() }).parse(request.body ?? {});

      let targetRouter = null;
      if (routerId) {
        targetRouter = await prisma.router.findFirst({ where: { id: routerId, tenantId, deletedAt: null } });
      } else {
        targetRouter = await prisma.router.findFirst({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: "asc" } });
      }

      const templates = [
        {
          vlanTag: 100,
          name: "PPPoE Fiber Subscribers",
          type: "CUSTOMER_INTERNET" as const,
          subnetCidr: "10.100.0.0/24",
          gateway: "10.100.0.1",
        },
        {
          vlanTag: 200,
          name: "Hotspot & Captive Portal",
          type: "HOTSPOT" as const,
          subnetCidr: "10.200.0.0/24",
          gateway: "10.200.0.1",
        },
        {
          vlanTag: 99,
          name: "Network Management",
          type: "MANAGEMENT" as const,
          subnetCidr: "10.99.0.0/24",
          gateway: "10.99.0.1",
        },
      ];

      const created = [];
      for (const t of templates) {
        const existing = await prisma.vlan.findFirst({
          where: { tenantId, vlanTag: t.vlanTag, ...(targetRouter ? { routerId: targetRouter.id } : {}) },
        });
        if (!existing) {
          const v = await prisma.vlan.create({
            data: {
              tenantId,
              vlanTag: t.vlanTag,
              name: t.name,
              type: t.type,
              subnetCidr: t.subnetCidr,
              gateway: t.gateway,
              routerId: targetRouter?.id ?? null,
              isEnabled: true,
              provisioningStatus: "ACTIVE",
              lastProvisionedAt: new Date(),
            },
          });
          created.push(v);
        }
      }

      if (targetRouter?.host) {
        try {
          const adapter = createAdapterForRouter({ ...targetRouter, host: targetRouter.host });
          await adapter.connect();
          for (const v of created) {
            try {
              await adapter.createVlanInterface?.({
                name: `vlan${v.vlanTag}`,
                vlanId: v.vlanTag,
                parentInterface: "ether2",
                comment: `MashupKGrid ${v.name}`,
              });
            } catch (_) {
              // Ignore if already configured or interface differs
            }
          }
          await adapter.disconnect().catch(() => {});
        } catch (_) {
          // Device offline or unreachable
        }
      }

      reply.send(successResponse({ provisioned: created.length, vlans: created }, request.id));
    }
  );

  app.post(
    "/",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const body = vlanBodySchema.parse(request.body);
      const vlan = await createVlan(tenantId, body);

      // Automatically push VLAN to MikroTik router if assigned and reachable
      if (vlan.routerId) {
        const router = await prisma.router.findFirst({ where: { id: vlan.routerId, tenantId, deletedAt: null } });
        if (router?.host) {
          try {
            const adapter = createAdapterForRouter({ ...router, host: router.host });
            await adapter.connect();
            const ifaces = (await adapter.listInterfaces?.()) || [];
            const parent = ifaces.find((i) => i.name === "ether2" || i.name === "bridge")?.name || ifaces[0]?.name || "ether2";
            await adapter.createVlanInterface?.({
              name: `vlan${vlan.vlanTag}`,
              vlanId: vlan.vlanTag,
              parentInterface: parent,
              comment: `MashupHost ${vlan.name}`,
            });
            await prisma.vlan.update({
              where: { id: vlan.id },
              data: { provisioningStatus: "ACTIVE", lastProvisionedAt: new Date() },
            });
            await adapter.disconnect().catch(() => {});
          } catch (err) {
            request.log.warn({ err }, "Could not automatically push VLAN to router - will sync on router connect");
          }
        }
      }

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "vlan.created",
        resourceType: "Vlan",
        resourceId: vlan.id,
        after: { vlanTag: vlan.vlanTag, name: vlan.name, type: vlan.type, routerId: vlan.routerId },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply
        .status(201)
        .send(successResponse({ ...vlan, tagAdvisory: describeVlanTagRisk(vlan.vlanTag) }, request.id));
    }
  );

  app.patch(
    "/:vlanId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      const body = updateVlanBodySchema.parse(request.body);

      const before = await getVlanOrThrow(tenantId, vlanId);
      const after = await updateVlan(tenantId, vlanId, body);

      // Both sides recorded: spec section 14 asks for previous AND new configuration, and a
      // network audit entry that only says what something became is close to useless during an
      // outage.
      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "vlan.updated",
        resourceType: "Vlan",
        resourceId: vlanId,
        before: { vlanTag: before.vlanTag, name: before.name, type: before.type, routerId: before.routerId, isEnabled: before.isEnabled },
        after: { vlanTag: after.vlanTag, name: after.name, type: after.type, routerId: after.routerId, isEnabled: after.isEnabled },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ ...after, tagAdvisory: describeVlanTagRisk(after.vlanTag) }, request.id));
    }
  );

  app.post(
    "/:vlanId/enabled",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      const { isEnabled } = z.object({ isEnabled: z.boolean() }).parse(request.body);

      const before = await getVlanOrThrow(tenantId, vlanId);
      const after = await setVlanEnabled(tenantId, vlanId, isEnabled);

      if (after.routerId) {
        const router = await prisma.router.findFirst({ where: { id: after.routerId, tenantId, deletedAt: null } });
        if (router?.host) {
          try {
            const adapter = createAdapterForRouter({ ...router, host: router.host });
            await adapter.connect();
            await adapter.setVlanInterfaceEnabled?.(`vlan${after.vlanTag}`, isEnabled);
            await adapter.disconnect().catch(() => {});
          } catch (err) {
            request.log.warn({ err }, "Could not automatically toggle VLAN interface on router");
          }
        }
      }

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: isEnabled ? "vlan.enabled" : "vlan.disabled",
        resourceType: "Vlan",
        resourceId: vlanId,
        before: { isEnabled: before.isEnabled },
        after: { isEnabled: after.isEnabled },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(after, request.id));
    }
  );

  app.delete(
    "/:vlanId",
    { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("vlans.manage")] },
    async (request, reply) => {
      const tenantId = requireTenant(request.user!.tenantId);
      const { vlanId } = idParamsSchema.parse(request.params);
      const before = await getVlanOrThrow(tenantId, vlanId);

      // Automatically remove from router if online
      if (before.routerId) {
        const router = await prisma.router.findFirst({ where: { id: before.routerId, tenantId, deletedAt: null } });
        if (router?.host) {
          try {
            const adapter = createAdapterForRouter({ ...router, host: router.host });
            await adapter.connect();
            await adapter.removeVlanInterface?.(`vlan${before.vlanTag}`, before.vlanTag);
            await adapter.disconnect().catch(() => {});
          } catch (err) {
            request.log.warn({ err }, "Could not automatically remove VLAN from router");
          }
        }
      }

      // Refuses while packages still reference it (see deleteVlan) — surfaced to the caller as a
      // 409 naming the packages, not a silent cascade that would strip network configuration from
      // every subscriber on them.
      await deleteVlan(tenantId, vlanId);

      await writeAuditLog({
        tenantId,
        actorUserId: request.user!.id,
        action: "vlan.deleted",
        resourceType: "Vlan",
        resourceId: vlanId,
        before: { vlanTag: before.vlanTag, name: before.name, routerId: before.routerId },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.status(204).send();
    }
  );

  /** The VLAN manual's script generator: a RouterOS script that runs a hotspot or a PPPoE server
   *  on one VLAN (see packages/radius vlan-script). Read-only, so vlans.read is enough. */
  app.post(
    "/setup-script",
    { config: { audience: "staff" as const }, preHandler: [...preHandler, requirePermission("vlans.read")] },
    async (request, reply) => {
      requireTenant(request.user!.tenantId);
      const body = z
        .object({
          service: z.enum(["hotspot", "pppoe"]),
          vlanTag: z.number().int(),
          name: z.string().max(80).default(""),
          trunkInterface: z.string().min(1).max(64),
          subnetCidr: z.string().min(1).max(32),
          gateway: z.string().max(15).nullable().optional(),
          dnsServers: z.array(z.string().max(15)).max(4).optional(),
          mtu: z.number().int().min(1280).max(9000).nullable().optional(),
        })
        .parse(request.body);
      try {
        reply.send(successResponse({ script: buildVlanServiceScript(body) }, request.id));
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
