import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import { successResponse, NotFoundError } from "@mashupkgrid/shared";
import { heartbeatLateWindowMs } from "@mashupkgrid/network";
import { getCurrentMaintenanceState } from "../lib/maintenance-state.js";

/**
 * A public status page per ISP: are the routers up, and is anything planned. No auth, and
 * nothing sensitive: router names and sites only, never addresses or credentials. Meant to be
 * linked from an ISP's WhatsApp status or website so customers check here before calling.
 */

/** Silent this long and a site shows as down: 5 minutes, or 4 check-ins on a small router that
 *  reports every 5 minutes (heartbeat-interval.ts). */
const staleAfterMs = (router: { memoryTotalBytes: bigint | null; boardName: string | null }) =>
  Math.max(5 * 60_000, heartbeatLateWindowMs(router));

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:tenantSlug", { config: { audience: "public" } }, async (request, reply) => {
    const { tenantSlug } = z.object({ tenantSlug: z.string().min(1).max(64) }).parse(request.params);
    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug.toLowerCase(), deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, logoUrl: true, brandColor: true },
    });
    if (!tenant) throw new NotFoundError("Status page");
    const contact = await prisma.captivePortalConfig.findUnique({ where: { tenantId: tenant.id }, select: { phone: true, supportPhone: true } });

    const routers = await prisma.router.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      select: { id: true, name: true, siteName: true, status: true, lastSeenAt: true, provisionedAt: true, memoryTotalBytes: true, boardName: true },
      orderBy: [{ siteName: "asc" }, { name: "asc" }],
    });
    const now = Date.now();
    const sites = routers.map((r) => {
      const seen = r.lastSeenAt?.getTime() ?? 0;
      const online = r.status === "ONLINE" && now - seen < staleAfterMs(r);
      const never = !r.provisionedAt && !r.lastSeenAt;
      return {
        id: r.id,
        name: r.siteName ? `${r.siteName} · ${r.name}` : r.name,
        state: never ? "NOT_LINKED" : online ? "UP" : "DOWN",
        lastSeenAt: r.lastSeenAt,
      };
    });
    const up = sites.filter((s) => s.state === "UP").length;
    const down = sites.filter((s) => s.state === "DOWN").length;

    const maintenance = await getCurrentMaintenanceState();
    reply.header("cache-control", "public, max-age=60").send(
      successResponse(
        {
          isp: { name: tenant.name, logoUrl: tenant.logoUrl, brandColor: tenant.brandColor, supportPhone: contact?.supportPhone ?? contact?.phone ?? null },
          overall: down === 0 ? (up > 0 ? "OPERATIONAL" : "UNKNOWN") : up === 0 ? "MAJOR_OUTAGE" : "PARTIAL_OUTAGE",
          sites,
          maintenance: maintenance.enabled ? { message: maintenance.message ?? null, endAt: maintenance.endAt ?? null } : null,
          checkedAt: new Date(),
        },
        request.id
      )
    );
  });
}
