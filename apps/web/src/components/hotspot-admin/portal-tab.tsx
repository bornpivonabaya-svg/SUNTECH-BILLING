"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { HintText, Input, Label } from "@/components/ui";
import { Notice, Panel, darkButton } from "@/components/dashboard/surface";
import { THEME_CATALOG, DEFAULT_THEME_ID, type ThemeId } from "@/components/hotspot/themes";
import { tr } from "@/lib/tr";
import { usePortalBase } from "@/lib/portal-url";

interface PortalConfig {
  activeThemeId?: string;
  phone?: string;
  supportPhone?: string;
  brandName?: string;
  welcomeTitle?: string;
  bannerSubtitle?: string;
  installationFee?: string;
}

/** Same key the portal reads for a staff member's own preview; kept in step with every save. */
const previewKey = (slug: string) => `mkg_hotspot_captive_config:${slug}`;

export function PortalTab({ tenantSlug }: { tenantSlug: string }) {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["hotspot-portal-config", tenantSlug],
    queryFn: () => apiFetch<PortalConfig>(`/api/v1/hotspot/${tenantSlug}/config`, { skipAuth: true }),
  });

  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [brandName, setBrandName] = useState("");
  const [welcomeTitle, setWelcomeTitle] = useState("");
  const [bannerSubtitle, setBannerSubtitle] = useState("");
  const [phone, setPhone] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [installationFee, setInstallationFee] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [portalUrl, setPortalUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!config) return;
    if (config.activeThemeId && THEME_CATALOG.some((t) => t.id === config.activeThemeId)) setTheme(config.activeThemeId as ThemeId);
    setBrandName(config.brandName ?? "");
    setWelcomeTitle(config.welcomeTitle ?? "");
    setBannerSubtitle(config.bannerSubtitle ?? "");
    setPhone(config.phone ?? "");
    setSupportPhone(config.supportPhone ?? "");
    setInstallationFee(config.installationFee ?? "");
  }, [config]);

  // The captive portal's address comes from the API's settings (see usePortalBase).
  const portalBase = usePortalBase();
  useEffect(() => {
    setPortalUrl(`${portalBase}/hotspot/${tenantSlug}`);
  }, [portalBase, tenantSlug]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const payload = {
      activeThemeId: theme,
      brandName: brandName.trim(),
      welcomeTitle: welcomeTitle.trim(),
      bannerSubtitle: bannerSubtitle.trim(),
      phone: phone.trim(),
      supportPhone: supportPhone.trim(),
      installationFee: installationFee.trim(),
    };
    try {
      await apiFetch(`/api/v1/hotspot/${tenantSlug}/config`, { method: "PUT", body: JSON.stringify(payload) });
      try {
        localStorage.setItem(previewKey(tenantSlug), JSON.stringify(payload));
      } catch {
        // Private mode: the live portal is already saved; only this browser's preview cache is skipped.
      }
      setSaved(true);
      setPreviewNonce((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: ["hotspot-portal-config", tenantSlug] });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      // Never report a failed publish as saved: customers would still see the old portal.
      setError(err instanceof ApiRequestError ? err.message : "Couldn't publish. Your customers still see the previous version.");
    } finally {
      setSaving(false);
    }
  };

  const previewSrc = `/hotspot/${tenantSlug}?theme=${theme}&preview=${previewNonce}`;
  const dirty =
    config !== undefined &&
    (theme !== (config.activeThemeId ?? DEFAULT_THEME_ID) ||
      brandName !== (config.brandName ?? "") ||
      welcomeTitle !== (config.welcomeTitle ?? "") ||
      bannerSubtitle !== (config.bannerSubtitle ?? "") ||
      phone !== (config.phone ?? "") ||
      supportPhone !== (config.supportPhone ?? "") ||
      installationFee !== (config.installationFee ?? ""));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        <Panel
          title={tr("Your portal link")}
          description={tr("Phones on your hotspot are sent here automatically. You can also share it.")}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 truncate rounded-lg border border-obsidian-800 bg-obsidian-950 px-3 py-2 font-mono text-[13px] text-slate-200">{portalUrl}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={darkButton("secondary", "sm")}
                onClick={() => {
                  void navigator.clipboard.writeText(portalUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <a href={portalUrl} target="_blank" rel="noopener noreferrer" className={darkButton("secondary", "sm")}>
                {tr("Open")}
              </a>
            </div>
          </div>
        </Panel>
        <form onSubmit={save} className="space-y-6">
          <Panel title={tr("Branding and contact")} description={tr("Shown to every customer on the Wi-Fi sign-in page.")}>
            {isLoading ? (
              <p className="text-sm text-slate-400">{tr("Loading…")}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="p-brand">{tr("Name on the portal")}</Label>
                  <Input id="p-brand" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={tr("Your business name")} />
                </div>
                <div>
                  <Label htmlFor="p-support">{tr("Support number")}</Label>
                  <Input id="p-support" inputMode="tel" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="07XX XXX XXX" />
                  <HintText>{tr("Customers can tap to call it.")}</HintText>
                </div>
                <div>
                  <Label htmlFor="p-title">{tr("Heading")}</Label>
                  <Input id="p-title" value={welcomeTitle} onChange={(e) => setWelcomeTitle(e.target.value)} placeholder={tr("Fast, reliable Wi-Fi")} maxLength={60} />
                </div>
                <div>
                  <Label htmlFor="p-sub">{tr("Subheading")}</Label>
                  <Input id="p-sub" value={bannerSubtitle} onChange={(e) => setBannerSubtitle(e.target.value)} placeholder={tr("Pay with M-Pesa and connect instantly")} maxLength={90} />
                </div>
                <div>
                  <Label htmlFor="p-phone">{tr("Home internet sales number")}</Label>
                  <Input id="p-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" />
                  <HintText>{tr("Shown with home internet (fibre) offers.")}</HintText>
                </div>
                <div>
                  <Label htmlFor="p-fee">{tr("Installation fee")}</Label>
                  <Input id="p-fee" value={installationFee} onChange={(e) => setInstallationFee(e.target.value)} placeholder={tr("e.g. KSh 1,500")} />
                </div>
              </div>
            )}
            <p className="mt-4 text-sm text-slate-400">
              Your logo and brand colour come from{" "}
              <Link href="/settings" className="text-brand-400 hover:underline">
                {tr("Settings")}
              </Link>
              .
            </p>
          </Panel>
          <Panel title={tr("Design")} description={tr("How the sign-in page looks. Suntech Clean loads fastest on phones.")}>
            <div className="grid gap-3 sm:grid-cols-2">
              {THEME_CATALOG.map((t) => {
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(t.id)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      active ? "border-brand-500 bg-brand-500/10" : "border-obsidian-800 bg-obsidian-950 hover:border-obsidian-700"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">{t.name.replace(/\s*\(.*\)$/, "")}</span>
                      {t.id === DEFAULT_THEME_ID && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">{tr("Recommended")}</span>}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">{t.description}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border border-obsidian-800 bg-obsidian-900/95 px-4 py-3">
            <span className="mr-auto text-sm text-slate-400">
              {saved ? <span className="text-emerald-300">{tr("Published. Customers see it now.")}</span> : dirty ? "You have unpublished changes." : "Everything is published."}
            </span>
            <button type="submit" className={darkButton("primary")} disabled={saving || !dirty}>
              {saving ? "Publishing…" : "Publish"}
            </button>
          </div>
        </form>
      </div>
      {/* Live phone preview of the real portal */}
      <div className="xl:sticky xl:top-20 xl:self-start">
        <p className="mb-2 text-sm text-slate-400">
          Preview{dirty ? " · text changes show after you publish" : ""}
        </p>
        <div className="mx-auto w-[340px] max-w-full rounded-2xl border border-obsidian-700 bg-obsidian-950 p-2.5 shadow-lg">
          <iframe key={previewSrc} src={previewSrc} title={tr("Portal preview")} className="h-[640px] w-full rounded-[1.7rem] bg-white" />
        </div>
      </div>
    </div>
  );
}
