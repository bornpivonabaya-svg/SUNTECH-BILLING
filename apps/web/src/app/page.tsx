import type { Metadata, Viewport } from "next";
import { LandingClient } from "./landing-client";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@/lib/landing-content";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { DEFAULT_LANDING_SECTIONS, type LandingSections } from "@/lib/landing-sections";
import { fetchSanityHomepage } from "@/lib/sanity";

/**
 * Fetches the operator's published landing copy on the server.
 *
 * This is what makes the landing editor real. Saving already persisted to the API correctly, but
 * the page only ever read localStorage — so the edits showed up in the editor's own browser and
 * nowhere else, and every visitor (and every crawler) got the built-in defaults. Reading it here,
 * server-side, also puts the real headline and description into the initial HTML, which is the
 * copy search engines actually index.
 *
 * Any failure falls back to the defaults rather than erroring: the marketing page must render
 * even when the API is down, which is precisely when someone is most likely to be looking at it.
 */
async function loadLandingContent(): Promise<LandingContent> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return DEFAULT_LANDING_CONTENT;

  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/landing-content`, {
      // Cached and refreshed in the background: this is marketing copy that changes rarely, and
      // a per-visit fetch would put the API on the critical path of the busiest public page.
      next: { revalidate: 60 },
    });
    if (!response.ok) return DEFAULT_LANDING_CONTENT;
    const body = (await response.json()) as { data?: Partial<LandingContent> };
    const content = body?.data;
    if (!content || typeof content !== "object") return DEFAULT_LANDING_CONTENT;

    // Merged section by section so a partially-filled stored record cannot blank out a whole
    // block of the page — the same shape getLandingContent applies to its own reads.
    return {
      ...DEFAULT_LANDING_CONTENT,
      ...content,
      announcement: { ...DEFAULT_LANDING_CONTENT.announcement, ...(content.announcement ?? {}) },
      hero: { ...DEFAULT_LANDING_CONTENT.hero, ...(content.hero ?? {}) },
      roiCalculator: { ...DEFAULT_LANDING_CONTENT.roiCalculator, ...(content.roiCalculator ?? {}) },
      scripts: { ...DEFAULT_LANDING_CONTENT.scripts, ...(content.scripts ?? {}) },
      pricing: { ...DEFAULT_LANDING_CONTENT.pricing, ...(content.pricing ?? {}) },
      faqs: Array.isArray(content.faqs) && content.faqs.length > 0 ? content.faqs : DEFAULT_LANDING_CONTENT.faqs,
      footer: { ...DEFAULT_LANDING_CONTENT.footer, ...(content.footer ?? {}) },
    };
  } catch {
    return DEFAULT_LANDING_CONTENT;
  }
}

/**
 * Server wrapper around the (client) landing page.
 *
 * The page itself needs "use client" for its interactive sections, and a client component cannot
 * export `metadata` or render server-side JSON-LD. Splitting the shell out is the standard way to
 * get both: this file is what search engines and link scrapers read, `landing-client.tsx` is what
 * the browser hydrates.
 */
/** The homepage is a light design; the root layout colours the mobile browser bar for the dark
 *  dashboard. */
export const viewport: Viewport = { themeColor: "#ffffff" };

export const metadata: Metadata = {
  // Carries the brand explicitly. A parent layout's title template does not apply to its own
  // segment, and the homepage shares the root segment — so without the name here the most
  // important result on the site would be the one page whose title never says who it is.
  // Keyword phrase first, brand last: search results truncate from the right, so the words a
  // buyer searched stay visible while the name still appears. A parent layout's title template
  // does not apply to its own segment, so the brand has to be written in here.
  title: "Wi-Fi Billing System for ISPs in Kenya · MashupHost",
  description:
    "Wi-Fi billing system built for Kenyan ISPs and hotspot operators. Sell time and data vouchers, take M-Pesa payments that activate service automatically, and manage MikroTik routers, RADIUS and customers from one dashboard.",
  alternates: { canonical: "/" },
};

/**
 * Organization structured data. This is what lets a search engine show the business name, logo
 * and contact route as a rich result rather than a plain blue link — and it is the one piece of
 * SEO that cannot be inferred from the page copy, because nothing in the HTML says "this string
 * is our legal name and this image is our logo".
 */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/logo.jpg`,
  description:
    "Wi-Fi and internet billing software for internet service providers and hotspot operators in Kenya.",
  address: { "@type": "PostalAddress", addressCountry: "KE" },
  areaServed: { "@type": "Country", name: "Kenya" },
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  inLanguage: "en-KE",
  description:
    "Wi-Fi billing system for ISPs in Kenya: hotspot voucher sales, M-Pesa collection, MikroTik router management and RADIUS authentication.",
  // No aggregateRating here. Review markup without real, collected reviews behind it is
  // fabricated data — it violates Google's guidelines and earns a manual action, not a rich
  // result. Add it only once genuine reviews exist to point at.
};

/**
 * Sanity, when it's set up, has the last word: each section it has filled replaces the same
 * section from the landing editor (or the built-in defaults); anything left empty there keeps
 * what the page had. Without SANITY_PROJECT_ID this is exactly the old behaviour.
 */
async function loadHomepage(): Promise<{ content: LandingContent; sections: LandingSections }> {
  const [base, cms] = await Promise.all([loadLandingContent(), fetchSanityHomepage()]);
  if (!cms) return { content: base, sections: DEFAULT_LANDING_SECTIONS };
  const c = cms.content;
  return {
    content: {
      ...base,
      announcement: { ...base.announcement, ...(c.announcement ?? {}) },
      hero: { ...base.hero, ...(c.hero ?? {}) },
      pricing: { ...base.pricing, ...(c.pricing ?? {}) },
      faqs: c.faqs ?? base.faqs,
      footer: { ...base.footer, ...(c.footer ?? {}) },
    },
    sections: {
      ...DEFAULT_LANDING_SECTIONS,
      ...cms.sections,
      network: { ...DEFAULT_LANDING_SECTIONS.network, ...(cms.sections.network ?? {}) },
    },
  };
}

export default async function Page() {
  const { content: landingContent, sections } = await loadHomepage();

  /**
   * FAQ rich-result markup, built from the FAQs actually rendered on the page — never a separate
   * hand-written list, which would drift from the visible copy and is exactly what Google
   * penalises as mismatched structured data. Answers are plain text: the schema must match what
   * a visitor reads.
   */
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: landingContent.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // Static, developer-authored objects — no user input reaches this string.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      {landingContent.faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <LandingClient initialContent={landingContent} sections={sections} />
    </>
  );
}
