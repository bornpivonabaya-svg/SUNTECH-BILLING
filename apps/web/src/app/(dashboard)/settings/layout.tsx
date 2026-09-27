"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language-context";
import { pageStrings } from "@/lib/page-strings";
import {
  IconMaintenance,
  IconPalette,
  IconRouter,
  IconTicket,
  IconMpesa,
  IconInvoice,
  IconMessage,
  IconWebhook,
  IconLock,
  IconChevronRight,
  IconSparkles,
  IconChat,
  IconGlobe,
  IconLayers,
  IconBell,
} from "@/components/icons";

interface SettingsNavItem {
  href: string;
  label: string;
  hint: string;
  icon: ReactNode;
  show: boolean;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const has = (permission: string) => user?.permissions.includes(permission) ?? false;
  const { lang } = useLanguage();
  const t = pageStrings(lang).settings;

  const groups: SettingsNavGroup[] = [
    {
      label: t.groupGeneral,
      items: [
        {
          href: "/settings",
          label: t.branding,
          hint: t.brandingHint,
          icon: <IconPalette size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/domains",
          label: t.domains,
          hint: t.domainsHint,
          icon: <IconGlobe size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/branches",
          label: t.branches,
          hint: t.branchesHint,
          icon: <IconGlobe size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/alerts",
          label: t.alerts,
          hint: t.alertsHint,
          icon: <IconBell size={16} />,
          show: true,
        },
        {
          href: "/settings/reminders",
          label: t.reminders,
          hint: t.remindersHint,
          icon: <IconMessage size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/staff",
          label: t.staff,
          hint: t.staffHint,
          icon: <IconLock size={16} />,
          show: has("staff.manage"),
        },
        {
          href: "/settings/billing",
          label: t.mySubscription,
          hint: t.mySubscriptionHint,
          icon: <IconLayers size={16} />,
          show: has("settings.manage"),
        },
      ],
    },
    {
      label: t.groupNetwork,
      items: [
        {
          href: "/routers",
          label: t.routers,
          hint: t.routersHint,
          icon: <IconRouter size={16} />,
          show: has("routers.read"),
        },
        {
          href: "/vouchers",
          label: t.hotspot,
          hint: t.hotspotHint,
          icon: <IconTicket size={16} />,
          show: has("radius.manage"),
        },
      ],
    },
    {
      label: t.groupBilling,
      items: [
        {
          // One entry covering every way of getting paid — see the tabbed page for why these
          // stopped being three separate destinations.
          href: "/payments-setup",
          label: t.gettingPaid,
          hint: t.gettingPaidHint,
          icon: <IconMpesa size={16} />,
          show: has("settings.manage") || has("payments.reconcile"),
        },
        {
          href: "/sms",
          label: t.communications,
          hint: t.communicationsHint,
          icon: <IconMessage size={16} />,
          show: has("settings.manage"),
        },
      ],
    },
    {
      label: t.groupIntegrations,
      items: [
        {
          href: "/settings/ai-assistant",
          label: t.aiAssistant,
          hint: t.aiAssistantHint,
          icon: <IconSparkles size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/developer",
          label: t.developer,
          hint: t.developerHint,
          icon: <IconWebhook size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/whatsapp",
          label: t.whatsapp,
          hint: t.whatsappHint,
          icon: <IconMessage size={16} />,
          show: has("settings.manage"),
        },
        {
          href: "/settings/live-chat",
          label: t.liveChat,
          hint: t.liveChatHint,
          icon: <IconChat size={16} />,
          show: has("settings.manage"),
        },
      ],
    },
    {
      label: t.groupAccount,
      items: [
        {
          href: "/settings/account",
          label: t.password,
          hint: t.passwordHint,
          icon: <IconLock size={16} />,
          show: true,
        },
      ],
    },
  ];

  const isActive = (href: string) => pathname === href;
  const visibleItems = groups.flatMap((g) => g.items.filter((i) => i.show));

  // Phones: the section list is one scrollable row, so the page itself starts near the top
  // instead of under a screen-long menu. The current section is scrolled into view.
  const activeChip = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeChip.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <aside className="min-w-0 shrink-0 lg:w-64">
        <div className="mb-3 lg:mb-4">
          <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white lg:text-2xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <IconMaintenance size={18} />
            </span>
            {t.heading}
          </h1>
        </div>
        <nav aria-label={t.heading} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden">
          <div className="flex w-max gap-2">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                ref={isActive(item.href) ? activeChip : undefined}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
                  isActive(item.href)
                    ? "border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/70 dark:text-brand-300"
                    : "border-slate-200 text-slate-600 dark:border-obsidian-700 dark:text-slate-300"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
        <nav className="hidden space-y-5 lg:block">
          {groups.map((group) => {
            const visible = group.items.filter((item) => item.show);
            if (visible.length === 0) return null;
            return (
              <div key={group.label}>
                <p className="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {visible.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm transition-all ${
                        isActive(item.href)
                          ? "bg-brand-50 text-brand-700 font-semibold dark:bg-brand-950/70 dark:text-brand-300"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-obsidian-850"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={
                            isActive(item.href)
                              ? "text-brand-600 dark:text-brand-400"
                              : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                          }
                        >
                          {item.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{item.label}</span>
                          <span className="block truncate text-[11px] font-normal text-slate-400">{item.hint}</span>
                        </span>
                      </span>
                      <IconChevronRight
                        size={14}
                        className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
