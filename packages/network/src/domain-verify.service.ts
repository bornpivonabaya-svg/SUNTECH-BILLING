import { prisma, type Domain } from "@mashupkgrid/database";
import { env } from "@mashupkgrid/config";
import type { AutomationSummary } from "@mashupkgrid/shared";
import { checkDomainPointsTo, domainTarget } from "./domain-provider.js";

/** Checks one custom domain's DNS and records the result: VERIFIED once it points at the
 *  tenant's platform address (the TLS check then takes it to SSL_ACTIVE), DNS_ERROR with the
 *  reason otherwise. Never marks anything verified that DNS doesn't show. */
export async function verifyDomain(domainId: string): Promise<Domain> {
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id: domainId }, include: { tenant: { select: { slug: true } } } });
  const check = await checkDomainPointsTo(domain.hostname, domainTarget(domain.tenant.slug, env.PLATFORM_BASE_DOMAIN));
  const alreadyLive = domain.status === "VERIFIED" || domain.status === "SSL_PENDING" || domain.status === "SSL_ACTIVE";
  return prisma.domain.update({
    where: { id: domain.id },
    data: check.ok
      ? { status: alreadyLive ? domain.status : "VERIFIED", lastError: null, lastCheckedAt: new Date(), verifiedAt: domain.verifiedAt ?? new Date() }
      : { status: "DNS_ERROR", lastError: check.reason, lastCheckedAt: new Date() },
  });
}

/** Worker pass: keeps checking domains the ISP added until their DNS shows up (for two weeks),
 *  so nobody has to come back and press "check". */
export async function checkPendingDomains(): Promise<AutomationSummary> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const pending = await prisma.domain.findMany({ where: { status: { in: ["PENDING", "DNS_ERROR"] }, createdAt: { gte: since } }, select: { id: true }, take: 200 });
  let verified = 0;
  let waiting = 0;
  for (const d of pending) {
    const r = await verifyDomain(d.id).catch(() => null);
    if (r?.status === "VERIFIED") verified++;
    else waiting++;
  }
  return { verified, waiting };
}
