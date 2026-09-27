import type { LandingContent } from "./landing-content";
import { LANDING_ICONS, type LandingIcon, type LandingSections } from "./landing-sections";

/**
 * Homepage content from Sanity. Server-side only, over Sanity's HTTP query API with plain
 * `fetch` — no SDK, so the web app keeps its React 18 and adds no dependency. Nothing here runs
 * unless SANITY_PROJECT_ID is set; without it (or when Sanity is unreachable, or a field is left
 * empty) the homepage keeps the content it had before.
 *
 * The Studio that edits this document lives in /studio at the repo root.
 */

const API_VERSION = "2025-01-01";
/** fetch tag the /cms/revalidate webhook clears, so a publish shows at once. */
export const HOMEPAGE_TAG = "sanity-homepage";

export function sanityConfig(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.SANITY_PROJECT_ID?.trim();
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) return null;
  const dataset = env.SANITY_DATASET?.trim() || "production";
  const token = env.SANITY_READ_TOKEN?.trim() || null;
  return { projectId, dataset, token };
}

export const HOMEPAGE_QUERY = `*[_type == "homepage" && _id == "homepage"][0]{
  announcement, hero, featureGroups, network, showcasePoints, steps, pricing, planIncludes,
  customerPoints, operatorPoints, faqs, footer
}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const strList = (v: unknown): string[] | undefined => {
  const list = Array.isArray(v) ? v.map(str).filter((s): s is string => Boolean(s)) : [];
  return list.length ? list : undefined;
};
const icon = (v: unknown, fallback: LandingIcon): LandingIcon => (LANDING_ICONS.includes(v as LandingIcon) ? (v as LandingIcon) : fallback);

/** Keeps only the fields an editor actually filled in, so an empty field never blanks the page. */
function filled<T extends Obj>(source: unknown, fields: Record<keyof T, (v: unknown) => unknown>): Partial<T> | undefined {
  if (!isObj(source)) return undefined;
  const out: Partial<T> = {};
  for (const [key, read] of Object.entries(fields) as [keyof T, (v: unknown) => unknown][]) {
    const value = read(source[key as string]);
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return Object.keys(out).length ? out : undefined;
}

function list<T>(v: unknown, read: (item: Obj) => T | undefined): T[] | undefined {
  const items = Array.isArray(v) ? v.filter(isObj).map(read).filter((x): x is T => x !== undefined) : [];
  return items.length ? items : undefined;
}

export interface SanityHomepage {
  content: Partial<LandingContent>;
  sections: Partial<LandingSections>;
}

/** Turns the raw Sanity document into the homepage's own shapes, dropping anything empty or malformed. */
export function mapHomepage(doc: unknown): SanityHomepage | null {
  if (!isObj(doc)) return null;
  const hero = isObj(doc.hero) ? doc.hero : {};
  const content: Partial<LandingContent> = {};
  const sections: Partial<LandingSections> = {};

  const announcement = filled<LandingContent["announcement"]>(doc.announcement, { badge: str, text: str, linkText: str, linkUrl: str });
  if (announcement) content.announcement = announcement as LandingContent["announcement"];
  const heroContent = filled<LandingContent["hero"]>(hero, {
    statusBadge: str,
    mainHeadingStart: str,
    mainHeadingGradient: str,
    mainHeadingEnd: str,
    description: str,
    primaryCtaText: str,
    primaryCtaUrl: str,
    secondaryCtaText: str,
    secondaryCtaUrl: str,
  });
  if (heroContent) content.hero = heroContent as LandingContent["hero"];
  const pricing = filled<LandingContent["pricing"]>(doc.pricing, {
    title: str,
    subtitle: str,
    starterMonthly: num,
    starterAnnual: num,
    growthMonthly: num,
    growthAnnual: num,
    carrierMonthly: num,
    carrierAnnual: num,
  });
  if (pricing) content.pricing = pricing as LandingContent["pricing"];
  const faqs = list(doc.faqs, (f) => {
    const q = str(f.q);
    const a = str(f.a);
    return q && a ? { q, a } : undefined;
  });
  if (faqs) content.faqs = faqs;
  const footer = filled<LandingContent["footer"]>(doc.footer, { description: str, copyrightYear: str, supportEmail: str, supportPhone: str });
  if (footer) content.footer = footer as LandingContent["footer"];

  const ticks = strList(hero.ticks);
  if (ticks) sections.heroTicks = ticks;
  const featureGroups = list(doc.featureGroups, (g) => {
    const title = str(g.title);
    const bullets = strList(g.bullets);
    return title && bullets ? { title, body: str(g.body) ?? "", icon: icon(g.icon, "router"), ...(g.icon === "mpesa" ? { mpesa: true } : {}), bullets } : undefined;
  });
  if (featureGroups) sections.featureGroups = featureGroups;
  const network = filled<LandingSections["network"]>(doc.network, { eyebrow: str, title: str, body: str, bullets: strList });
  if (network) sections.network = network as LandingSections["network"];
  const showcasePoints = strList(doc.showcasePoints);
  if (showcasePoints) sections.showcasePoints = showcasePoints;
  const steps = list(doc.steps, (s) => {
    const title = str(s.title);
    return title ? { title, body: str(s.body) ?? "" } : undefined;
  });
  if (steps) sections.steps = steps;
  const planIncludes = strList(doc.planIncludes);
  if (planIncludes) sections.planIncludes = planIncludes;
  const customerPoints = list(doc.customerPoints, (c) => {
    const title = str(c.title);
    return title ? { title, body: str(c.body) ?? "", icon: icon(c.icon, "users"), bullets: strList(c.bullets) ?? [] } : undefined;
  });
  if (customerPoints) sections.customerPoints = customerPoints;
  const operatorPoints = list(doc.operatorPoints, (o) => {
    const title = str(o.title);
    return title ? { title, body: str(o.body) ?? "", icon: icon(o.icon, "shield") } : undefined;
  });
  if (operatorPoints) sections.operatorPoints = operatorPoints;

  return { content, sections };
}

/** The published homepage document, or null when Sanity isn't set up, is unreachable, or has none. */
export async function fetchSanityHomepage(): Promise<SanityHomepage | null> {
  const config = sanityConfig();
  if (!config) return null;
  // The CDN serves published content fast; a token (for a private dataset) must go to the live API.
  const host = config.token ? "api" : "apicdn";
  const url = `https://${config.projectId}.${host}.sanity.io/v${API_VERSION}/data/query/${config.dataset}?query=${encodeURIComponent(HOMEPAGE_QUERY)}&perspective=published`;
  try {
    const res = await fetch(url, {
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : undefined,
      next: { revalidate: 300, tags: [HOMEPAGE_TAG] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: unknown };
    return mapHomepage(body.result);
  } catch {
    return null;
  }
}
