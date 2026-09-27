import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import { successResponse, ConflictError, NotFoundError } from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";

/** Router health history: the latest reading per router, and CPU, memory, temperature and
 *  availability over the last day or week for one router. */

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("Router health belongs to an ISP account");
  return tenantId;
}

export async function routerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const routers = await prisma.router.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: "asc" }, select: {
        id: true, name: true, status: true, siteName: true, lastSeenAt: true,
        cpuLoadPercent: true, memoryUsedBytes: true, memoryTotalBytes: true, temperatureC: true, voltageV: true,
        diskFreeBytes: true, diskTotalBytes: true, activeUsers: true, uptimeSeconds: true, routerOsVersion: true, boardName: true,
      },
    });
    const ids = routers.map((r) => r.id);
    const dayAgo = new Date(Date.now() - 86_400_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [latest, availability, reboots] = await Promise.all([
      prisma.$queryRaw<{ routerId: string; at: Date; cpuPercent: number | null; memoryPercent: number | null; temperatureC: number | null; uptimeSeconds: number | null }[]>`
        SELECT DISTINCT ON ("routerId") "routerId", at, "cpuPercent", "memoryPercent", "temperatureC", "uptimeSeconds"
        FROM router_health_samples WHERE "routerId" = ANY(${ids}) AND reachable ORDER BY "routerId", at DESC`,
      prisma.$queryRaw<{ routerId: string; up: bigint; total: bigint }[]>`
        SELECT "routerId", COUNT(*) FILTER (WHERE reachable) AS up, COUNT(*) AS total
        FROM router_health_samples WHERE "routerId" = ANY(${ids}) AND at >= ${dayAgo} GROUP BY "routerId"`,
      prisma.$queryRaw<{ routerId: string; reboots: bigint }[]>`
        SELECT "routerId", COUNT(*) AS reboots FROM (
          SELECT "routerId", "uptimeSeconds", LAG("uptimeSeconds") OVER (PARTITION BY "routerId" ORDER BY at) AS prev
          FROM router_health_samples WHERE "routerId" = ANY(${ids}) AND at >= ${weekAgo} AND reachable
        ) s WHERE prev IS NOT NULL AND "uptimeSeconds" < prev GROUP BY "routerId"`,
    ]);
    reply.send(
      successResponse(
        routers.map((r) => {
          const l = latest.find((x) => x.routerId === r.id);
          const a = availability.find((x) => x.routerId === r.id);
          const { cpuLoadPercent, memoryUsedBytes, memoryTotalBytes, temperatureC, voltageV, diskFreeBytes, diskTotalBytes, activeUsers, uptimeSeconds, routerOsVersion, boardName, lastSeenAt, ...base } = r;
          return {
            ...base,
            // What the router last reported about itself (every minute, from its heartbeat or a
            // live read) — fresher than the 5-minute samples the history is built from.
            live: {
              at: lastSeenAt,
              cpuPercent: cpuLoadPercent,
              memoryUsedBytes: memoryUsedBytes === null ? null : Number(memoryUsedBytes),
              memoryTotalBytes: memoryTotalBytes === null ? null : Number(memoryTotalBytes),
              memoryPercent: memoryUsedBytes !== null && memoryTotalBytes ? Math.round(Number((memoryUsedBytes * 100n) / memoryTotalBytes)) : null,
              temperatureC,
              voltageV,
              diskFreeBytes: diskFreeBytes === null ? null : Number(diskFreeBytes),
              diskTotalBytes: diskTotalBytes === null ? null : Number(diskTotalBytes),
              activeUsers,
              uptimeSeconds,
              routerOsVersion,
              boardName,
            },
            latest: l ? { at: l.at, cpuPercent: l.cpuPercent, memoryPercent: l.memoryPercent, temperatureC: l.temperatureC, uptimeSeconds: l.uptimeSeconds } : null,
            availability24h: a && Number(a.total) > 0 ? Math.round((Number(a.up) / Number(a.total)) * 1000) / 10 : null,
            reboots7d: Number(reboots.find((x) => x.routerId === r.id)?.reboots ?? 0),
          };
        }),
        request.id
      )
    );
  });

  app.get("/:routerId", { config: { audience: "staff" }, preHandler: [...preHandler, requirePermission("routers.read")] }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { routerId } = z.object({ routerId: z.string().uuid() }).parse(request.params);
    const { hours } = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }).parse(request.query);
    if (!(await prisma.router.findFirst({ where: { id: routerId, tenantId, deletedAt: null }, select: { id: true } }))) throw new NotFoundError("Router");
    // Averaged into at most ~150 points, whatever the window, so a week draws as fast as a day.
    const bucketSeconds = Math.max(300, Math.ceil((hours * 3600) / 150 / 300) * 300);
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await prisma.$queryRaw<{ bucket: Date; cpu: number | null; mem: number | null; temp: number | null; up: number }[]>`
      SELECT to_timestamp(floor(extract(epoch FROM at) / ${bucketSeconds}) * ${bucketSeconds}) AS bucket,
             AVG("cpuPercent")::float AS cpu, AVG("memoryPercent")::float AS mem, AVG("temperatureC")::float AS temp,
             AVG(CASE WHEN reachable THEN 100 ELSE 0 END)::float AS up
      FROM router_health_samples WHERE "routerId" = ${routerId} AND at >= ${since}
      GROUP BY 1 ORDER BY 1`;
    const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    reply.send(successResponse({ hours, bucketSeconds, points: rows.map((r) => ({ at: r.bucket, cpu: round(r.cpu), memory: round(r.mem), temperature: round(r.temp), availability: round(r.up) })) }, request.id));
  });
}
