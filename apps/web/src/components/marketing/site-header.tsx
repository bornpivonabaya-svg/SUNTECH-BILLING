"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconClose, IconMenu } from "@/components/icons";
import { Logo } from "./brand";

/** Absolute (`/#…`) rather than bare hashes so the same header works on the legal and auth pages,
 *  where a bare `#pricing` would point at a section that page does not have. There is no blog
 *  link: the product has no blog, and a nav item that 404s costs more trust than it earns. */
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/#features", label: "Features" },
  { href: "/#customers", label: "For customers" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#integrations", label: "Integrations" },
  { href: "/#support", label: "Support" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b bg-white/90 backdrop-blur-md transition-[border-color,box-shadow] ${
        scrolled || open ? "border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Suntech Billing home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/login"
            className="rounded-md px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:hidden"
        >
          {open ? <IconClose size={20} /> : <IconMenu size={20} />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-slate-100 bg-white lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-7xl flex-col px-4 py-3 sm:px-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-3 text-[15px] font-medium text-slate-800 hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 pb-2">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-800"
              >
                Login
              </Link>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="rounded-md bg-blue-700 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Get Started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
