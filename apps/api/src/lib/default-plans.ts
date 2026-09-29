import { prisma } from "@mashupkgrid/database";
import { TENANT_FEATURES } from "@mashupkgrid/shared";

/**
 * The plans a platform starts with, so an ISP can upgrade and pay from its first day instead of
 * waiting for a super admin to build the catalogue ("No plans are available yet"). Every plan
 * includes every feature; they differ by how many routers and customers they allow. A super admin
 * edits prices, limits and names on the Subscription plans page, or switches plans off.
 */
export const DEFAULT_PLANS = [
  {
    name: "Starter",
    slug: "starter",
    description: "For a small hotspot: up to 2 routers and 300 customers.",
    monthlyPriceMinor: 1_500_00,
    annualPriceMinor: 15_000_00,
    maxRouters: 2,
    maxCustomers: 300,
    isDefault: true,
    sortOrder: 1,
  },
  {
    name: "Business",
    slug: "business",
    description: "For a growing ISP: up to 10 routers and 2,000 customers.",
    monthlyPriceMinor: 3_500_00,
    annualPriceMinor: 35_000_00,
    maxRouters: 10,
    maxCustomers: 2000,
    isDefault: false,
    sortOrder: 2,
  },
  {
    name: "Pro",
    slug: "pro",
    description: "No limits on routers or customers.",
    monthlyPriceMinor: 7_500_00,
    annualPriceMinor: 75_000_00,
    maxRouters: null,
    maxCustomers: null,
    isDefault: false,
    sortOrder: 3,
  },
] as const;

/**
 * Creates the default plans when the platform has no plans at all. Once any plan exists — made
 * here or by a super admin, active or switched off — nothing is touched, so a super admin's
 * catalogue is never overwritten. Returns how many plans were created.
 */
export async function ensureDefaultPlans(): Promise<number> {
  if ((await prisma.tenantPlan.count()) > 0) return 0;
  const result = await prisma.tenantPlan.createMany({
    data: DEFAULT_PLANS.map((p) => ({ ...p, trialDays: 14, features: [...TENANT_FEATURES], isActive: true })),
    skipDuplicates: true,
  });
  return result.count;
}
