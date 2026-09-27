import { prisma, type Vlan, type VlanType, type Prisma } from "@mashupkgrid/database";
import { ConflictError, NotFoundError, ValidationError } from "@mashupkgrid/shared";

/**
 * VLAN management (spec section 1/2). Every function here is tenant-scoped by its first argument
 * — a VLAN is network configuration for one ISP and must never be reachable from another, the
 * same rule every other service in this repo follows.
 *
 * A row in `vlans` is a DECLARATION of intent. It does not mean the VLAN exists on a router.
 * Nothing in this file talks to a device; that is the provisioning job's responsibility, and
 * `provisioningStatus` is the only field allowed to claim anything about the device side.
 */

/** 802.1Q reserves 0 (priority-tagged frames) and 4095 (implementation use), leaving 1-4094 as
 *  assignable. 1 is assignable but is the default VLAN on essentially every switch, so it is
 *  allowed here and merely flagged by `describeVlanTagRisk` rather than blocked — an ISP with an
 *  existing network genuinely may need to model it. */
export const MIN_VLAN_TAG = 1;
export const MAX_VLAN_TAG = 4094;

export function isValidVlanTag(tag: number): boolean {
  return Number.isInteger(tag) && tag >= MIN_VLAN_TAG && tag <= MAX_VLAN_TAG;
}

export function assertValidVlanTag(tag: number): void {
  if (!isValidVlanTag(tag)) {
    throw new ValidationError(
      `VLAN ID must be a whole number between ${MIN_VLAN_TAG} and ${MAX_VLAN_TAG} (802.1Q reserves 0 and 4095)`
    );
  }
}

/** A non-blocking advisory shown next to the tag field. Returns null when there is nothing to
 *  say. Deliberately advice, not enforcement: these are conventions, not rules, and an ISP
 *  adopting an existing network may legitimately need any of them. */
export function describeVlanTagRisk(tag: number): string | null {
  if (tag === 1) {
    return "VLAN 1 is the default VLAN on most switches. Using it for customer traffic is usually discouraged.";
  }
  if (tag >= 1002 && tag <= 1005) {
    return "VLANs 1002-1005 are reserved by legacy Cisco defaults (FDDI/Token Ring) and can behave unexpectedly on mixed hardware.";
  }
  return null;
}

export interface CreateVlanInput {
  vlanTag: number;
  name: string;
  description?: string | null;
  type?: VlanType;
  customTypeLabel?: string | null;
  routerId?: string | null;
  subnetCidr?: string | null;
  gateway?: string | null;
  ipPoolId?: string | null;
  dnsServers?: string[];
  downloadKbps?: number | null;
  uploadKbps?: number | null;
  mtu?: number | null;
  trunkInterface?: string | null;
  isEnabled?: boolean;
  oltDeviceRef?: string | null;
  ponPort?: string | null;
  serviceVlanTag?: number | null;
  customerVlanTag?: number | null;
  vlanMode?: string | null;
}

export type UpdateVlanInput = Partial<CreateVlanInput>;

/** Confirms a referenced router and IP pool both belong to THIS tenant before they are stored.
 *  Without this a caller could attach their VLAN to another ISP's router by id, which the
 *  foreign key alone would happily allow — the FK proves the row exists, not who owns it. */
async function assertReferencesBelongToTenant(
  tenantId: string,
  routerId?: string | null,
  ipPoolId?: string | null
): Promise<void> {
  if (routerId) {
    const router = await prisma.router.findFirst({ where: { id: routerId, tenantId, deletedAt: null } });
    if (!router) throw new NotFoundError("Router");
  }
  if (ipPoolId) {
    const pool = await prisma.iPPool.findFirst({ where: { id: ipPoolId, tenantId } });
    if (!pool) throw new NotFoundError("IP pool");
  }
}

/**
 * The duplicate-tag rule from spec section 1. The database enforces it too (a compound unique on
 * routerId+vlanTag), but Postgres treats NULL routerId as distinct, so unassigned VLANs need
 * checking here. Two unassigned VLANs sharing a tag is NOT rejected — they conflict only once
 * both land on the same device, and blocking it would stop an ISP designing a numbering plan
 * before their routers are linked.
 */
async function assertNoDuplicateTag(
  tenantId: string,
  vlanTag: number,
  routerId: string | null | undefined,
  excludeVlanId?: string
): Promise<void> {
  if (!routerId) return;
  const clash = await prisma.vlan.findFirst({
    where: {
      tenantId,
      routerId,
      vlanTag,
      deletedAt: null,
      ...(excludeVlanId ? { id: { not: excludeVlanId } } : {}),
    },
    include: { router: { select: { name: true } } },
  });
  if (clash) {
    throw new ConflictError(
      `VLAN ${vlanTag} already exists on router "${clash.router?.name ?? routerId}" as "${clash.name}". A VLAN ID must be unique per device.`
    );
  }
}

