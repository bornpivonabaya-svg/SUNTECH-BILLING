import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * A router's access-point report is written without a login, so the only thing standing between
 * a stranger and another ISP's data is the router's own provisioning token. The old form trusted
 * any router id and fell back to the most recently seen router of ANY tenant.
 */

const h = vi.hoisted(() => ({
  prisma: { router: { findFirst: vi.fn() } },
  record: vi.fn(),
}));

vi.mock("@mashupkgrid/database", () => ({ prisma: h.prisma }));
vi.mock("../../lib/redis.js", () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock("../../lib/audit.js", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@mashupkgrid/network", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordRouterReportedAccessPoints: h.record,
}));

import { hashToken } from "@mashupkgrid/shared";
import { registerErrorHandler } from "../../plugins/error-handler.js";
import { routerRoutes, parseAccessPointReport } from "../routers.js";

const ROUTER = { id: "77777777-7777-7777-7777-777777777777", tenantId: "11111111-1111-1111-1111-111111111111" };
const REPORT = "ether2;AA:BB:CC:DD:EE:01;cAP-1;192.168.88.20;cAP ac|wlan1;aa-bb-cc-dd-ee-02;;none;";

describe("router access-point push", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerErrorHandler(app);
    await app.register(routerRoutes, { prefix: "/api/v1/routers" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // A router is found by its current token or the previous one (findRouterByProvisionToken).
    h.prisma.router.findFirst.mockImplementation(
      async ({ where }: { where: { OR?: { provisionTokenHash?: string; previousProvisionTokenHash?: string }[] } }) =>
        where.OR?.some((w) => (w.provisionTokenHash ?? w.previousProvisionTokenHash) === hashToken("good-token")) ? ROUTER : null
    );
  });

  it("records the report for the router that owns the token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/routers/provision/good-token/push-aps", payload: REPORT, headers: { "content-type": "text/plain" } });
    expect(res.statusCode).toBe(200);
    expect(h.record).toHaveBeenCalledTimes(1);
    const [routerId, aps, tenantId] = h.record.mock.calls[0]!;
    expect(routerId).toBe(ROUTER.id);
    expect(tenantId).toBe(ROUTER.tenantId);
    expect(aps).toHaveLength(2);
  });

  it("refuses an unknown token and writes nothing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/routers/provision/guessed/push-aps", payload: REPORT, headers: { "content-type": "text/plain" } });
    expect(res.statusCode).toBe(404);
    expect(h.record).not.toHaveBeenCalled();
  });

  it("no longer accepts the old id-based or id-less forms, with no fallback router", async () => {
    for (const url of [`/api/v1/routers/${ROUTER.id}/push-aps`, "/api/v1/routers/push-aps"]) {
      const res = await app.inject({ method: "POST", url, payload: REPORT, headers: { "content-type": "text/plain" } });
      expect(res.statusCode).toBe(410);
    }
    expect(h.prisma.router.findFirst).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe("parseAccessPointReport", () => {
  it("keeps valid entries and normalises them", () => {
    const aps = parseAccessPointReport(REPORT);
    expect(aps.map((a) => a.macAddress)).toEqual(["AA:BB:CC:DD:EE:01", "AA-BB-CC-DD-EE-02"]);
    expect(aps[0]).toMatchObject({ identity: "cAP-1", ipAddress: "192.168.88.20", interface: "ether2" });
    expect(aps[1]).toMatchObject({ identity: "Access Point", ipAddress: undefined });
  });

  it("drops junk and caps the size of what it accepts", () => {
    expect(parseAccessPointReport("ether2;not-a-mac;x|;;;")).toEqual([]);
    const flood = Array.from({ length: 1000 }, () => "ether2;AA:BB:CC:DD:EE:FF;" + "x".repeat(500)).join("|");
    const aps = parseAccessPointReport(flood);
    expect(aps.length).toBeLessThanOrEqual(200);
    expect(aps.every((a) => a.identity.length <= 64)).toBe(true);
  });
});
