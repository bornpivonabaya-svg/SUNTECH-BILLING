"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@/lib/landing-content";
import { DEFAULT_LANDING_SECTIONS, type LandingIcon, type LandingSections } from "@/lib/landing-sections";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SUPPORT_PHONE_DISPLAY, whatsappLink } from "@/components/marketing/brand";
import {
  IconArrowRight,
  IconCheck,
  IconGlobe,
  IconInvoice,
  IconMessage,
  IconLock,
  IconMpesa,
  IconPulse,
  IconRouter,
  IconShield,
  IconTicket,
  IconUsers,
  IconWhatsApp,
  type IconProps,
} from "@/components/icons";

type Icon = ComponentType<IconProps>;

const ICONS: Record<LandingIcon, Icon> = {
  router: IconRouter,
  mpesa: IconMpesa,
  growth: IconPulse,
  shield: IconShield,
  ticket: IconTicket,
  users: IconUsers,
  whatsapp: IconWhatsApp,
  invoice: IconInvoice,
  lock: IconLock,
  message: IconMessage,
  globe: IconGlobe,
};
const iconFor = (name: string): Icon => ICONS[name as LandingIcon] ?? IconCheck;

// ---------------------------------------------------------------------------------------------
// Copy. Every capability named below exists in this codebase — see the file noted beside each.
// ---------------------------------------------------------------------------------------------

/** Primary integrations (the hero strip). */
const INTEGRATIONS = [
  { name: "MikroTik", note: "RouterOS API" }, // packages/network/src/mikrotik
  { name: "M-Pesa", note: "Daraja STK & C2B", accent: true }, // packages/payments/src/mpesa
  { name: "FreeRADIUS", note: "AAA & accounting" }, // packages/radius, infrastructure/freeradius
  { name: "PPPoE", note: "Subscriber sessions" }, // router_pppoe_server migration
  { name: "WhatsApp", note: "OTP & notifications" }, // packages/whatsapp
];

/** Also supported, shown smaller so the headline row stays focused. */
const MORE_INTEGRATIONS = ["Paystack", "Pesapal", "Africa's Talking SMS", "WireGuard"];

/** Set to a plan name to give it the highlighted treatment. Left unset on purpose: there is no
 *  sales data in the project saying which plan most customers choose, and a "Most popular" badge
 *  is a factual claim. */

// ---------------------------------------------------------------------------------------------

/** One feature group. On phones only the first three points show until "Show more" is
 *  tapped, so the section isn't several screens long; from `sm` up every point is visible. */