function assertTypeConsistency(type: VlanType | undefined, customTypeLabel: string | null | undefined): void {
  if (type === "CUSTOM" && !customTypeLabel?.trim()) {
    throw new ValidationError('A custom VLAN type needs a label — name the purpose this VLAN serves.');
  }
}

export async function listVlans(
  tenantId: string,
  filters: {
    search?: string;
    routerId?: string;
    type?: VlanType;
    isEnabled?: boolean;
  } = {}
): Promise<Array<Vlan & { router: { id: string; name: string } | null; packageCount: number }>> {
  const where: Prisma.VlanWhereInput = {
    tenantId,
    deletedAt: null,
    ...(filters.routerId ? { routerId: filters.routerId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.isEnabled !== undefined ? { isEnabled: filters.isEnabled } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { description: { contains: filters.search, mode: "insensitive" as const } },
            // A numeric search term is far more likely to be a VLAN tag than part of a name.
            ...(/^\d+$/.test(filters.search) ? [{ vlanTag: Number(filters.search) }] : []),
          ],
        }
      : {}),
  };

  const rows = await prisma.vlan.findMany({
    where,
    include: {
      router: { select: { id: true, name: true } },
      _count: { select: { packages: true } },
    },
    orderBy: [{ vlanTag: "asc" }],
  });

  return rows.map(({ _count, ...vlan }) => ({ ...vlan, packageCount: _count.packages }));
}

export async function getVlanOrThrow(tenantId: string, vlanId: string): Promise<Vlan> {
  const vlan = await prisma.vlan.findFirst({ where: { id: vlanId, tenantId, deletedAt: null } });
  if (!vlan) throw new NotFoundError("VLAN");
  return vlan;
}

export async function createVlan(tenantId: string, input: CreateVlanInput): Promise<Vlan> {
  assertValidVlanTag(input.vlanTag);
  assertTypeConsistency(input.type, input.customTypeLabel);
  await assertReferencesBelongToTenant(tenantId, input.routerId, input.ipPoolId);
  await assertNoDuplicateTag(tenantId, input.vlanTag, input.routerId);

  return prisma.vlan.create({
    data: {
      tenantId,
      vlanTag: input.vlanTag,
      name: input.name.trim(),
      description: input.description ?? null,
      type: input.type ?? "CUSTOMER_INTERNET",
      customTypeLabel: input.customTypeLabel?.trim() || null,
      routerId: input.routerId ?? null,
      subnetCidr: input.subnetCidr ?? null,
      gateway: input.gateway ?? null,
      ipPoolId: input.ipPoolId ?? null,
      dnsServers: input.dnsServers ?? [],
      downloadKbps: input.downloadKbps ?? null,
      uploadKbps: input.uploadKbps ?? null,
      mtu: input.mtu ?? null,
      trunkInterface: input.trunkInterface?.trim() || null,
      isEnabled: input.isEnabled ?? true,
      oltDeviceRef: input.oltDeviceRef ?? null,
      ponPort: input.ponPort ?? null,
      serviceVlanTag: input.serviceVlanTag ?? null,
      customerVlanTag: input.customerVlanTag ?? null,
      vlanMode: input.vlanMode ?? null,
    },
  });
}

export async function updateVlan(tenantId: string, vlanId: string, patch: UpdateVlanInput): Promise<Vlan> {
  const existing = await getVlanOrThrow(tenantId, vlanId);

  if (patch.vlanTag !== undefined) assertValidVlanTag(patch.vlanTag);
  assertTypeConsistency(patch.type ?? existing.type, patch.customTypeLabel ?? existing.customTypeLabel);
  await assertReferencesBelongToTenant(tenantId, patch.routerId, patch.ipPoolId);

  // Re-check the duplicate rule against the values as they WILL be, not as they are: moving a
  // VLAN onto a different router is exactly the edit that can create a clash.
  const nextTag = patch.vlanTag ?? existing.vlanTag;
  const nextRouterId = patch.routerId !== undefined ? patch.routerId : existing.routerId;
  await assertNoDuplicateTag(tenantId, nextTag, nextRouterId, vlanId);

  // Changing the tag or the router means whatever was configured on the device no longer matches
  // this row, so the VLAN drops back to NOT_PROVISIONED rather than continuing to claim ACTIVE
  // for configuration that is now stale.
  const identityChanged = nextTag !== existing.vlanTag || nextRouterId !== existing.routerId;

  return prisma.vlan.update({
    where: { id: vlanId },
    data: {
      ...(patch.vlanTag !== undefined ? { vlanTag: patch.vlanTag } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.customTypeLabel !== undefined ? { customTypeLabel: patch.customTypeLabel?.trim() || null } : {}),
      ...(patch.routerId !== undefined ? { routerId: patch.routerId } : {}),
      ...(patch.subnetCidr !== undefined ? { subnetCidr: patch.subnetCidr } : {}),
      ...(patch.gateway !== undefined ? { gateway: patch.gateway } : {}),
      ...(patch.ipPoolId !== undefined ? { ipPoolId: patch.ipPoolId } : {}),
      ...(patch.dnsServers !== undefined ? { dnsServers: patch.dnsServers } : {}),
      ...(patch.downloadKbps !== undefined ? { downloadKbps: patch.downloadKbps } : {}),
      ...(patch.uploadKbps !== undefined ? { uploadKbps: patch.uploadKbps } : {}),
      ...(patch.mtu !== undefined ? { mtu: patch.mtu } : {}),
      ...(patch.trunkInterface !== undefined ? { trunkInterface: patch.trunkInterface?.trim() || null } : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled } : {}),
      ...(patch.oltDeviceRef !== undefined ? { oltDeviceRef: patch.oltDeviceRef } : {}),
      ...(patch.ponPort !== undefined ? { ponPort: patch.ponPort } : {}),
      ...(patch.serviceVlanTag !== undefined ? { serviceVlanTag: patch.serviceVlanTag } : {}),
      ...(patch.customerVlanTag !== undefined ? { customerVlanTag: patch.customerVlanTag } : {}),
      ...(patch.vlanMode !== undefined ? { vlanMode: patch.vlanMode } : {}),
      ...(identityChanged
        ? { provisioningStatus: "NOT_PROVISIONED" as const, lastProvisionedAt: null }
        : {}),
    },
  });
}

