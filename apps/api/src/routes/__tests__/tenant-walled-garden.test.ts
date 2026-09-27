import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/** An ISP's own walled-garden hosts: validated like the platform list (no paywall-wide
 *  wildcards), stored in the ISP's preferences, audited, and editable only with routers.manage. */

const h = vi.hoisted(() => ({
  prisma: {
    session: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    tenant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    platformWalledGardenHost: { findMany: vi.fn().mockResolvedValue([{ host: "pay.platform.example" }]) },
  },
  getCachedPermissions: vi.fn(),
  auditEntries: [] as Array<Record<string, unknown>>,
}));

vi.mock("@mashupkgrid/database", () => ({ prisma: h.prisma, Prisma: {} }));
vi.mock("../../lib/redis.js", () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock("../../lib/permission-cache.js", () => ({ getCachedPermissions: h.getCachedPermissions }));
vi.mock("../../lib/maintenance-state.js", () => ({
  getCurrentMaintenanceState: vi.fn().mockResolvedValue({ enabled: false, level: 1, allowedIps: [], allowedRoles: [] }),
}));
vi.mock("../../lib/audit.js", () => ({
  writeAuditLog: vi.fn(async (entry: Record<string, unknown>) => {
    h.auditEntries.push(entry);
  }),
}));

import { signAccessToken } from "@mashupkgrid/auth";
import { registerErrorHandler } from "../../plugins/error-handler.js";
import { tenantWalledGardenRoutes } from "../tenant-walled-garden.js";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const STAFF_ID = "44444444-4444-4444-4444-444444444444";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const auth = async () => ({ authorization: `Bearer ${await signAccessToken({ sub: STAFF_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, roles: [] })}` });

describe("ISP walled garden", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerErrorHandler(app);
    await app.register(tenantWalledGardenRoutes, { prefix: "/api/v1/walled-garden" });
    await app.ready();
  });
  afterAll(() => app.close());

  beforeEach(() => {
    h.auditEntries.length = 0;
    h.prisma.tenant.update.mockClear();
    h.prisma.session.findUnique.mockResolvedValue({ id: SESSION_ID, userId: STAFF_ID, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    h.prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, slug: "acme", name: "Acme", status: "ACTIVE", deletedAt: null, brandColor: null, logoUrl: null, disabledFeatures: [], trialEndsAt: null, subscription: null });
    h.prisma.tenant.findUniqueOrThrow.mockResolvedValue({ preferences: { walledGarden: { hosts: ["old.acme.co.ke"] } } });
    h.getCachedPermissions.mockResolvedValue(new Set(["routers.read", "routers.manage"]));
  });

  it("lists the ISP's hosts next to the platform's", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/walled-garden", headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.hosts).toEqual(["old.acme.co.ke"]);
  });

  it("normalises, de-duplicates, saves and audits", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/walled-garden", headers: await auth(), payload: { hosts: ["https://WWW.acme.co.ke/pay", "www.acme.co.ke", "*.acme.co.ke", "41.90.1.2", " "] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.hosts).toEqual(["www.acme.co.ke", "*.acme.co.ke", "41.90.1.2"]);
    const saved = h.prisma.tenant.update.mock.calls[0]![0].data.preferences.walledGarden.hosts;
    expect(saved).toEqual(["www.acme.co.ke", "*.acme.co.ke", "41.90.1.2"]);
    expect(h.auditEntries).toEqual([expect.objectContaining({ action: "walled_garden.updated", before: { hosts: ["old.acme.co.ke"] } })]);
  });

  it("refuses a wildcard that would open the whole paywall, saving nothing", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/walled-garden", headers: await auth(), payload: { hosts: ["www.acme.co.ke", "*.com"] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain("*.com");
    expect(h.prisma.tenant.update).not.toHaveBeenCalled();
  });

  it("needs routers.manage to change it", async () => {
    h.getCachedPermissions.mockResolvedValue(new Set(["routers.read"]));
    const res = await app.inject({ method: "PUT", url: "/api/v1/walled-garden", headers: await auth(), payload: { hosts: [] } });
    expect(res.statusCode).toBe(403);
  });
});
