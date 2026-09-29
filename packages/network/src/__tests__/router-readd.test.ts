import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@mashupkgrid/shared";

type Row = Record<string, unknown> & { id: string };
const db: { routers: Row[]; peers: string[] } = { routers: [], peers: [] };

const matches = (r: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(r, w));
    if (v && typeof v === "object" && "not" in v) return r[k] !== (v as { not: unknown }).not;
    if (v && typeof v === "object" && "gt" in v) return (r[k] as Date) > (v as { gt: Date }).gt;
    return r[k] === v;
  });

vi.mock("@mashupkgrid/database", () => {
  const update = async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = db.routers.find((r) => r.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  };
  return {
    prisma: {
      router: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => db.routers.find((r) => matches(r, where)) ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) => db.routers.filter((r) => matches(r, where)),
        update,
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
  };
});
vi.mock("@mashupkgrid/config", () => ({ env: { ENCRYPTION_KEY: "x".repeat(64), WIREGUARD_INTERFACE: "wg0" }, isProduction: false }));
vi.mock("../factory.js", () => ({ createAdapterForRouter: vi.fn() }));
vi.mock("../wireguard-peer.service.js", () => ({
  allocateNextVpnIp: () => "10.90.0.9",
  registerWireguardPeer: async (_iface: string, key: string) => void db.peers.push(key),
  removeWireguardPeer: async () => {},
}));

const { findRouterByProvisionToken } = await import("../router.service.js");

const removedAt = new Date("2026-09-29T07:00:00Z");
function removedBox(extra: Partial<Row> = {}): Row {
  return {
    id: "old",
    tenantId: "t1",
    name: "nexus",
    host: "154.159.252.107",
    deletedAt: removedAt,
    provisionTokenHash: hashToken("old-token"),
    previousProvisionTokenHash: null,
    usernameEncrypted: "old-user",
    passwordEncrypted: "old-secret",
    vpnPublicKey: "ROUTERKEY=",
    vpnIp: "10.90.0.2",
    vpnConfiguredAt: removedAt,
    ...extra,
  };
}
function readded(extra: Partial<Row> = {}): Row {
  return {
    id: "new",
    tenantId: "t1",
    name: "nexus",
    host: "154.159.252.107",
    deletedAt: null,
    createdAt: new Date("2026-09-29T07:05:00Z"),
    provisionedAt: null,
    provisionTokenHash: null,
    previousProvisionTokenHash: null,
    usernameEncrypted: "typed-user",
    passwordEncrypted: "typed-password",
    vpnPublicKey: null,
    vpnIp: null,
    ...extra,
  };
}

describe("a router removed from the dashboard and added again", () => {
  beforeEach(() => {
    db.routers = [];
    db.peers = [];
  });

  it("keeps checking in: the new record takes the box's token, credentials and VPN peer", async () => {
    db.routers = [removedBox(), readded()];
    const found = await findRouterByProvisionToken("old-token");
    expect(found?.id).toBe("new");
    const row = db.routers.find((r) => r.id === "new")!;
    expect(row.provisionTokenHash).toBe(hashToken("old-token"));
    // The RADIUS secret and management account the router really has.
    expect(row.passwordEncrypted).toBe("old-secret");
    expect(row.usernameEncrypted).toBe("old-user");
    expect(row.vpnPublicKey).toBe("ROUTERKEY=");
    expect(db.peers).toEqual(["ROUTERKEY="]);
    // The removed record gave up the token (it is unique).
    expect(db.routers.find((r) => r.id === "old")!.provisionTokenHash).toBeNull();
    // And from now on the token finds the new record directly.
    expect((await findRouterByProvisionToken("old-token"))?.id).toBe("new");
  });

  it("keeps a setup command already issued for the new record working", async () => {
    db.routers = [removedBox(), readded({ provisionTokenHash: hashToken("new-token") })];
    expect((await findRouterByProvisionToken("old-token"))?.id).toBe("new");
    const row = db.routers.find((r) => r.id === "new")!;
    expect(row.provisionTokenHash).toBe(hashToken("new-token"));
    expect(row.previousProvisionTokenHash).toBe(hashToken("old-token"));
  });

  it("adopts nothing when it can't be sure which router it is", async () => {
    // Two candidates.
    db.routers = [removedBox(), readded(), readded({ id: "new2", name: "other" })];
    expect(await findRouterByProvisionToken("old-token")).toBeNull();
    // A router that already checked in with its own setup is a different box's record.
    db.routers = [removedBox(), readded({ provisionedAt: new Date() })];
    expect(await findRouterByProvisionToken("old-token")).toBeNull();
    // Added before the removal: not a re-add.
    db.routers = [removedBox(), readded({ createdAt: new Date("2026-09-28T00:00:00Z") })];
    expect(await findRouterByProvisionToken("old-token")).toBeNull();
    // Another ISP's router.
    db.routers = [removedBox(), readded({ tenantId: "t2" })];
    expect(await findRouterByProvisionToken("old-token")).toBeNull();
    // A token nobody ever had.
    db.routers = [readded()];
    expect(await findRouterByProvisionToken("unknown")).toBeNull();
  });
});
