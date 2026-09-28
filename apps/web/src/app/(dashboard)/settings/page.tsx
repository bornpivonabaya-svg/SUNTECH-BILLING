"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { downloadFromApi } from "@/lib/download";
import { useLanguage } from "@/lib/language-context";
import { pageStrings } from "@/lib/page-strings";
import { useAuth } from "@/lib/auth-context";
import { Button, Card, ErrorText, HintText, Input, Label, Badge } from "@/components/ui";
import { IconCopy, IconCheck, IconMpesa, IconRouter, IconShield, IconPulse } from "@/components/icons";

interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  planTier: string;
  brandColor: string | null;
  logoUrl: string | null;
  platformUrl: string;
}

interface BillingData {
  subscription: {
    id: string;
    status: string;
    billingCycle: "MONTHLY" | "ANNUAL";
    plan: {
      id: string;
      name: string;
      slug: string;
      monthlyPriceMinor: number;
      annualPriceMinor: number | null;
      maxCustomers: number | null;
      maxRouters: number | null;
    };
  };
  usage: {
    customers: { used: number; limit: number | null };
    routers: { used: number; limit: number | null };
  };
  payments: Array<{
    id: string;
    amountMinor: number;
    phone: string | null;
    status: string;
    mpesaReceiptNumber: string | null;
    paidAt: string | null;
  }>;
}

const DEFAULT_BRAND_COLOR = "#2563eb";

const COMMON_TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Lagos",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Africa/Johannesburg",
  "UTC",
];

const COMMON_CURRENCIES = ["KES", "UGX", "TZS", "RWF", "NGN", "ZAR", "USD"];

