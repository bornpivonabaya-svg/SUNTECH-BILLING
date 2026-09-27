/**
 * Writes studio/seed/homepage.ndjson from the homepage's built-in content, so a new Sanity
 * project starts with today's text instead of an empty page. Run after changing the defaults:
 *   pnpm --filter @mashupkgrid/web exec tsx scripts/sanity-seed.ts
 * then, in /studio: npm run seed
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_LANDING_CONTENT as C } from "../src/lib/landing-content";
import { DEFAULT_LANDING_SECTIONS as S } from "../src/lib/landing-sections";

const key = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const items = <T extends object>(type: string, list: T[], id: (t: T) => string) => list.map((t) => ({ _type: type, _key: key(id(t)), ...t }));


const doc = {
  _id: "homepage",
  _type: "homepage",
  hero: { ...C.hero, ticks: S.heroTicks },
  announcement: C.announcement,
  featureGroups: items("featureGroup", S.featureGroups.map(({ mpesa: _unused, ...g }) => g), (g) => g.title),
  network: S.network,
  showcasePoints: S.showcasePoints,
  steps: items("step", S.steps, (s) => s.title),
  customerPoints: items("customerPoint", S.customerPoints, (c) => c.title),
  pricing: {
    starterMonthly: C.pricing.starterMonthly,
    starterAnnual: C.pricing.starterAnnual,
    growthMonthly: C.pricing.growthMonthly,
    growthAnnual: C.pricing.growthAnnual,
    carrierMonthly: C.pricing.carrierMonthly,
    carrierAnnual: C.pricing.carrierAnnual,
  },
  planIncludes: S.planIncludes,
  operatorPoints: items("operatorPoint", S.operatorPoints, (o) => o.title),
  faqs: items("faq", C.faqs, (f) => f.q),
  footer: C.footer,
};

const out = resolve(__dirname, "../../../studio/seed/homepage.ndjson");
writeFileSync(out, JSON.stringify(doc) + "\n");
console.log(`wrote ${out}`);
