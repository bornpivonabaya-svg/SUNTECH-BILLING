import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, Prisma } from "@mashupkgrid/database";
import { successResponse, ConflictError, ValidationError, resolveTenantPreferences } from "@mashupkgrid/shared";
import { listPlatformWalledGardenHosts, normalizeWalledGardenHost } from "@mashupkgrid/network";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";

/**
 * An ISP's own walled-garden hosts: what its hotspot customers can open before paying (the ISP's
 * website, a payment or support page), added to the platform's list. Routers pick changes up in
 * their setup script and, when online, at the next hotspot self-repair pass.
 */

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;
const MAX_HOSTS = 50;

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) throw new ConflictError("The ISP walled garden belongs to an ISP account");
  return tenantId;
}

export async function tenantWalledGardenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { config: { audience: "staff" as const }, preHandler: [...preHandler, requirePermission("routers.read")] }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { preferences: true } });
    reply.send(successResponse({ hosts: resolveTenantPreferences(tenant.preferences).walledGarden.hosts, platformHosts: await listPlatformWalledGardenHosts() }, request.id));
  });

  app.put("/", { config: { audience: "staff" as const }, preHandler: [...preHandler, requirePermission("routers.manage")] }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { hosts } = z.object({ hosts: z.array(z.string().max(253)).max(MAX_HOSTS) }).parse(request.body);
    const normalized: string[] = [];
    const rejected: string[] = [];
    for (const raw of hosts) {
      if (!raw.trim()) continue;
      const host = normalizeWalledGardenHost(raw);
      if (host) normalized.push(host);
      else rejected.push(raw.trim());
    }
    if (rejected.length) {
      throw new ValidationError(`These can't go in the walled garden: ${rejected.join(", ")}. Use a specific host like pay.example.co.ke, a wildcard under your own domain like *.example.co.ke, or one IP address.`);
    }
    const unique = [...new Set(normalized)];
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { preferences: true } });
    const prefs = resolveTenantPreferences(tenant.preferences);
    const before = prefs.walledGarden.hosts;
    await prisma.tenant.update({ where: { id: tenantId }, data: { preferences: { ...prefs, walledGarden: { hosts: unique } } as unknown as Prisma.InputJsonValue } });
    await writeAuditLog({ tenantId, actorUserId: request.user!.id, action: "walled_garden.updated", resourceType: "Tenant", resourceId: tenantId, before: { hosts: before }, after: { hosts: unique }, ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null });
    reply.send(successResponse({ hosts: unique }, request.id));
  });
}
