/**
 * The site's own public origin, for canonical URLs, Open Graph tags, the sitemap and robots.
 *
 * Derived from NEXT_PUBLIC_PLATFORM_BASE_DOMAIN — already supplied as a build arg (see
 * docker-compose.prod.yml) — rather than a new variable, so there is one place a deployment
 * declares its domain and no way for the two to disagree. Absolute URLs matter here: a relative
 * og:image is ignored by every crawler and link-preview scraper, so a shared link renders with
 * no picture and no title.
 */
const BASE_DOMAIN = process.env.NEXT_PUBLIC_PLATFORM_BASE_DOMAIN?.trim();

export const SITE_URL = BASE_DOMAIN
  ? `https://${BASE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  : "https://isp.suntechke.com";

export const SITE_NAME = "Suntech Billing";

/** Public, indexable routes. Everything else — the dashboard, the captive portal, the customer
 *  app and every auth screen — is deliberately excluded; see robots.ts for why. */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/isp/registration", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/refund-policy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/age-policy", priority: 0.3, changeFrequency: "yearly" as const },
];
