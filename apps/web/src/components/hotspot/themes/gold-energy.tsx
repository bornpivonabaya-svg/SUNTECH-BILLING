"use client";

import { portalStrings } from "@/lib/portal-strings";

import React, { useState } from "react";
import { type CaptiveThemeProps, getSocialAppMeta } from "./types";
import {
  CARTOON_3D_CATALOG,
  Cartoon3DCharacterId,
} from "./cartoon-mascot-card";

function WifiIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
    </svg>
  );
}

function PhoneIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ShieldIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ZapIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function GlobeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function RefreshIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function TvIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
      <polyline points="17 2 12 7 7 2" />
    </svg>
  );
}

function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronDownIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SparklesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

function FlameIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function CloseIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function formatDurationTitle(name: string, minutes: number): string {
  if (name && name.length <= 10) return name;
  if (minutes < 60) return `${minutes}mins`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}hour${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "25hrs";
  if (days === 3) return "3Days";
  if (days === 5) return "5Days";
  if (days === 7) return "weekly";
  if (days === 30) return "monthly";
  return `${days}Days`;
}

function formatPriceKsh(priceMinor: number): string {
  const ksh = Math.round(priceMinor / 100);
  return `KSH:${ksh}/-`;
}

function formatPackageSpeed(downloadKbps: number | null, dataCapMb: number | null): string {
  if (dataCapMb && dataCapMb > 0) {
    const capStr = dataCapMb >= 1024 ? `${(dataCapMb / 1024).toFixed(0)}GB` : `${dataCapMb}MB`;
    return downloadKbps ? `${Math.round(downloadKbps / 1000)}Mbps • ${capStr}` : capStr;
  }
  if (downloadKbps && downloadKbps > 0) {
    return `${Math.round(downloadKbps / 1000)}Mbps Unlimited`;
  }
  return "Unlimited Speed";
}

const CARD_COLORS = [
  "border-blue-500 shadow-blue-500/40 ring-1 ring-blue-400/50",
  "border-indigo-500 shadow-indigo-500/40 ring-1 ring-indigo-400/50",
  "border-purple-500 shadow-purple-500/40 ring-1 ring-purple-400/50",
  "border-pink-500 shadow-pink-500/40 ring-1 ring-pink-400/50",
  "border-amber-500 shadow-amber-500/40 ring-1 ring-amber-400/50",
  "border-emerald-500 shadow-emerald-500/40 ring-1 ring-emerald-400/50",
  "border-violet-500 shadow-violet-500/40 ring-1 ring-violet-400/50",
  "border-teal-500 shadow-teal-500/40 ring-1 ring-teal-400/50",
  "border-red-500 shadow-red-500/40 ring-1 ring-red-400/50",
];

// Diverse 3D character roster across the 9 package cards
const CARTOON_3D_ROSTER: {
  id: Cartoon3DCharacterId;
  name: string;
  cardTemplate?: string;
  charImage?: string;
}[] = [
  { id: "yellow-boy", name: "Yellow Hoodie Boy", cardTemplate: "/cartoons/card-template-boy.jpg" },
  { id: "tom-cat", name: "Tom Cat", cardTemplate: "/cartoons/card-template-tom.jpg" },
  { id: "jerry-mouse", name: "Jerry Mouse", charImage: "/cartoons/jerry-mouse.jpg" },
  { id: "spongebob", name: "SpongeBob", charImage: "/cartoons/spongebob.jpg" },
  { id: "ben-10", name: "Ben 10", charImage: "/cartoons/ben-10.jpg" },
  { id: "spider-hero", name: "Spider-Man", charImage: "/cartoons/spider-hero.jpg" },
  { id: "bugs-bunny", name: "Bugs Bunny", charImage: "/cartoons/bugs-bunny.jpg" },
  { id: "wendy-girl", name: "Wendy", charImage: "/cartoons/wendy-girl.jpg" },
  { id: "yellow-boy", name: "Yellow Hoodie Boy", cardTemplate: "/cartoons/card-template-boy.jpg" },
];

