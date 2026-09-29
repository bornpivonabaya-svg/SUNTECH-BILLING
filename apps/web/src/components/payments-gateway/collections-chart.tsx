"use client";

import { useState } from "react";
import { formatKes } from "./kit";

export interface DailyPoint {
  day: string; // YYYY-MM-DD, Nairobi
  grossMinor: number;
  feeMinor: number;
  count: number;
}

const fmtDay = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });

function niceMax(v: number): number {
  if (v <= 0) return 100_00;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function compactKes(minor: number): string {
  const kes = minor / 100;
  if (kes >= 1_000_000) return `${(kes / 1_000_000).toLocaleString("en-KE", { maximumFractionDigits: 1 })}M`;
  if (kes >= 1_000) return `${(kes / 1_000).toLocaleString("en-KE", { maximumFractionDigits: 1 })}K`;
  return kes.toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

/**
 * Daily collections, 30 days. One series (gross collected), so no legend — the panel title names
 * it. Every bar has a hover/focus tooltip, and the same numbers are available as a table for
 * screen readers.
 */
export function CollectionsChart({ series, loading }: { series: DailyPoint[] | undefined; loading?: boolean }) {
  const [active, setActive] = useState<number | null>(null);

  if (loading || !series) {
    return <div className="h-56 animate-pulse rounded-md bg-obsidian-800" aria-label="Loading chart" />;
  }
  const total = series.reduce((t, p) => t + p.grossMinor, 0);
  if (total === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-md border border-dashed border-obsidian-800 text-center">
        <p className="text-sm font-medium text-slate-200">No collections in the last 30 days</p>
        <p className="mt-1 text-sm text-slate-400">Payments collected through the Suntech gateway will show here.</p>
      </div>
    );
  }

  const max = niceMax(Math.max(...series.map((p) => p.grossMinor)));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const point = active !== null ? series[active] : null;

  return (
    <div>
      <div className="relative flex h-56 gap-3">
        {/* y-axis */}
        <div className="flex w-10 shrink-0 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-slate-500" aria-hidden="true">
          {[...ticks].reverse().map((t) => (
            <span key={t}>{compactKes(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* grid */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden="true">
            {ticks.map((t) => (
              <div key={t} className="border-t border-obsidian-800" />
            ))}
          </div>
          {/* bars */}
          <div className="absolute inset-x-0 top-0 bottom-6 flex items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
            {series.map((p, i) => {
              const h = (p.grossMinor / max) * 100;
              return (
                <button
                  key={p.day}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  className="group relative flex h-full min-w-0 flex-1 items-end focus:outline-none"
                >
                  <span
                    className={`block w-full rounded-t-[4px] transition-colors ${active === i ? "bg-brand-500" : "bg-brand-600"}`}
                    style={{ height: `${Math.max(h, p.grossMinor > 0 ? 1.5 : 0)}%` }}
                  />
                </button>
              );
            })}
          </div>
          {/* x-axis labels: first, middle, last */}
          <div className="absolute inset-x-0 bottom-0 flex justify-between text-[11px] text-slate-500" aria-hidden="true">
            {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
              <span key={i}>{fmtDay.format(new Date(`${series[i]!.day}T00:00:00Z`))}</span>
            ))}
          </div>
          {point && active !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-obsidian-800 bg-obsidian-900 px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((active + 0.5) / series.length) * 100}%` }}
              role="status"
            >
              <p className="font-medium text-slate-100">{fmtDay.format(new Date(`${point.day}T00:00:00Z`))}</p>
              <p className="mt-0.5 tabular-nums text-slate-300">{formatKes(point.grossMinor)} collected</p>
              <p className="tabular-nums text-slate-400">
                {point.count} payment{point.count === 1 ? "" : "s"} · fees {formatKes(point.feeMinor)}
              </p>
            </div>
          )}
        </div>
      </div>
      <table className="sr-only">
        <caption>Daily collections for the last 30 days</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Collected</th>
            <th>Payments</th>
            <th>Fees</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{formatKes(p.grossMinor)}</td>
              <td>{p.count}</td>
              <td>{formatKes(p.feeMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
