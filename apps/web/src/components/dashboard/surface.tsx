"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Building blocks for the operator dashboard's dark theme: flat panels, one accent colour (the
 * tenant's brand scale), sentence-case labels and plain type. No gradients, glows or neumorphic
 * shadows — every page built from these reads as one product.
 */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <div className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-obsidian-800 bg-obsidian-900">
      {(title || actions) && (
        <div className="flex flex-col gap-3 border-b border-obsidian-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function MetricGrid({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 3 | 4 | 5 | 6 }) {
  const cols =
    // Two stays two at every width: for narrow columns (the customer portal) where a wide
    // viewport would otherwise squeeze four money values until they break mid-number.
    columns === 2 ? "" :
    // Six money-sized numbers do not fit six columns on a laptop; two rows of three read better.
    columns === 6 ? "lg:grid-cols-3" : columns === 5 ? "lg:grid-cols-3 xl:grid-cols-5" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return <div className={`grid grid-cols-2 gap-3 ${cols}`}>{children}</div>;
}

export function Metric({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  /** Colours the hint only — the number itself stays neutral so nothing shouts. */
  tone?: "good" | "warn" | "bad";
}) {
  const hintColour = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-rose-400" : "text-slate-400";
  const body = (
    <>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1.5 break-words text-lg font-semibold tabular-nums tracking-tight text-white sm:text-2xl">{value}</p>
      {hint && <p className={`mt-1 text-xs ${hintColour}`}>{hint}</p>}
    </>
  );
  const cls = "block min-w-0 rounded-xl border border-obsidian-800 bg-obsidian-900 px-4 py-4 sm:px-5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-obsidian-700 hover:bg-obsidian-800/60`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

/** Class string for buttons and button-styled links on dark pages. */
export function darkButton(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md"): string {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian-950 disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-500",
    secondary: "border border-obsidian-700 bg-obsidian-900 text-slate-200 hover:bg-obsidian-800",
    ghost: "text-slate-400 hover:bg-obsidian-800 hover:text-white",
  };
  return `${base} ${sizes[size]} ${variants[variant]}`;
}

export function TableShell({ children, minWidth = 640 }: { children: ReactNode; minWidth?: number }) {
  return (
    // relative: keeps absolutely positioned children (sr-only header labels) inside the scroller,
    // otherwise they escape it and widen the whole page on phones.
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export const th = "whitespace-nowrap border-b border-obsidian-800 px-5 py-2.5 text-xs font-medium text-slate-400";
export const td = "whitespace-nowrap border-b border-obsidian-800/70 px-5 py-3 text-slate-300";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{children}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

const TONES = {
  good: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  neutral: "border-obsidian-700 bg-obsidian-800 text-slate-300",
} as const;

export function Pill({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <div className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

/** A command or script to paste into a router, with a copy button. Pass `null` while loading. */
export function CodeBlock({ code, label, maxHeight = "12rem" }: { code: string | null; label?: string; maxHeight?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="overflow-hidden rounded-lg border border-obsidian-800 bg-obsidian-950">
      <div className="flex items-center justify-between gap-3 border-b border-obsidian-800 px-3 py-1.5">
        <span className="truncate text-xs text-slate-400">{label ?? "RouterOS terminal"}</span>
        <button
          type="button"
          disabled={!code}
          onClick={() => {
            if (!code) return;
            void navigator.clipboard.writeText(code);
            setCopied(true);
          }}
          className={darkButton("ghost", "sm")}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-slate-200" style={{ maxHeight }}>
        {code ?? "Generating…"}
      </pre>
    </div>
  );
}

/** Dialog for dark pages: closes on Escape and on a click outside it. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`my-8 flex max-h-[90vh] w-full ${width} flex-col rounded-xl border border-obsidian-800 bg-obsidian-900 text-slate-200`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-obsidian-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description && <div className="mt-0.5 text-sm text-slate-400">{description}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={darkButton("ghost", "sm")}>
            ✕
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-obsidian-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Segmented control for small option sets (date ranges, tabs within a panel). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-obsidian-700 bg-obsidian-950 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            o.value === value ? "bg-obsidian-800 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