/**
 * Soft-deletes a VLAN. Refuses while packages still reference it: deleting would silently strip
 * the network configuration from every subscriber on those packages, and an ISP discovering that
 * through customer complaints is precisely the failure this check exists to prevent. The caller
 * is told which packages to reassign first.
 */
export async function deleteVlan(tenantId: string, vlanId: string): Promise<void> {
  await getVlanOrThrow(tenantId, vlanId);
  const packages = await prisma.package.findMany({
    where: { vlanId, deletedAt: null },
    select: { name: true },
    take: 5,
  });
  if (packages.length > 0) {
    throw new ConflictError(
      `This VLAN is still used by ${packages.length === 5 ? "5 or more" : packages.length} package(s): ` +
        `${packages.map((p) => `"${p.name}"`).join(", ")}. Move them to another VLAN first.`
    );
  }
  // Clearing routerId is load-bearing, not tidiness. The unique constraint on
  // (routerId, vlanTag) is enforced by Postgres, which knows nothing about soft deletes — so a
  // deleted row would keep squatting on its tag and the next attempt to create VLAN 21 on that
  // router failed with a raw Prisma P2002 instead of succeeding. A deleted VLAN is not on any
  // device, so detaching it is also the semantically honest thing to record. Which router it was
  // on is not lost: the delete route audit-logs routerId in its `before` snapshot.
  await prisma.vlan.update({
    where: { id: vlanId },
    data: { deletedAt: new Date(), isEnabled: false, routerId: null, provisioningStatus: "NOT_PROVISIONED" },
  });
}

export async function setVlanEnabled(tenantId: string, vlanId: string, isEnabled: boolean): Promise<Vlan> {
  await getVlanOrThrow(tenantId, vlanId);
  return prisma.vlan.update({ where: { id: vlanId }, data: { isEnabled } });
}

export interface VlanOverview {
  total: number;
  enabled: number;
  disabled: number;
  byType: Record<string, number>;
  provisioningFailed: number;
}

/** Backs the dashboard counters in spec section 12. Counts come from the database only — this
 *  says nothing about live device state, which is why "provisioning errors" is reported from the
 *  recorded status rather than by probing routers at page-load time. */
export async function getVlanOverview(tenantId: string): Promise<VlanOverview> {
  const [total, enabled, provisioningFailed, grouped] = await Promise.all([
    prisma.vlan.count({ where: { tenantId, deletedAt: null } }),
    prisma.vlan.count({ where: { tenantId, deletedAt: null, isEnabled: true } }),
    prisma.vlan.count({ where: { tenantId, deletedAt: null, provisioningStatus: "FAILED" } }),
    prisma.vlan.groupBy({
      by: ["type"],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const byType: Record<string, number> = {};
  for (const row of grouped) byType[row.type] = row._count._all;

  return { total, enabled, disabled: total - enabled, byType, provisioningFailed };
}

/** The customers currently attached to a VLAN, resolved through the package that carries it
 *  (spec section 1, "View customers assigned to a VLAN"). */
export async function listVlanCustomers(tenantId: string, vlanId: string) {
  await getVlanOrThrow(tenantId, vlanId);
  return prisma.customerService.findMany({
    where: { tenantId, package: { vlanId } },
    select: {
      id: true,
      status: true,
      customer: { select: { id: true, fullName: true, phone: true } },
      package: { select: { id: true, name: true } },
      radiusUser: { select: { username: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}