export default function SettingsPage() {
  const { lang } = useLanguage();
  const t = pageStrings(lang).settings;
  const c = pageStrings(lang).common;
  const queryClient = useQueryClient();
  const { refresh, user } = useAuth();
  const isSuperAdmin = !user?.tenantId;

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [currency, setCurrency] = useState("");
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [logoUrl, setLogoUrl] = useState("");
  const [renewPhone, setRenewPhone] = useState("");
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [stkSent, setStkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  // Captive Portal Hotspot Branding & Numbers
  // Seeded empty, never with a sample identity: these are the values that get SAVED, so
  // pre-filling them with a real company's name and support number meant a tenant who opened
  // this page and pressed save silently published another ISP's contact details as their own.
  // The grey placeholders below still show the expected format.
  const [contactPhone, setContactPhone] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [welcomeTitle, setWelcomeTitle] = useState("FAST & SECURE WI-FI");
  const [bannerSubtitle, setBannerSubtitle] = useState("HIGH SPEED FIBER CONNECTION");
  const [activeThemeId, setActiveThemeId] = useState("suntech-blue");
  const [installationFee, setInstallationFee] = useState("1,500/-");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<TenantSettings>("/api/v1/settings"),
    enabled: !isSuperAdmin,
  });

  const { data: billing, isLoading: billingLoading } = useQuery({
    queryKey: ["billing"],
    queryFn: () => apiFetch<BillingData>("/api/v1/billing"),
    enabled: !isSuperAdmin,
  });

  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setTimezone(settings.timezone);
      setCurrency(settings.currency);
      setBrandColor(settings.brandColor ?? DEFAULT_BRAND_COLOR);
      setLogoUrl(settings.logoUrl ?? "");

      // Load tenant captive portal config
      void (async () => {
        try {
          const cfg = await apiFetch<any>(`/api/v1/hotspot/${settings.slug}/config`, { skipAuth: true });
          if (cfg) {
            if (cfg.phone) setContactPhone(cfg.phone);
            if (cfg.supportPhone) setSupportPhone(cfg.supportPhone);
            if (cfg.welcomeTitle) setWelcomeTitle(cfg.welcomeTitle);
            if (cfg.bannerSubtitle) setBannerSubtitle(cfg.bannerSubtitle);
            if (cfg.activeThemeId) setActiveThemeId(cfg.activeThemeId);
            if (cfg.installationFee) setInstallationFee(cfg.installationFee);
          }
        } catch {}
      })();
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      await apiFetch("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ name, timezone, currency, brandColor, logoUrl: logoUrl || null }),
      });
      // Never another ISP's: without this ISP's own address there's no sign-in page to update.
      const tenantSlug = settings?.slug || user?.tenantSlug;
      if (!tenantSlug) return;
      const captivePayload = {
        brandName: name.trim(),
        phone: contactPhone.trim(),
        supportPhone: supportPhone.trim(),
        welcomeTitle: welcomeTitle.trim(),
        bannerSubtitle: bannerSubtitle.trim(),
        activeThemeId,
        installationFee: installationFee.trim(),
      };
      try {
        localStorage.setItem(`mkg_hotspot_captive_config:${tenantSlug}`, JSON.stringify(captivePayload));
      } catch {}
      // Staff write — must carry the bearer token; only the matching GET is public.
      await apiFetch(`/api/v1/hotspot/${tenantSlug}/config`, {
        method: "PUT",
        body: JSON.stringify(captivePayload),
      });
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      void refresh();
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : t.failedSave),
  });

  const renewSubscription = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/billing/renew", {
        method: "POST",
        body: JSON.stringify({ phone: renewPhone.trim() }),
      }),
    onSuccess: () => {
      setStkSent(true);
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      setTimeout(() => {
        setStkSent(false);
        setShowRenewModal(false);
      }, 3000);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : t.failedRenew),
  });

  if (isSuperAdmin) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Platform Settings</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Super Administrator console has no individual tenant branding. Manage tenants from the Tenants menu.
          </p>
        </div>
        <Card className="p-6">
          <p className="text-xs text-slate-400">
            To view or modify individual ISP tenant configurations, please navigate to{" "}
            <a href="/tenants" className="text-brand-400 font-bold hover:underline">
              Tenant Organizations
            </a>.
          </p>
        </Card>
      </div>
    );
  }

  if (isLoading) return <p className="text-sm text-slate-500">{t.loadingSettings}</p>;

  const custUsed = billing?.usage?.customers?.used ?? 0;
  const custLimit = billing?.usage?.customers?.limit;
  const custPercent = custLimit ? Math.min(100, Math.round((custUsed / custLimit) * 100)) : 0;

  const routerUsed = billing?.usage?.routers?.used ?? 0;
  const routerLimit = billing?.usage?.routers?.limit;
  const routerPercent = routerLimit ? Math.min(100, Math.round((routerUsed / routerLimit) * 100)) : 0;

  const plan = billing?.subscription;
  // Usage bars only where there is a limit to fill; "Unlimited" has nothing to measure against.
  const usageRows = [
    { label: t.subscribers, hint: t.subscribersHint, used: custUsed, limit: custLimit, percent: custPercent },
    { label: t.routersUsage, hint: t.routersUsageHint, used: routerUsed, limit: routerLimit, percent: routerPercent },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{t.organization}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.organizationDesc}</p>
      </div>
      <Card className="space-y-5 p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-slate-400">{t.plan}</p>
            {plan ? (
              <p className="mt-0.5 text-[15px] font-semibold text-white">
                {plan.plan?.name ?? t.currentPlan}
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {[plan.billingCycle?.toLowerCase(), plan.status?.toLowerCase()].filter(Boolean).join(" · ")}
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-[15px] font-semibold text-white">{billingLoading ? c.loading : t.noActivePlan}</p>
            )}
          </div>
          <Button onClick={() => setShowRenewModal(true)} className="gap-1.5 self-start text-sm sm:self-auto">
            <IconMpesa size={14} />
            <span>{t.renewWithMpesa}</span>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {usageRows.map((row) => (
            <div key={row.label} className="space-y-2 rounded-lg border border-obsidian-800 bg-obsidian-950 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{row.label}</span>
                <span className="font-medium tabular-nums text-white">
                  {row.used} {row.limit ? t.of(row.limit) : t.noLimit}
                </span>
              </div>
              {row.limit ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-obsidian-800">
                  <div
                    className={`h-full ${row.percent > 85 ? "bg-rose-500" : row.percent > 60 ? "bg-amber-500" : "bg-brand-500"}`}
                    style={{ width: `${row.percent}%` }}
                  />
                </div>
              ) : null}
              <p className="text-xs text-slate-500">{row.hint}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card className="space-y-4 p-6">
        <div>
          <p className="text-sm text-slate-400">{t.webAddress}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate font-mono text-sm text-slate-200">{settings?.platformUrl}</span>
            <button
              type="button"
              onClick={() => {
                if (settings?.platformUrl) {
                  navigator.clipboard.writeText(settings.platformUrl);
                  setUrlCopied(true);
                  setTimeout(() => setUrlCopied(false), 2000);
                }
              }}
              className="shrink-0 text-slate-400 hover:text-white"
              title={t.copyWebAddress}
            >
              {urlCopied ? <IconCheck size={14} className="text-emerald-400" /> : <IconCopy size={14} />}
            </button>
          </div>
        </div>
        <p className="border-t border-obsidian-800 pt-4 text-sm text-slate-400">
          {t.ownDomain}{" "}
          <a href="/settings/domains" className="text-brand-400 hover:underline">
            {t.domainManagement}
          </a>
          .
        </p>
      </Card>
      <Card className="space-y-3 p-6">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">Your data</p>
          <p className="text-xs text-slate-500">Download everything as spreadsheets whenever you like. Your data is yours; the platform keeps daily backups on its side.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => downloadFromApi("/api/v1/customers/export.csv", "customers.csv").catch(() => {})}>
            Customers (CSV)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadFromApi("/api/v1/invoices/export.csv", "invoices.csv").catch(() => {})}>
            Invoices (CSV)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadFromApi("/api/v1/payments/export.csv", "payments.csv").catch(() => {})}>
            Payments (CSV)
          </Button>
        </div>
      </Card>

      {/* 3. BUSINESS BRANDING FORM */}
      <Card className="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="name">{t.businessName}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="slug">{t.tenantSlug}</Label>
            <Input id="slug" value={settings?.slug ?? ""} disabled />
            <HintText>{t.slugHint}</HintText>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="timezone">{t.timezone}</Label>
              <select
                id="timezone"
                className="w-full rounded-lg border border-slate-300/90 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {!COMMON_TIMEZONES.includes(timezone) && timezone && (
                  <option value={timezone}>{timezone}</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="currency">{t.defaultCurrency}</Label>
              <select
                id="currency"
                className="w-full rounded-lg border border-slate-300/90 bg-white px-3.5 py-2 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {!COMMON_CURRENCIES.includes(currency) && currency && (
                  <option value={currency}>{currency}</option>
                )}
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <HintText>{t.currencyHint}</HintText>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4 dark:border-obsidian-800">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{t.brandingSection}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="brandColor">{t.brandColor}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="brandColor"
                    type="color"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-obsidian-700 dark:bg-obsidian-950"
                  />
                  <Input
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    pattern="^#[0-9a-fA-F]{6}$"
                    placeholder="#2563eb"
                  />
                </div>
                <HintText>{t.brandColorHint}</HintText>
              </div>
              <div>
                <Label htmlFor="logoUrl">{t.logoUrl}</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://your-cdn.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
                <HintText>{t.logoHint}</HintText>
              </div>
            </div>
          </div>
          {/* Captive Portal Hotspot Contact & Banner Settings */}
          <div className="border-t border-slate-100 pt-4 dark:border-obsidian-800 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t.portalSection}
              </p>
              <HintText>{t.portalSectionHint}</HintText>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="contactPhone">{t.helplinePhone}</Label>
                <Input
                  id="contactPhone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className="font-mono"
                />
                <HintText>{t.helplineHint}</HintText>
              </div>
              <div>
                <Label htmlFor="supportPhone">{t.supportPhone}</Label>
                <Input
                  id="supportPhone"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className="font-mono"
                />
                <HintText>{t.supportHint}</HintText>
              </div>
              <div>
                <Label htmlFor="welcomeTitle">{t.welcomeTitle}</Label>
                <Input
                  id="welcomeTitle"
                  value={welcomeTitle}
                  onChange={(e) => setWelcomeTitle(e.target.value)}
                  placeholder="FAST &amp; SECURE WI-FI"
                />
              </div>
              <div>
                <Label htmlFor="bannerSubtitle">{t.bannerSubtitle}</Label>
                <Input
                  id="bannerSubtitle"
                  value={bannerSubtitle}
                  onChange={(e) => setBannerSubtitle(e.target.value)}
                  placeholder="HIGH SPEED FIBER CONNECTION"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? c.saving : c.saveChanges}
            </Button>
            {saved && <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{c.saved}</span>}
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Card>
      {/* RENEW / UPGRADE M-PESA MODAL */}
      {showRenewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 space-y-5 shadow-lg text-left font-sans">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div>
                <Badge variant="info">{t.renewBadge}</Badge>
                <h3 className="text-lg font-bold text-white mt-1">{t.renewTitle}</h3>
              </div>
              <button
                onClick={() => setShowRenewModal(false)}
                className="h-8 w-8 rounded-full bg-slate-900 text-slate-400 hover:text-white flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-mono space-y-1">
              <div className="text-slate-400">{t.plan}: <strong className="text-white">{billing?.subscription?.plan?.name ?? "Starter WISP"}</strong></div>
              <div className="text-slate-400">{t.amount}: <strong className="text-emerald-400">KES {billing?.subscription?.plan?.monthlyPriceMinor ? (billing.subscription.plan.monthlyPriceMinor / 100).toLocaleString() : "4,500"}</strong></div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stk-phone">{t.mpesaPhone}</Label>
              <Input
                id="stk-phone"
                value={renewPhone}
                onChange={(e) => setRenewPhone(e.target.value)}
                placeholder="0712345678"
                className="font-mono text-xs"
              />
              <HintText>{t.stkHint}</HintText>
            </div>
            {stkSent && (
              <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                {t.stkSent}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowRenewModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 text-xs font-bold"
              >
                {c.cancel}
              </button>
              <Button
                onClick={() => renewSubscription.mutate()}
                disabled={renewSubscription.isPending || !renewPhone.trim() || stkSent}
                className="text-xs font-medium gap-1.5"
              >
                {renewSubscription.isPending ? <IconPulse size={14} className="animate-spin" /> : <IconMpesa size={14} />}
                <span>{renewSubscription.isPending ? t.sendingStk : t.sendStk}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
