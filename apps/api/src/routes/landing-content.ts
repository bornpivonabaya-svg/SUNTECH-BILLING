import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { successResponse } from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { writeAuditLog } from "../lib/audit.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

const landingContentSchema = z.object({
  announcement: z
    .object({ badge: z.string(), text: z.string(), linkText: z.string(), linkUrl: z.string() })
    .partial()
    .optional(),
  hero: z
    .object({
      statusBadge: z.string(),
      mainHeadingStart: z.string(),
      mainHeadingGradient: z.string(),
      mainHeadingEnd: z.string(),
      description: z.string(),
      primaryCtaText: z.string(),
      primaryCtaUrl: z.string(),
      secondaryCtaText: z.string(),
      secondaryCtaUrl: z.string(),
    })
    .partial()
    .optional(),
  roiCalculator: z
    .object({
      title: z.string(),
      subtitle: z.string(),
      defaultSubscribers: z.number(),
      defaultArpu: z.number(),
      currency: z.string(),
    })
    .partial()
    .optional(),
  scripts: z
    .object({ title: z.string(), subtitle: z.string(), defaultHost: z.string(), defaultSecret: z.string() })
    .partial()
    .optional(),
  pricing: z
    .object({
      title: z.string(),
      subtitle: z.string(),
      starterMonthly: z.number(),
      starterAnnual: z.number(),
      growthMonthly: z.number(),
      growthAnnual: z.number(),
      carrierMonthly: z.number(),
      carrierAnnual: z.number(),
    })
    .partial()
    .optional(),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  footer: z
    .object({ description: z.string(), copyrightYear: z.string(), supportEmail: z.string(), supportPhone: z.string() })
    .partial()
    .optional(),
});

export interface LandingContent {
  announcement: {
    badge: string;
    text: string;
    linkText: string;
    linkUrl: string;
  };
  hero: {
    statusBadge: string;
    mainHeadingStart: string;
    mainHeadingGradient: string;
    mainHeadingEnd: string;
    description: string;
    primaryCtaText: string;
    primaryCtaUrl: string;
    secondaryCtaText: string;
    secondaryCtaUrl: string;
  };
  roiCalculator: {
    title: string;
    subtitle: string;
    defaultSubscribers: number;
    defaultArpu: number;
    currency: string;
  };
  scripts: {
    title: string;
    subtitle: string;
    defaultHost: string;
    defaultSecret: string;
  };
  pricing: {
    title: string;
    subtitle: string;
    starterMonthly: number;
    starterAnnual: number;
    growthMonthly: number;
    growthAnnual: number;
    carrierMonthly: number;
    carrierAnnual: number;
  };
  faqs: Array<{
    q: string;
    a: string;
  }>;
  footer: {
    description: string;
    copyrightYear: string;
    supportEmail: string;
    supportPhone: string;
  };
}