export function GoldEnergyTheme({
  t = portalStrings("en"),
  tenantSlug,
  tenantName,
  contactPhone,
  supportPhone,
  welcomeTitle,
  bannerSubtitle,
  logoUrl,
  packages,
  loadingPackages,
  onSelectPackage,
  onOpenVoucherModal,
  onOpenAccountModal,
  onOpenTvModal,
  voucherResult,
  accountResult,
  completingRouterLogin,
}: CaptiveThemeProps) {
  const displayName = tenantName.toUpperCase();
  // No fallback number. This used to default to one specific ISP's support line, so any tenant
  // who had not set a contact number showed a competitor's phone number to their own customers,
  // in a "Call us" banner, as a tap-to-dial link. The whole contact strip is hidden instead when
  // there is nothing real to show.
  const phoneToDisplay = contactPhone || supportPhone || "";
  const welcomeText = welcomeTitle || "WELCOME";
  const subtitleText = bannerSubtitle || "Fast & Reliable";
  const [activeMascotId, setActiveMascotId] = useState<Cartoon3DCharacterId | "cycle-all">("cycle-all");
  const [showMascotPicker, setShowMascotPicker] = useState(false);

  const selectedMeta = CARTOON_3D_CATALOG.find((c) => c.id === activeMascotId) || CARTOON_3D_CATALOG[0]!;

  return (
    <div className="min-h-screen bg-black text-white relative overflow-x-hidden font-sans pb-24 select-none">
      {/* Dynamic Golden Fluid Energy Wave Background matching Screenshot */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 opacity-50">
        <div className="absolute top-1/4 right-0 w-[500px] h-[500px] bg-gradient-to-l from-amber-500/20 via-yellow-500/10 to-transparent blur-3xl" />
        <div className="absolute bottom-10 left-0 w-[600px] h-[600px] bg-gradient-to-r from-yellow-600/15 via-amber-400/10 to-transparent blur-3xl" />
        <svg className="absolute inset-0 w-full h-full opacity-70" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M -100 200 C 200 400, 300 100, 600 350 C 900 600, 1000 300, 1200 700 C 1300 900, 1100 1100, 1300 1300"
            fill="none"
            stroke="url(#goldGradient)"
            strokeWidth="42"
            strokeLinecap="round"
            filter="blur(16px)"
          />
          <defs>
            <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="1" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.7" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-3.5 pt-3">
        {/* Top Header Banner matching Screenshot */}
        <div className="rounded-3xl bg-white text-slate-900 shadow-2xl overflow-hidden border border-yellow-400/40 relative">
          {/* Decorative Dot Matrix on top corners */}
          <div className="absolute top-2 left-2 grid grid-cols-4 gap-1 opacity-60 pointer-events-none">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
            ))}
          </div>
          <div className="absolute top-2 right-2 grid grid-cols-4 gap-1 opacity-60 pointer-events-none">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
            ))}
          </div>

          <div className="p-3.5 relative z-10">
            {/* Header Flex: Left Info + Right Woman Portrait */}
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-8 space-y-2">
                {/* Logo & Brand */}
                <div className="flex items-center gap-2">
                  {/* Tenant logo when set; the WifiIcon badge is the fallback for a tenant who
                      has not uploaded one, never a broken image. */}
                  {logoUrl ? (
                    <div className="h-10 w-10 rounded-full bg-white p-0.5 shadow-md shrink-0 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a tenant-supplied
                          external URL, not a local asset next/image can optimise. */}
                      <img
                        src={logoUrl}
                        alt={displayName}
                        className="h-full w-full rounded-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-blue-700 via-blue-600 to-amber-500 p-0.5 shadow-md flex items-center justify-center shrink-0">
                      <div className="h-full w-full bg-white rounded-full flex items-center justify-center text-blue-700">
                        <WifiIcon className="w-5 h-5" />
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="font-extrabold text-xs tracking-tight text-blue-900 leading-none flex items-center gap-1">
                      <span className="text-blue-700">{displayName.split(" ")[0] || "SPICEZCOM"}</span>
                      <span className="text-red-600 font-black">{displayName.split(" ").slice(1).join(" ") || "INTERNET"}</span>
                    </div>
                    <div className="text-[8.5px] font-bold text-slate-500 tracking-wider flex items-center gap-1 mt-0.5">
                      <span className="h-0.5 w-2.5 bg-red-500 inline-block" /> {subtitleText}
                    </div>
                  </div>
                </div>

                {/* Hotspot Title & Welcome */}
                <div className="text-left">
                  <div className="text-[11px] font-black tracking-wider text-slate-900 uppercase">
                    HOTSPOT {tenantSlug.replace(/-/g, " ").toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-amber-500 font-black text-xs tracking-tighter">&gt;&gt;</span>
                    <span className="text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 drop-shadow-xs">
                      {welcomeText}
                    </span>
                    <span className="text-amber-500 font-black text-xs tracking-tighter">&lt;&lt;</span>
                  </div>
                </div>
              </div>

              {/* Right Side: Smiling Woman on Gold Curved Wave */}
              <div className="col-span-4 relative flex items-center justify-center">
                <div className="relative w-28 h-28 rounded-2xl overflow-hidden shadow-md border-2 border-amber-400 bg-amber-100">
                  <img
                    src="/hotspot-banner-woman.jpg"
                    alt="WiFi Subscriber"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-1 right-1 p-1 rounded-full bg-amber-500/90 text-white shadow-xs">
                    <WifiIcon className="w-3 h-3" />
                  </div>
                </div>
              </div>
            </div>

            {/* HOW TO PURCHASE 5-Step Guide */}
            <div className="mt-2.5">
              <div className="mx-auto w-fit rounded-full bg-slate-950 px-4 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-xs">
                HOW TO PURCHASE
              </div>

              <div className="mt-1.5 grid grid-cols-5 gap-1 text-center">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 flex flex-col items-center justify-center">
                  <span className="h-4 w-4 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center">1</span>
                  <span className="text-[7px] font-bold leading-tight text-slate-700 mt-1">Tap package</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 flex flex-col items-center justify-center">
                  <span className="h-4 w-4 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center">2</span>
                  <span className="text-[7px] font-bold leading-tight text-slate-700 mt-1">Enter phone</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 flex flex-col items-center justify-center">
                  <span className="h-4 w-4 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center">3</span>
                  <span className="text-[7px] font-bold leading-tight text-slate-700 mt-1">Click submit</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-1 flex flex-col items-center justify-center">
                  <span className="h-4 w-4 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center">4</span>
                  <span className="text-[7px] font-bold leading-tight text-slate-700 mt-1">Enter PIN</span>
                </div>
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-1 flex flex-col items-center justify-center">
                  <span className="h-4 w-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">
                    <CheckIcon className="w-2.5 h-2.5" />
                  </span>
                  <span className="text-[7px] font-bold leading-tight text-emerald-700 mt-1">Connected</span>
                </div>
              </div>
            </div>

            {/* Contact Bar matching Screenshot */}
            {phoneToDisplay && (
            <div className="mt-2.5 rounded-full bg-slate-950 px-3.5 py-1.5 flex items-center justify-between text-white shadow-md">
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="h-5 w-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center">
                  <PhoneIcon className="w-3 h-3" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-wider text-amber-400">CONTACT US</span>
              </div>
              <a href={`tel:${phoneToDisplay}`} className="font-mono text-xs font-black tracking-wider text-white hover:text-amber-300">
                {phoneToDisplay}
              </a>
            </div>
            )}

            {/* Feature Badges */}
            <div className="mt-2 pt-1.5 border-t border-slate-100 grid grid-cols-3 gap-1 text-[7.5px] text-slate-600 leading-tight text-center">
              <div className="flex items-center justify-center gap-1">
                <ZapIcon className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="font-bold text-slate-900">FAST SPEEDS</span>
              </div>
              <div className="flex items-center justify-center gap-1">
                <ShieldIcon className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="font-bold text-slate-900">SECURE &amp; RELIABLE</span>
              </div>
              <div className="flex items-center justify-center gap-1">
                <GlobeIcon className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="font-bold text-slate-900">CONNECTED ALWAYS</span>
              </div>
            </div>
          </div>
        </div>

        {/* Connecting Handshake Overlay */}
        {completingRouterLogin ? (
          <div className="mt-6 rounded-2xl bg-slate-900/90 border border-amber-500/50 p-6 text-center shadow-2xl backdrop-blur-md">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent mb-3" />
            <p className="text-lg font-black text-amber-400">Authenticating with WiFi Router…</p>
            <p className="text-xs text-slate-300 mt-1">Unlocking high-speed internet access.</p>
          </div>
        ) : voucherResult || accountResult ? (
          <div className="mt-6 rounded-2xl bg-emerald-950/80 border border-emerald-500 p-6 text-center shadow-2xl backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-slate-950 text-2xl font-black mb-2">
              <CheckIcon className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-black text-emerald-400">Payment received</h2>
            {voucherResult?.durationMinutes && (
              <p className="text-xs text-slate-200 mt-1">
                Valid for <span className="font-bold text-amber-300">{voucherResult.durationMinutes} minutes</span>
              </p>
            )}
            {/* Same reasoning as suntech-blue: this card means the voucher was accepted, not that
                the router let the device online. "Enjoy your browsing" to someone still stuck on
                the portal reads as the system lying to them. */}
            <p className="text-[11px] text-slate-400 mt-2">
              If you are not online yet, tap &quot;Already paid but not connected?&quot; to finish.
            </p>
          </div>
        ) : (
          /* 3x3 Packages Grid with High-Visibility Packages & Speeds */
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                {t.choosePackage}
              </span>

              {/* 3D Mascot Picker Trigger Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMascotPicker((v) => !v)}
                  className="px-2.5 py-1 rounded-full bg-slate-900/90 border border-amber-500/60 text-amber-300 text-[10.5px] font-bold shadow-md hover:bg-slate-800 transition-all flex items-center gap-1.5"
                  title="Choose 3D Cartoon Mascot Theme"
                >
                  <SparklesIcon className="w-3 h-3 text-amber-400" />
                  <span className="truncate max-w-[110px]">
                    {activeMascotId === "cycle-all" ? "Mix All 3D Characters" : selectedMeta.name.split(" ")[0]}
                  </span>
                  <ChevronDownIcon className="w-3 h-3 text-slate-400" />
                </button>

                {/* 3D Cartoon Mascot Dropdown Modal */}
                {showMascotPicker && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
                    <div className="rounded-3xl bg-slate-900 border border-amber-500/50 p-5 max-w-md w-full shadow-2xl max-h-[85vh] overflow-y-auto">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                        <div>
                          <h4 className="text-sm font-black text-white flex items-center gap-2">
                            <SparklesIcon className="w-4 h-4 text-amber-400" />
                            <span>3D Cartoon Mascot Themes</span>
                          </h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Select the 3D character decor for your package cards
                          </p>
                        </div>
                        <button
                          onClick={() => setShowMascotPicker(false)}
                          className="text-slate-400 hover:text-white text-lg w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center"
                        >
                          <CloseIcon className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Option to Mix Characters */}
                      <button
                        onClick={() => {
                          setActiveMascotId("cycle-all");
                          setShowMascotPicker(false);
                        }}
                        className={`w-full mt-3 p-3 rounded-2xl border text-left flex items-center justify-between transition-all ${
                          activeMascotId === "cycle-all"
                            ? "bg-amber-500/20 border-amber-400 text-amber-300 font-bold"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <SparklesIcon className="w-5 h-5 text-amber-400" />
                          <div>
                            <span className="text-xs font-bold block">Mix All 3D Characters (Default)</span>
                            <span className="text-[10px] text-slate-400">Tom, Jerry, SpongeBob, Ben 10, Spider-Man, Wendy &amp; Boy</span>
                          </div>
                        </div>
                        {activeMascotId === "cycle-all" && <CheckIcon className="w-4 h-4 text-amber-400" />}
                      </button>

                      {/* Characters Grid */}
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        {CARTOON_3D_ROSTER.slice(0, 8).map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setActiveMascotId(item.id);
                              setShowMascotPicker(false);
                            }}
                            className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                              activeMascotId === item.id
                                ? "bg-amber-500/20 border-amber-400 text-amber-300 font-bold"
                                : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            <div className="w-8 h-8 rounded-lg overflow-hidden border border-slate-700 bg-slate-800 shrink-0">
                              <img
                                src={item.cardTemplate || item.charImage || "/cartoons/yellow-boy.jpg"}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="truncate">
                              <span className="text-xs font-bold block truncate">{item.name}</span>
                              <span className="text-[9px] text-slate-500 uppercase">3D Character</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {loadingPackages ? (
              <div className="py-16 text-center text-slate-400 text-xs">Loading hotspot packages…</div>
            ) : !packages || packages.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs bg-slate-900/60 rounded-2xl border border-slate-800">
                No packages available. Please contact administrator.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 pt-2">
                {packages.map((pkg, idx) => {
                  const isPop = pkg.isPopular;
                  const borderStyle = isPop
                    ? "border-amber-400 shadow-amber-400/80 ring-2 ring-amber-400 scale-[1.02]"
                    : CARD_COLORS[idx % CARD_COLORS.length];

                  // Resolve Character for this specific card
                  const cardItem =
                    activeMascotId === "cycle-all"
                      ? CARTOON_3D_ROSTER[idx % CARTOON_3D_ROSTER.length]!
                      : CARTOON_3D_ROSTER.find((c) => c.id === activeMascotId) || CARTOON_3D_ROSTER[0]!;

                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => onSelectPackage(pkg)}
                      className={`group relative flex flex-col justify-between rounded-2xl border-2 p-1.5 text-center shadow-2xl transition-all duration-150 active:scale-95 hover:scale-[1.04] bg-[#fdfbf7] ${borderStyle}`}
                      style={{ minHeight: "142px" }}
                    >
                      {/* Most Popular Floating Badge (outside inner clipped container so it is never cut off) */}
                      {isPop && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap rounded-full bg-gradient-to-r from-red-600 via-orange-500 to-amber-500 px-2.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider text-white shadow-lg border border-yellow-300 flex items-center gap-1">
                          <FlameIcon className="w-2.5 h-2.5 text-yellow-200" />
                          <span>{pkg.badge || t.popular.toUpperCase()}</span>
                        </div>
                      )}

                      {/* Inner clipped background container for 3D card template & characters */}
                      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                        {cardItem.cardTemplate ? (
                          <img
                            src={cardItem.cardTemplate}
                            alt={cardItem.name}
                            className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none transform group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          /* Otherwise: Cream Signboard Base + Leaning 3D Character Cutout */
                          <>
                            {/* 3D Character leaning over top right */}
                            {cardItem.charImage && (
                              <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden z-0">
                                <img
                                  src={cardItem.charImage}
                                  alt={cardItem.name}
                                  className="w-full h-full object-cover object-top opacity-95 transform group-hover:scale-110 transition-transform"
                                />
                              </div>
                            )}
                            {/* Bottom Curved Golden Wave Ribbon */}
                            <div className="absolute bottom-0 inset-x-0 h-7 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 rounded-b-xl z-0" />
                          </>
                        )}
                      </div>

                      {/* Package Duration Header in Bold High-Contrast Black */}
                      <div className={`relative z-10 w-full pl-1 text-left ${isPop ? "pt-2" : "pt-1"}`}>
                        <span className="inline-block bg-white/70 backdrop-blur-2xs px-1.5 py-0.5 rounded-md text-[13px] font-black text-slate-950 tracking-tight leading-none capitalize shadow-2xs">
                          {formatDurationTitle(pkg.name, pkg.durationMinutes)}
                        </span>
                      </div>

                      {/* Package Price in Big Bold Bright Red */}
                      <div className="relative z-10 my-auto py-1 text-center pr-3">
                        <span className="block font-black text-[18px] sm:text-[19px] text-red-600 tracking-tight drop-shadow-xs leading-none">
                          {formatPriceKsh(pkg.priceMinor)}
                        </span>
                      </div>

                      {/* Prominent High-Visibility Speed & Bandwidth Badge at Bottom */}
                      <div className="relative z-10 w-full pb-0.5 px-0.5 text-center">
                        <div className="bg-slate-950/80 backdrop-blur-xs border border-yellow-400/60 rounded-md py-0.5 px-1 shadow-xs">
                          <span className="text-[8.5px] font-extrabold text-amber-300 uppercase tracking-tight block truncate">
                            {pkg.appPolicy && pkg.appPolicy !== "ALL"
                              ? `${getSocialAppMeta(pkg.appPolicy).icon} ${getSocialAppMeta(pkg.appPolicy).name}`
                              : formatPackageSpeed(pkg.downloadKbps, pkg.dataCapMb)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions, at the end of the page rather than fixed to the bottom: the portal's own
          bottom bar (paid but not connected, voucher, help) sits there and covered this one. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/90 px-4 py-2.5 max-w-lg mx-auto">
        <button
          type="button"
          onClick={onOpenAccountModal}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white transition-colors"
        >
          <RefreshIcon className="w-3.5 h-3.5" />
          <span>{t.accountLogin}</span>
        </button>

        {/* Customers who were given a voucher code (bought from an agent, or sent by SMS) enter it here. */}
        <button
          type="button"
          onClick={onOpenVoucherModal}
          className="flex items-center gap-1.5 rounded-full border border-amber-400/60 px-3 py-1.5 text-xs font-black text-amber-300 hover:bg-amber-400/10 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
            <path d="M13 5v2M13 11v2M13 17v2" />
          </svg>
          <span>{t.enterVoucher}</span>
        </button>

        <button
          type="button"
          onClick={onOpenTvModal}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-600 to-rose-600 px-4 py-1.5 text-xs font-black text-white shadow-lg active:scale-95 hover:scale-105 transition-transform"
        >
          <TvIcon className="w-3.5 h-3.5" />
          <span>{t.connectTv}</span>
        </button>
      </div>
    </div>
  );
}
