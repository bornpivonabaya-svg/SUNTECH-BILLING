"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { buildNavSections, findCurrentNav, isNavItemActive, type NavItem } from "@/lib/navigation";
import { TenantThemeStyle } from "@/components/tenant-theme-style";
import { TawkToWidget } from "@/components/tawk-to-widget";
import { DashboardBanners } from "@/components/dashboard-banners";
import { TrialExpiredBlocker } from "@/components/trial-expired-blocker";
import { NavIconGlyph } from "@/components/nav-icon";
import { CommandPalette, CommandPaletteTrigger, useCommandPalette } from "@/components/command-palette";
import { IconChevronRight, IconClose, IconLogOut, IconMenu } from "@/components/icons";
import { NotificationBell } from "@/components/notifications";
import { LanguageProvider, useLanguage } from "@/lib/language-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { localizeNavSections } from "@/lib/nav-strings";
import { dashboardStrings } from "@/lib/dashboard-strings";
import { Segmented } from "@/components/dashboard/surface";

/** The phone tab bar: the few pages an ISP opens many times a day, plus the full menu. */
const QUICK_HREFS = ["/dashboard", "/customers", "/online-users", "/payments", "/tenants", "/routers"];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      target={item.external ? "_blank" : undefined}
      rel={item.external ? "noopener" : undefined}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? "bg-obsidian-800 text-white" : "text-slate-400 hover:bg-obsidian-900 hover:text-slate-100"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-brand-400" : "text-slate-500 group-hover:text-slate-300"}`}>
        <NavIconGlyph name={item.icon} />
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function initialsOf(email: string | null | undefined): string {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "?";
  return name.slice(0, 2).toUpperCase();
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <DashboardShell>{children}</DashboardShell>
      </ThemeProvider>
    </LanguageProvider>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const t = dashboardStrings(lang);
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const palette = useCommandPalette();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Close the drawer whenever navigation happens. Without this, tapping a nav link on a phone
  // leaves the drawer covering the page you just asked for.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Escape closes it, and the page behind it must not scroll while it is open — a drawer you can
  // scroll the background through feels broken on touch.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileNavOpen]);

  const { data: liveChat } = useQuery({
    queryKey: ["live-chat-widget"],
    queryFn: () => apiFetch<{ show: boolean; widgetId: string | null }>("/api/v1/settings/live-chat/widget"),
    enabled: Boolean(user?.tenantId),
    staleTime: 5 * 60 * 1000,
  });

  // The sidebar, the palette and the breadcrumb all render from this one catalog
  // (lib/navigation.ts), so a page is never reachable from one and missing from another.
  const sections = useMemo(() => (user ? localizeNavSections(buildNavSections(user), lang) : []), [user, lang]);
  const current = useMemo(() => findCurrentNav(sections, pathname), [sections, pathname]);
  const quickItems = useMemo(() => {
    const all = sections.flatMap((sec) => sec.items);
    return QUICK_HREFS.map((h) => all.find((i) => i.href === h)).filter((i): i is NavItem => Boolean(i)).slice(0, 4);
  }, [sections]);

  // Opening the menu on a phone shows the current page, not the top of a long list.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const el = navRef.current?.querySelector('[aria-current="page"]');
    el?.scrollIntoView({ block: "center" });
  }, [mobileNavOpen]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-obsidian-950">
        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-obsidian-700 dark:border-t-transparent" aria-hidden="true" />
          {t.loading}
        </div>
      </div>
    );
  }
  if (!user) return null;

  const has = (permission: string) => user.permissions.includes(permission);
  const isTenantScoped = user.tenantId !== null;

  return (
    <TenantThemeStyle brandColor={user.tenantBrandColor}>
      <div className={`flex min-h-screen w-full overflow-x-hidden bg-obsidian-950 text-slate-100 antialiased selection:bg-brand-500/30 ${theme === "light" ? "theme-light" : ""}`}>
        {/* Backdrop for Mobile & Tablet (<1024px). Tapping off the drawer closes it. */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/70 transition-opacity lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Drawer:
            - Desktop (≥1024px): Static side column occupying 256px.
            - Mobile/Tablet (<1024px): Overlay drawer sliding in smoothly from the left. */}
        <aside
          id="dashboard-nav"
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-obsidian-800 bg-obsidian-950 text-slate-200 transition-transform duration-300 ease-in-out lg:static lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Brand Header */}
          <div className="flex h-14 items-center gap-3 border-b border-obsidian-800 px-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white">M</div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">MashupHost</span>
              <span className="block truncate text-xs text-slate-500">{user.tenantId ? user.tenantSlug ?? t.operator : t.platformAdmin}</span>
            </div>
            {/* Explicit Close Button for Mobile Drawer */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t.closeMenu}
              className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-obsidian-800 hover:text-white lg:hidden"
            >
              <IconClose size={20} />
            </button>
          </div>

          {/* Nav Links */}
          <nav ref={navRef} className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4 scrollbar-none" aria-label="Main">
            {sections.map((section, i) => (
              <div key={section.title ?? i}>
                {section.title && <p className="px-3 pb-1 pt-5 text-xs font-medium text-slate-500">{section.title}</p>}
                {section.items.map((item) => (
                  <NavLink key={item.href} item={item} active={current?.item.href === item.href || (!current && isNavItemActive(item, pathname))} />
                ))}
              </div>
            ))}
          </nav>

          {/* User Account Footer Card */}
          <div className="border-t border-obsidian-800 p-3">
            {/* Phones: the header has no room for these, so they live in the menu. */}
            <div className="mb-3 flex items-center justify-between gap-2 px-1 sm:hidden">
              <Segmented
                label={t.language}
                value={lang}
                onChange={setLang}
                options={[
                  { value: "en", label: "EN" },
                  { value: "sw", label: "SW" },
                ]}
              />
              <Segmented
                label={t.theme}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: t.dark },
                  { value: "light", label: t.light },
                ]}
              />
            </div>
            <div className="flex items-center gap-2.5 px-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-obsidian-800 text-xs font-medium text-slate-200">
                {initialsOf(user.email)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-100">{user.email ?? t.signedIn}</p>
                <p className="truncate text-xs text-slate-500">
                  {!user.tenantId ? t.superAdmin : has("reports.read") ? t.staff : t.customer}
                </p>
              </div>
              <button
                type="button"
                onClick={() => logout().then(() => router.replace("/login"))}
                title={t.signOut}
                aria-label={t.signOut}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-obsidian-800 hover:text-white"
              >
                <IconLogOut size={16} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col w-full overflow-x-hidden">
          {/* Top Bar for Desktop & Mobile */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-obsidian-800 bg-obsidian-950/95 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label={t.openMenu}
                aria-expanded={mobileNavOpen}
                aria-controls="dashboard-nav"
                className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-obsidian-800 hover:text-white lg:hidden"
              >
                <IconMenu size={20} />
              </button>
              {/* Where you are: section › page. On phones the section is dropped to leave room. */}
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
                {current?.section.title && (
                  <>
                    <span className="hidden truncate text-slate-500 sm:inline">{current.section.title}</span>
                    <IconChevronRight size={14} className="hidden shrink-0 text-slate-600 sm:inline" />
                  </>
                )}
                <span className="truncate font-medium text-slate-200" aria-current="page">
                  {current?.item.label ?? "MashupHost"}
                </span>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex">
              <Segmented
                label={t.language}
                value={lang}
                onChange={setLang}
                options={[
                  { value: "en", label: "EN" },
                  { value: "sw", label: "SW" },
                ]}
              />
              <Segmented
                label={t.theme}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: t.dark },
                  { value: "light", label: t.light },
                ]}
              />
              </div>
              <CommandPaletteTrigger onOpen={() => palette.setOpen(true)} />
              {isTenantScoped && <NotificationBell />}
              {user.tenantTrialEndsAt && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                    user.isTrialExpired
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      : "border-amber-500/25 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {user.isTrialExpired ? t.trialExpired : t.trial}
                </span>
              )}
            </div>
          </header>

          <main key={lang} className="mx-auto w-full min-w-0 max-w-7xl flex-1 overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8">
            <DashboardBanners />
            {user.isTrialExpired &&
            !pathname.startsWith("/settings/billing") &&
            !pathname.startsWith("/settings/account") ? (
              <TrialExpiredBlocker />
            ) : (
              children
            )}
          </main>
        </div>

        {/* Phone tab bar: the busiest pages one tap away, and the full menu. */}
        <nav
          aria-label={lang === "sw" ? "Kurasa kuu" : "Main pages"}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-obsidian-800 bg-obsidian-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <div className="mx-auto flex max-w-lg">
            {quickItems.map((item) => {
              const active = current?.item.href === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-400" : "text-slate-400"}`}
                >
                  <NavIconGlyph name={item.icon} />
                  <span className="max-w-full truncate px-1">{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t.openMenu}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${current && !quickItems.some((q) => q.href === current.item.href) ? "text-brand-400" : "text-slate-400"}`}
            >
              <IconMenu size={18} />
              <span>{lang === "sw" ? "Menyu" : "Menu"}</span>
            </button>
          </div>
        </nav>
        <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
        {liveChat?.show && <TawkToWidget widgetId={liveChat.widgetId} />}
      </div>
    </TenantThemeStyle>
  );
}
