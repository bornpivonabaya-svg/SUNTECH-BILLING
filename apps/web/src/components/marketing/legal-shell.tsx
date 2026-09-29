import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

const POLICIES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/refund-policy", label: "Refund & Billing Policy" },
  { href: "/age-policy", label: "Age & Protection Policy" },
] as const;

export type LegalSection = { title: string; body: ReactNode };

/** Shared layout for the policy pages. The policy wording itself lives in each page, unchanged —
 *  this only owns navigation and typography. */
export function LegalShell({
  active,
  title,
  category,
  effective,
  intro,
  notes,
  sections,
}: {
  active: (typeof POLICIES)[number]["href"];
  title: string;
  category: string;
  effective: string;
  intro: ReactNode;
  notes: string[];
  sections: LegalSection[];
}) {
  return (
    <div className="force-light min-h-screen bg-white text-slate-900 antialiased">
      <SiteHeader />

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16 lg:px-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Policies">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Legal</p>
            <ul className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {POLICIES.map((p) => {
                const isActive = p.href === active;
                return (
                  <li key={p.href} className="shrink-0">
                    <Link
                      href={p.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                        isActive ? "bg-slate-100 font-medium text-slate-950" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                      }`}
                    >
                      {p.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {notes.length > 0 && (
            <ul className="mt-6 hidden space-y-1.5 border-t border-slate-200 pt-5 text-xs text-slate-500 lg:block">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </aside>

        <article className="min-w-0 max-w-3xl">
          <p className="text-sm text-slate-500">
            {category} · Effective {effective}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">{intro}</p>

          <div className="mt-10 space-y-10 border-t border-slate-200 pt-10">
            {sections.map((s, i) => (
              <section key={s.title} aria-labelledby={`section-${i + 1}`}>
                <h2 id={`section-${i + 1}`} className="text-lg font-semibold text-slate-950">
                  <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                  {s.title}
                </h2>
                <p className="mt-3 text-[15px] leading-7 text-slate-700">{s.body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>

      <SiteFooter />
    </div>
  );
}
