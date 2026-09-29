import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./brand";

/** Frame for the single-card account screens (forgot/reset password, email verification, 404):
 *  light, quiet, and visibly the same product as the homepage and sign-in page. */
export function AuthShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="force-light flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Suntech home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <Logo />
        </Link>
        <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-950">
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
        <div
          className={`w-full ${wide ? "max-w-lg" : "max-w-md"} rounded-lg border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.18)] sm:p-8`}
        >
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">{title}</h1>
          {description && <div className="mt-2 text-sm leading-6 text-slate-600">{description}</div>}
          <div className="mt-7">{children}</div>
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-6 text-xs text-slate-500">
        <span>© {new Date().getFullYear()} Suntech</span>
        <Link href="/terms" className="hover:text-slate-800">Terms</Link>
        <Link href="/refund-policy" className="hover:text-slate-800">Refunds</Link>
      </footer>
    </div>
  );
}

/** Primary action styling shared by the account screens. */
export const authPrimaryButton =
  "flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export const authSecondaryButton =
  "flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

export function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
}
