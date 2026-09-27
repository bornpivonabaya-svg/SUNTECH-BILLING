import { prisma } from "@mashupkgrid/database";
import { resolveTenantPreferences } from "@mashupkgrid/shared";

/**
 * Platform-wide walled garden: what a hotspot customer can reach before they have paid.
 *
 * The router setup script has always carried the platform's own hosts and the payment gateways
 * (packages/radius setup-script.ts). A super admin adds to that list here — the next gateway,
 * a support site, the CDN an app needs — and every router picks it up: new ones through their
 * setup script, online ones through the hotspot self-repair pass in router.service.ts.
 *
 * Kept deliberately narrow. The walled garden is the hole in the paywall, so every entry must be
 * a specific host, a wildcard under a specific domain, or one IP address; "*" or "*.com" would
 * hand out free internet to every customer on every router on the platform.
 */

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^(?:${HOST_LABEL}\\.)+${HOST_LABEL}$`);
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** Lower-cased, trimmed, protocol/path stripped — or null when it is not something a router
 *  can be told to allow safely. */
export function normalizeWalledGardenHost(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;
  if (!host) return null;
  // Digits and dots is an IP or nothing: "999.1.1.1" must not pass as a hostname.
  if (/^[\d.]+$/.test(host)) return IPV4.test(host) ? host : null;
  const wildcard = host.startsWith("*.");
  const bare = wildcard ? host.slice(2) : host;
  if (!HOSTNAME.test(bare)) return null;
  // A wildcard needs a registrable domain under it: "*.co.ke" or "*.com" opens the whole TLD.
  if (wildcard && bare.split(".").length < 2) return null;
  if (wildcard && bare.split(".").length === 2 && PUBLIC_SUFFIX_2.has(bare)) return null;
  return host;
}

/** Two-part public suffixes met in practice; mirrors the list in packages/radius setup-script.ts. */
const PUBLIC_SUFFIX_2 = new Set(["co.ke", "or.ke", "ac.ke", "go.ke", "ne.ke", "me.ke", "co.tz", "co.ug", "co.za", "co.uk", "com.au", "com.br"]);

/** Every host a super admin has allowed, for merging into a router's walled garden. Best-effort:
 *  a database hiccup must not turn a router repair pass into a failure, and the built-in hosts
 *  still apply. */
export async function listPlatformWalledGardenHosts(): Promise<string[]> {
  try {
    const rows = await prisma.platformWalledGardenHost.findMany({ select: { host: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => r.host);
  } catch (err) {
    console.warn("[walled-garden] could not load platform hosts:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** The hosts one ISP added for its own hotspot customers, re-checked on the way out so an entry
 *  that slipped in some other way still can't open the paywall. */
export async function listTenantWalledGardenHosts(tenantId: string): Promise<string[]> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { preferences: true } });
    return resolveTenantPreferences(tenant?.preferences)
      .walledGarden.hosts.map(normalizeWalledGardenHost)
      .filter((h): h is string => h !== null);
  } catch (err) {
    console.warn("[walled-garden] could not load tenant hosts:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Everything a router of this ISP should let through before payment, beyond the built-ins. */
export async function listWalledGardenHostsFor(tenantId: string): Promise<string[]> {
  const [platform, own] = await Promise.all([listPlatformWalledGardenHosts(), listTenantWalledGardenHosts(tenantId)]);
  return [...new Set([...platform, ...own])];
}
