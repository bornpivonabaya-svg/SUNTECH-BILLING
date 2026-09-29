import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/** The walled garden is a hole in every ISP's paywall, so: platform admins only, validated
 *  hosts only, and every change audited. */

const h = vi.hoisted(() => ({
  prisma: {
    session: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    tenant: { findUnique: vi.fn() },
    platformWalledGardenHost: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
  },
  getCachedPermissions: vi.fn(),
  auditEntries: [] as Array<Record<string, unknown>>,
}));

vi.mock("@mashupkgrid/database", () => ({ prisma: h.prisma }));
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
import { platformWalledGardenRoutes } from "../platform-walled-garden.js";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const ADMIN_ID = "55555555-5555-5555-5555-555555555555";
const STAFF_ID = "44444444-4444-4444-4444-444444444444";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const adminAuth = async () => ({ authorization: `Bearer ${await signAccessToken({ sub: ADMIN_ID, tenantId: null, sessionId: SESSION_ID, roles: [] })}` });
const staffAuth = async () => ({ authorization: `Bearer ${await signAccessToken({ sub: STAFF_ID, tenantId: TENANT_ID, sessionId: SESSION_ID, roles: [] })}` });

describe("platform walled garden", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerErrorHandler(app);
    await app.register(platformWalledGardenRoutes, { prefix: "/api/v1/platform/walled-garden" });
    await app.ready();
  });
  afterAll(() => app.close());

  beforeEach(() => {
    h.auditEntries.length = 0;
    h.prisma.platformWalledGardenHost.create.mockClear();
    h.prisma.session.findUnique.mockImplementation(async () => ({ id: SESSION_ID, userId: ADMIN_ID, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }));
    h.prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID, slug: "acme", name: "Acme", status: "ACTIVE", deletedAt: null, brandColor: null, logoUrl: null, disabledFeatures: [], trialEndsAt: null, subscription: null });
    h.getCachedPermissions.mockResolvedValue(new Set(["maintenance.manage"]));
    h.prisma.platformWalledGardenHost.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "66666666-6666-6666-6666-666666666666", createdAt: new Date(), ...data }));
  });

  it("normalises and stores a pasted URL as its host, audited", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/platform/walled-garden", headers: await adminAuth(), payload: { host: "https://Pay.Example.com/checkout", note: "card gateway" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.host).toBe("pay.example.com");
    expect(h.auditEntries).toEqual([expect.objectContaining({ action: "platform.walled_garden.host_added", after: { host: "pay.example.com", note: "card gateway" } })]);
  });

  it("refuses a wildcard that would open the whole paywall", async () => {
    for (const host of ["*", "*.com", "*.co.ke"]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/platform/walled-garden", headers: await adminAuth(), payload: { host } });
      expect(res.statusCode, host).toBe(422);
    }
    expect(h.prisma.platformWalledGardenHost.create).not.toHaveBeenCalled();
  });

  it("refuses a host that is already built in", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/platform/walled-garden", headers: await adminAuth(), payload: { host: "*.paystack.com" } });
    expect(res.statusCode).toBe(409);
  });

  it("is closed to tenant staff, even an owner", async () => {
    h.getCachedPermissions.mockResolvedValue(new Set(["settings.manage", "routers.manage"]));
    const res = await app.inject({ method: "GET", url: "/api/v1/platform/walled-garden", headers: await staffAuth() });
    expect(res.statusCode).toBe(403);
  });
});