export const DEFAULT_LANDING_CONTENT: LandingContent = {
  announcement: {
    badge: "ROUTEROS V7.14",
    text: "Automated WhatsApp Bot, Live Captive Portal Studio & GIS Outage Pinpointer",
    linkText: "Explore Live →",
    linkUrl: "#innovations",
  },
  hero: {
    // The heading is the strongest on-page ranking signal there is, and it previously named
    // neither what this is (a Wi-Fi billing system) nor where it operates (Kenya) — the two
    // things a buyer types into Google. Rewritten to say both in plain words, without becoming
    // a keyword list: it still reads as a sentence a human wrote.
    statusBadge: "M-Pesa billing · MikroTik · RADIUS · Hotspot vouchers",
    mainHeadingStart: "The Wi-Fi Billing System for",
    mainHeadingGradient: "ISPs in Kenya",
    mainHeadingEnd: "that pays you on time.",
    description:
      "Sell hotspot vouchers and monthly internet packages, take M-Pesa payments that activate service automatically, and manage every MikroTik router, PPPoE session and customer from one dashboard. Built for Kenyan WISPs, fibre ISPs and hotspot operators.",
    primaryCtaText: "Start 14-Day Free Trial",
    primaryCtaUrl: "/register",
    secondaryCtaText: "Live Console Sandbox",
    secondaryCtaUrl: "#demo",
  },
  roiCalculator: {
    title: "Calculate Your Prevented Revenue Leakage & Admin Time Saved",
    subtitle:
      "See the exact financial impact of automated Safaricom M-Pesa collections and instant MikroTik queue provisioning.",
    defaultSubscribers: 350,
    defaultArpu: 2500,
    currency: "KES",
  },
  scripts: {
    title: "Deploy to Any MikroTik Router in 30 Seconds",
    subtitle:
      "Paste these production-hardened commands directly into Winbox or SSH. Works with RouterOS v6.48+ and v7.12+.",
    defaultHost: "197.248.42.10",
    defaultSecret: "mkg_radius_secret_x91",
  },
  pricing: {
    title: "Predictable Plans Engineered for ISP Profitability",
    subtitle:
      "No hidden per-router licensing fees. All core RADIUS accounting, M-Pesa STK, and MikroTik sync features included.",
    starterMonthly: 3500,
    starterAnnual: 2800,
    growthMonthly: 7500,
    growthAnnual: 6000,
    carrierMonthly: 18000,
    carrierAnnual: 14400,
  },
  faqs: [
    // The first three exist because they are the questions a Kenyan operator types verbatim into
    // a search box. They are real answers, not keyword bait — a page that ranks for a question it
    // does not answer loses the visitor in seconds, which search engines measure.
    {
      q: "What is a Wi-Fi billing system, and do I need one in Kenya?",
      a: "A Wi-Fi billing system sells and enforces internet access automatically: a customer pays, the system issues them a voucher or activates their package, and the router lets them online for exactly what they paid for. If you run a hotspot or a small ISP in Kenya and you are still confirming M-Pesa messages by hand and typing usernames into your router, that is the manual work a billing system removes.",
    },
    {
      q: "Can customers pay for Wi-Fi with M-Pesa, and does it connect them automatically?",
      a: "Yes. A customer picks a package on your captive portal, receives an M-Pesa STK push on their phone, and once Safaricom confirms the payment their voucher is issued and their session starts — with no action from you. Paybill and Buy Goods (Till) numbers are both supported, and the money goes to your own M-Pesa account, not ours.",
    },
    {
      q: "Does it work with MikroTik routers I already own?",
      a: "Yes. Setup is a single script you paste into your router's terminal, which configures the hotspot, the captive portal, RADIUS authentication and the payment walled garden in one step. There is no proprietary hardware to buy and nothing to replace.",
    },
    {
      q: "Does Suntech work with both MikroTik RouterOS v6 and v7?",
      a: "Yes. When you add a router you pick v6 or v7 (or let the script detect it), and the setup script uses the right commands for that version. It talks to the router over MikroTik's standard API. Remote WinBox needs v7, because it runs over WireGuard, which v6 doesn't have.",
    },
    {
      q: "Can I open my router in WinBox remotely, even on a Safaricom or Airtel SIM?",
      a: "Yes. Each router connects out to Suntech over its own encrypted WireGuard tunnel, so it doesn't need a public IP or port forwarding and works behind carrier NAT. The dashboard gives you an address to type into WinBox, and you log in with the router's own admin account.",
    },
    {
      q: "Can I run hotspot and PPPoE on separate VLANs?",
      a: "Yes. Add a VLAN in the dashboard, choose Hotspot or Internet (PPPoE), give it a subnet, and the platform sets it up on the router for you: the VLAN on a free port, its addresses, and its own hotspot or PPPoE server. If the router is offline it finishes when the router comes back. An in-app manual shows how to patch the switch.",
    },
    {
      q: "How does M-Pesa reconciliation work?",
      a: "Payments by STK push, Paybill or Till are matched to the customer's account number automatically. The invoice is marked paid, the customer's service is switched back on at the router within about a minute, and they get a confirmation. Anything that can't be matched waits in a reconciliation list for you to assign.",
    },
    {
      q: "Can I manage several routers and sites?",
      a: "Yes. Add as many MikroTik routers as your plan allows, group them by branch, and watch each one's CPU, memory and uptime on health graphs. Staff are alerted when a router goes down, and config backups and RouterOS updates run on a schedule.",
    },
    {
      q: "Can agents or shops sell my vouchers?",
      a: "Yes. Invite agents with a link; they get their own simple app to sell vouchers and record sales, and you set their commission, track what each one owes you and record their payments.",
    },
    {
      q: "Does it support hotspot voucher printing?",
      a: "Yes. Generate voucher batches for any package and print them, including on small thermal receipt printers with a QR code the customer scans to log in. Vouchers can also be sent straight to a customer on WhatsApp.",
    },
    {
      q: "Can I use my own logo and domain?",
      a: "Yes. Your logo and colours appear on the dashboard, customer app and captive portal. Type your domain and Suntech detects who runs its DNS — Namecheap, GoDaddy, Hostinger, Cloudflare, Truehost and others — shows the exact record to add, and switches the domain on by itself once it's in place.",
    },
    {
      q: "Is it available in Kiswahili?",
      a: "Yes. The dashboard, the customer app, the captive portal and the support assistant all switch between English and Kiswahili.",
    },
  ],
  footer: {
    description:
      "ISP billing and hotspot software for Kenya: M-Pesa collections, MikroTik and RADIUS control, remote WinBox and automatic VLANs, in English and Kiswahili.",
    copyrightYear: "2026",
    supportEmail: "support@mashupkgrid.com",
    supportPhone: "+254 703 605 266",
  },
};

const STORAGE_FILE = path.resolve(process.cwd(), "landing-content.json");

function loadLandingContent(): LandingContent {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, "utf-8");
      return { ...DEFAULT_LANDING_CONTENT, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error("Error reading landing content file:", err);
  }
  return DEFAULT_LANDING_CONTENT;
}

function persistLandingContent(content: LandingContent): void {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(content, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing landing content file:", err);
  }
}

let cachedContent = loadLandingContent();

export async function landingContentRoutes(app: FastifyInstance): Promise<void> {
  // Public GET: anyone loading the landing page fetches current content
  app.get("/", { config: { audience: "public" } }, async (request, reply) => {
    reply.send(successResponse(cachedContent, request.id));
  });

  // Admin POST: update content
  app.post(
    "/",
    {
      config: { audience: "platform" },
      preHandler: [...preHandler, requirePermission("tenants.update")],
    },
    async (request, reply) => {
      const body = landingContentSchema.parse(request.body);
      // Merge one section at a time rather than a blind top-level spread: a caller updating
      // just `hero.primaryCtaText` should not wipe out the rest of `hero`'s fields.
      cachedContent = {
        announcement: { ...cachedContent.announcement, ...body.announcement },
        hero: { ...cachedContent.hero, ...body.hero },
        roiCalculator: { ...cachedContent.roiCalculator, ...body.roiCalculator },
        scripts: { ...cachedContent.scripts, ...body.scripts },
        pricing: { ...cachedContent.pricing, ...body.pricing },
        faqs: body.faqs ?? cachedContent.faqs,
        footer: { ...cachedContent.footer, ...body.footer },
      };
      persistLandingContent(cachedContent);

      await writeAuditLog({
        tenantId: null,
        actorUserId: request.user!.id,
        action: "landing_content.updated",
        resourceType: "LandingContent",
        resourceId: "global-landing",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse(cachedContent, request.id));
    }
  );
}