function FeatureGroupCard({ group }: { group: LandingSections["featureGroups"][number] }) {
  const { title, body, mpesa, bullets } = group;
  const FeatureIcon = iconFor(group.icon);
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-md border ${
            mpesa ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"
          }`}
        >
          <FeatureIcon size={20} aria-hidden="true" />
        </span>
        <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
        {bullets.map((b, i) => (
          <li key={b} className={`gap-2 text-sm text-slate-700 ${i >= 3 && !open ? "hidden sm:flex" : "flex"}`}>
            <IconCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            {b}
          </li>
        ))}
      </ul>
      {bullets.length > 3 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-3 text-sm font-semibold text-blue-700 sm:hidden">
          {open ? "Show less" : `Show ${bullets.length - 3} more`}
        </button>
      )}
    </li>
  );
}

/** Remote WinBox through the platform, and the two VLANs behind a router. */
function NetworkDiagram() {
  return (
    <svg viewBox="0 0 520 300" role="img" aria-label="You connect WinBox to Suntech Billing, which reaches the router through its tunnel; behind the router a switch carries a hotspot VLAN and a PPPoE VLAN." className="h-auto w-full">
      <g fontFamily="inherit" fontSize="12">
        <rect x="10" y="20" width="130" height="54" rx="8" fill="#1e293b" stroke="#475569" />
        <text x="75" y="44" textAnchor="middle" fill="#f8fafc" fontWeight="600">You, in WinBox</text>
        <text x="75" y="61" textAnchor="middle" fill="#94a3b8" fontSize="10">office or phone</text>

        <line x1="140" y1="47" x2="200" y2="47" stroke="#94a3b8" strokeWidth="2" />
        <rect x="200" y="20" width="130" height="54" rx="8" fill="#1d4ed8" />
        <text x="265" y="44" textAnchor="middle" fill="#fff" fontWeight="600">Suntech Billing</text>
        <text x="265" y="61" textAnchor="middle" fill="#bfdbfe" fontSize="10">relay + billing</text>

        <path d="M330 47 H400 V110" fill="none" stroke="#34d399" strokeWidth="3" strokeDasharray="6 5" />
        <text x="410" y="80" fill="#6ee7b7" fontSize="10">encrypted tunnel</text>
        <text x="410" y="94" fill="#6ee7b7" fontSize="10">(works behind NAT)</text>

        <rect x="335" y="110" width="130" height="54" rx="8" fill="#1e293b" stroke="#60a5fa" />
        <text x="400" y="134" textAnchor="middle" fill="#f8fafc" fontWeight="600">Your MikroTik</text>
        <text x="400" y="151" textAnchor="middle" fill="#94a3b8" fontSize="10">SIM or fibre</text>

        <line x1="400" y1="164" x2="400" y2="190" stroke="#fbbf24" strokeWidth="3" />
        <rect x="335" y="190" width="130" height="36" rx="8" fill="#1e293b" stroke="#475569" />
        <text x="400" y="213" textAnchor="middle" fill="#f8fafc">Switch</text>

        <line x1="360" y1="226" x2="250" y2="250" stroke="#34d399" strokeWidth="2" />
        <rect x="150" y="244" width="150" height="46" rx="8" fill="#064e3b" stroke="#34d399" />
        <text x="225" y="264" textAnchor="middle" fill="#ecfdf5" fontWeight="600">Hotspot VLAN</text>
        <text x="225" y="280" textAnchor="middle" fill="#a7f3d0" fontSize="10">Wi-Fi, M-Pesa login</text>

        <line x1="440" y1="226" x2="440" y2="244" stroke="#38bdf8" strokeWidth="2" />
        <rect x="360" y="244" width="150" height="46" rx="8" fill="#0c4a6e" stroke="#38bdf8" />
        <text x="435" y="264" textAnchor="middle" fill="#f0f9ff" fontWeight="600">PPPoE VLAN</text>
        <text x="435" y="280" textAnchor="middle" fill="#bae6fd" fontSize="10">home and business lines</text>
      </g>
    </svg>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = "left",
  id,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: "left" | "center";
  id?: string;
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-sm font-semibold text-blue-700">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-4xl">
        {title}
      </h2>
      {body && <p className="mt-4 text-lg leading-8 text-slate-600">{body}</p>}
    </div>
  );
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const className =
    "inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

function formatKes(amount: number): string {
  return new Intl.NumberFormat("en-KE").format(amount);
}

/** A plan as /api/v1/public/plans returns it; prices in minor units (cents). */
export interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  /** The whole year's price, or null when the plan has no yearly price. */
  annualPriceMinor: number | null;
  trialDays: number;
  maxCustomers: number | null;
  maxRouters: number | null;
  isDefault: boolean;
}

const limitText = (n: number | null, what: string) => (n === null ? `Unlimited ${what}` : `Up to ${n.toLocaleString("en-KE")} ${what}`);

export function LandingClient({
  initialContent,
  sections: givenSections,
  plans: realPlans = [],
}: {
  initialContent?: LandingContent;
  sections?: LandingSections;
  plans?: PublicPlan[];
}) {
  const content = initialContent ?? DEFAULT_LANDING_CONTENT;
  const sections = givenSections ?? DEFAULT_LANDING_SECTIONS;
  const { hero, faqs, footer } = content;
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // The platform's real plans: the website never shows a price the platform doesn't charge.
  const plans = realPlans.map((p) => ({
    name: p.name,
    audience: `${limitText(p.maxRouters, "routers")} · ${limitText(p.maxCustomers, "customers")}`,
    trialDays: p.trialDays,
    monthly: Math.round(p.monthlyPriceMinor / 100),
    // Shown per month when billed yearly.
    yearly: Math.round((p.annualPriceMinor ?? p.monthlyPriceMinor * 12) / 1200),
  }));

  // Derived from the real prices, so the toggle label can never promise a discount the numbers
  // don't deliver (and disappears if annual isn't cheaper).
  const annualSaving = plans.length
    ? Math.round(Math.min(...plans.map((p) => (p.monthly > 0 ? (1 - p.yearly / p.monthly) * 100 : 0))))
    : 0;

  const salesLink = whatsappLink("Hello Suntech Billing, I'd like to talk to sales about the ISP platform.");

  return (
    <div className="force-light min-h-screen bg-white text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow"
      >
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* ------------------------------------------------------------------ HERO */}
        <section className="relative overflow-hidden border-b border-slate-200">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
          />
          <div className="relative mx-auto max-w-4xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:px-8">
            <div className="max-w-xl">
              {/* The hero is the copy the landing editor (Website › Landing page) edits; it used
                  to be hardcoded here, so edits saved but never showed. */}
              <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {hero.statusBadge}
              </p>
              <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-950 sm:text-5xl lg:text-[3.6rem]">
                {hero.mainHeadingStart} <span className="text-blue-700">{hero.mainHeadingGradient}</span> {hero.mainHeadingEnd}
              </h1>
              <p className="mt-6 text-lg leading-8 text-slate-600">{hero.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PrimaryButton href={hero.primaryCtaUrl || "/register"}>
                  {hero.primaryCtaText || "Get started"} <IconArrowRight size={16} />
                </PrimaryButton>
                <SecondaryButton href={hero.secondaryCtaUrl && !hero.secondaryCtaUrl.startsWith("#demo") ? hero.secondaryCtaUrl : "#product"}>
                  {hero.secondaryCtaText && !hero.secondaryCtaUrl?.startsWith("#demo") ? hero.secondaryCtaText : "See the product"} <IconArrowRight size={16} />
                </SecondaryButton>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                {sections.heroTicks.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <IconCheck size={16} className="text-emerald-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </section>

        {/* ---------------------------------------------------------- INTEGRATIONS */}
        <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-20 border-b border-slate-200 bg-slate-50/60">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <h2 id="integrations-title" className="text-center text-sm font-medium text-slate-500">
              Built for modern ISPs — works with
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-5">
              {INTEGRATIONS.map((item) => (
                <li key={item.name} className="flex flex-col items-center justify-center bg-white px-4 py-6 text-center last:col-span-2 sm:last:col-span-1">
                  <span className={`text-lg font-semibold tracking-tight ${item.accent ? "text-emerald-700" : "text-slate-900"}`}>
                    {item.name}
                  </span>
                  <span className="mt-1 text-xs text-slate-500">{item.note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-sm text-slate-500">
              Also connects with {MORE_INTEGRATIONS.slice(0, -1).join(", ")} and {MORE_INTEGRATIONS[MORE_INTEGRATIONS.length - 1]}.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------------- FEATURES */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <SectionHeading
              id="features-title"
              eyebrow="Features"
              title="Everything You Need to Run and Grow Your ISP"
              body="Network, billing, growth and your team — the tools a Kenyan ISP uses every day, connected so nothing is typed twice."
            />
            <ul className="mt-10 grid gap-4 sm:mt-14 md:grid-cols-2">
              {sections.featureGroups.map((group) => (
                <FeatureGroupCard key={group.title} group={group} />
              ))}
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------------- NETWORK HIGHLIGHT */}
        <section id="network" aria-labelledby="network-title" className="scroll-mt-20 border-t border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16 lg:px-8">
            <div>
              <p className="text-sm font-semibold text-blue-300">{sections.network.eyebrow}</p>
              <h2 id="network-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                {sections.network.title}
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">{sections.network.body}</p>
              <ul className="mt-6 space-y-3 text-sm text-slate-200">
                {sections.network.bullets.map((b) => (
                  <li key={b} className="flex gap-2.5">
                    <IconCheck size={17} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <NetworkDiagram />
          </div>
        </section>

        {/* -------------------------------------------------------------- SHOWCASE */}
        <section id="product" aria-labelledby="product-title" className="scroll-mt-20 border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <div>
              <SectionHeading
                id="product-title"
                eyebrow="The platform"
                title="A Complete ISP Management Solution"
                body="From subscriber management to payments and reporting, Suntech Billing gives you full control of your ISP business."
              />
              <ul className="mt-8 space-y-3.5">
                {sections.showcasePoints.map((point) => (
                  <li key={point} className="flex gap-3 text-[15px] text-slate-700">
                    <IconCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-10">
                <Link href="/register" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800">
                  Create your workspace <IconArrowRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- FOR YOUR CUSTOMERS */}
        <section id="customers" aria-labelledby="customers-title" className="scroll-mt-20 border-b border-slate-200">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <SectionHeading
              id="customers-title"
              eyebrow="For your customers"
              title="Self-service that keeps them paying"
              body="Your subscribers see your brand, not ours: a captive portal to buy Wi-Fi, a portal to pay bills, and messages that arrive where they already are."
            />
            <ul className="mt-10 grid gap-4 sm:mt-14 md:grid-cols-3">
              {sections.customerPoints.map(({ title, body, icon, bullets }) => {
                const PointIcon = iconFor(icon);
                return (
                <li key={title} className="rounded-lg border border-slate-200 bg-white p-6">
                  <span className="grid h-10 w-10 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700">
                    <PointIcon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-base font-semibold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
                  <ul className="mt-4 hidden space-y-2 sm:block">
                    {bullets.map((b) => (
                      <li key={b} className="flex gap-2 text-sm text-slate-700">
                        <IconCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------- HOW IT WORKS */}
        <section aria-labelledby="how-title">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <SectionHeading id="how-title" eyebrow="How it works" title="Live in five steps" align="center" />
            <ol className="relative mt-14 grid gap-0 lg:grid-cols-5 lg:gap-6">
              {sections.steps.map((step, i) => (
                <li key={step.title} className="relative flex gap-5 pb-10 last:pb-0 lg:block lg:pb-0">
                  {/* Connector: vertical on mobile, horizontal on desktop */}
                  {i < sections.steps.length - 1 && (
                    <>
                      <span aria-hidden="true" className="absolute left-5 top-11 bottom-1 w-px bg-slate-200 lg:hidden" />
                      <span aria-hidden="true" className="absolute left-14 right-0 top-5 hidden h-px bg-slate-200 lg:block" />
                    </>
                  )}
                  <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-sm font-semibold tabular-nums text-slate-900">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="pt-1.5 lg:pt-0">
                    <h3 className="text-base font-semibold text-slate-950 lg:mt-5">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------------------- PRICING */}
        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
              <SectionHeading
                id="pricing-title"
                eyebrow="Pricing"
                title="Simple, Transparent Pricing"
                body="Choose a plan that fits your ISP business."
              />
              <div role="group" aria-label="Billing period" className="inline-flex shrink-0 rounded-md border border-slate-300 bg-white p-1">
                {[
                  { label: "Monthly", value: false },
                  { label: annualSaving > 0 ? `Annual · save ${annualSaving}%` : "Annual", value: true },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setAnnual(opt.value)}
                    aria-pressed={annual === opt.value}
                    className={`rounded px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      annual === opt.value ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {plans.length === 0 && (
              <p className="mt-12 rounded-lg border border-slate-200 bg-white p-7 text-sm text-slate-600">
                Plans and prices are shown when you{" "}
                <Link href="/register" className="font-semibold text-blue-700 hover:text-blue-800">
                  create your workspace
                </Link>
                .
              </p>
            )}
            <ul className={`mt-12 grid gap-4 lg:grid-cols-3 ${plans.length === 0 ? "hidden" : ""}`}>
              {plans.map((plan) => {
                return (
                  <li
                    key={plan.name}
                    className="flex flex-col rounded-lg border border-slate-200 bg-white p-7"
                  >
                    <h3 className="text-lg font-semibold text-slate-950">{plan.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{plan.audience}</p>
                    <p className="mt-7 flex items-baseline gap-1.5">
                      <span className="text-sm font-medium text-slate-500">KES</span>
                      <span className="text-4xl font-semibold tabular-nums tracking-tight text-slate-950">
                        {formatKes(annual ? plan.yearly : plan.monthly)}
                      </span>
                      <span className="text-sm text-slate-500">/ month</span>
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {annual ? `Billed annually · KES ${formatKes(plan.yearly * 12)} per year` : "Billed monthly"}
                    </p>
                    <div className="mt-7">
                      <Link
                        href="/register"
                        className="block rounded-md border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
                      >
                        {plan.trialDays > 0 ? `Start ${plan.trialDays}-day free trial` : "Get Started"}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:gap-12">
                <div className="lg:w-64 lg:shrink-0">
                  <h3 className="text-base font-semibold text-slate-950">Included in every plan</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    No per-router licence fees. Plans are sized to your network — ask us if you&apos;re unsure which fits.
                  </p>
                </div>
                <ul className="grid flex-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  {sections.planIncludes.map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-slate-700">
                      <IconCheck size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- BUILT FOR OPERATORS */}
        <section id="about" aria-labelledby="about-title" className="scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-28 lg:px-8">
            <SectionHeading
              id="about-title"
              eyebrow="Built for ISP operators"
              title="Made for the way Kenyan ISPs actually work"
              body="Suntech Billing is built around M-Pesa, MikroTik and the day-to-day of running a network in Kenya — not adapted from software made for somewhere else."
            />
            <ul className="mt-10 grid gap-x-10 gap-y-6 sm:mt-14 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-3">
              {sections.operatorPoints.map(({ title, body, icon }) => {
                const PointIcon = iconFor(icon);
                return (
                <li key={title} className="flex gap-4">
                  <PointIcon size={20} className="mt-0.5 shrink-0 text-blue-700" aria-hidden="true" />
                  <div>
                    <h3 className="text-[15px] font-semibold text-slate-950">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">{body}</p>
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------------------- FAQ */}
        {faqs.length > 0 && (
          <section aria-labelledby="faq-title" className="border-t border-slate-200">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:px-8">
              <div>
                <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" />
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Something else?{" "}
                  <a href="#support" className="font-medium text-blue-700 hover:text-blue-800">
                    Talk to our team
                  </a>
                  .
                </p>
              </div>
              <dl className="divide-y divide-slate-200 border-y border-slate-200">
                {faqs.map((faq, index) => {
                  const isOpen = openFaq === index;
                  return (
                    <div key={faq.q}>
                      <dt>
                        <button
                          type="button"
                          onClick={() => setOpenFaq(isOpen ? null : index)}
                          aria-expanded={isOpen}
                          aria-controls={`faq-${index}`}
                          className="flex w-full items-start justify-between gap-6 py-5 text-left text-[15px] font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
                        >
                          <span>{faq.q}</span>
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-45" : ""}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          </span>
                        </button>
                      </dt>
                      <dd id={`faq-${index}`} hidden={!isOpen} className="pb-5 pr-10 text-sm leading-6 text-slate-600">
                        {faq.a}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------ SUPPORT + FINAL CTA */}
        <section id="support" aria-labelledby="cta-title" className="scroll-mt-20 bg-slate-950">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
              <div>
                <h2 id="cta-title" className="text-3xl font-semibold tracking-[-0.025em] text-white sm:text-4xl">
                  Ready to Run Your ISP Smarter?
                </h2>
                <p className="mt-4 max-w-xl text-lg leading-8 text-slate-300">
                  Manage your network, customers and payments from one powerful platform.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                  >
                    Get Started <IconArrowRight size={16} />
                  </Link>
                  <a
                    href={salesLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Contact Sales
                  </a>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6">
                <p className="text-sm font-semibold text-white">Talk to a person</p>
                <p className="mt-1.5 text-sm leading-6 text-slate-400">
                  Setup help, billing questions or a walkthrough — our team in Nairobi answers on WhatsApp.
                </p>
                <div className="mt-5 space-y-3 text-sm">
                  <a
                    href={whatsappLink("Hello Suntech Billing Support")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-slate-200 hover:text-white"
                  >
                    <IconWhatsApp size={18} className="text-emerald-400" aria-hidden="true" />
                    {SUPPORT_PHONE_DISPLAY}
                  </a>
                  {footer.supportEmail && (
                    <a href={`mailto:${footer.supportEmail}`} className="flex items-center gap-3 text-slate-200 hover:text-white">
                      <IconMessage size={18} className="text-slate-500" aria-hidden="true" />
                      {footer.supportEmail}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter supportEmail={footer.supportEmail} copyrightYear={footer.copyrightYear} />

      {/* Floating WhatsApp — kept from the previous homepage; it is the business's main support
          channel. Small and quiet so it never covers content on a phone. */}
      <a
        href={whatsappLink("Hello Suntech Billing, I have a question about the ISP platform.")}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Chat with Suntech Billing on WhatsApp (${SUPPORT_PHONE_DISPLAY})`}
        className="fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full bg-[#25D366] text-white shadow-[0_6px_20px_-6px_rgba(15,23,42,0.45)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
      >
        <IconWhatsApp size={24} />
      </a>
    </div>
  );
}
