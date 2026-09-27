"use client";

import { useState } from "react";
import Link from "next/link";
import { LandingMaintenanceConfig } from "@/lib/landing-maintenance";
import { IconMaintenance, IconLock, IconCheck, IconPulse, IconArrowRight } from "@/components/icons";

interface Props {
  config: LandingMaintenanceConfig;
  onBypass: (secret: string) => boolean;
}

export function LandingMaintenanceScreen({ config, onBypass }: Props) {
  const [bypassInput, setBypassInput] = useState("");
  const [bypassError, setBypassError] = useState(false);
  const [showBypassModal, setShowBypassModal] = useState(false);

  const handleBypassSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = onBypass(bypassInput.trim());
    if (!success) {
      setBypassError(true);
      setTimeout(() => setBypassError(false), 2500);
    }
  };

  return (
    <main className="min-h-screen bg-obsidian-950 text-slate-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black relative overflow-hidden font-sans">
      {/* Background Cyber Ambient Lights */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-amber-500/10 blur-[140px] rounded-full" />
        <div className="absolute bottom-10 right-10 w-[600px] h-[400px] bg-brand-500/10 blur-[130px] rounded-full" />
        <div className="absolute inset-0 bg-grid-pattern opacity-40" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl overflow-hidden shadow-lg shadow-amber-500/20 ring-1 ring-amber-500/40 bg-slate-950 flex items-center justify-center">
            <img src="/logo.jpg" alt="Suntech Billing Logo" className="h-full w-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white">SUNTECH BILLING</span>
              <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                Maintenance
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Carrier ISP Operations Engine</p>
          </div>
        </div>

        {/* Super Admin Quick Bypass Button */}
        <button
          onClick={() => setShowBypassModal(true)}
          className="text-xs font-mono text-slate-400 hover:text-amber-400 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-amber-500/40 bg-slate-900/60 transition-all flex items-center gap-1.5"
        >
          <IconLock size={13} />
          <span>Super Admin Bypass</span>
        </button>
      </header>

      {/* Hero Notice Card */}
      <section className="relative z-10 mx-auto w-full max-w-3xl px-6 py-8 text-center space-y-6">
        {/* Animated Maintenance Beacon */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs font-mono shadow-glow animate-pulse">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
          <IconMaintenance size={14} className="text-amber-400" />
          <span>SCHEDULED TELECOM INFRASTRUCTURE UPGRADE</span>
        </div>

        {/* Headline */}
        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          {config.headline}
        </h1>

        {/* Detailed Explanation */}
        <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl mx-auto">
          {config.message}
        </p>

        {/* Estimated Completion Timer Pill */}
        <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs font-mono text-slate-300 shadow-xl">
          <IconPulse size={16} className="text-cyan-400 animate-pulse" />
          <span className="text-slate-400">Estimated Duration:</span>
          <span className="font-bold text-white bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            {config.estimatedCompletion}
          </span>
        </div>

        {/* Live Subsystem Health Status */}
        <div className="pt-4 text-left">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">
                Real-Time Telecom Core Telemetry
              </span>
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Subscribers Undisrupted
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              {config.affectedServices.map((srv, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 flex items-center justify-between">
                  <span className="text-slate-300 font-sans text-xs">{srv.name}</span>
                  {srv.status === "OPERATIONAL" && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-bold">
                      OPERATIONAL
                    </span>
                  )}
                  {srv.status === "UPGRADING" && (
                    <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-400 text-[10px] font-bold animate-pulse">
                      UPGRADING
                    </span>
                  )}
                  {srv.status === "MAINTENANCE" && (
                    <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-400 text-[10px] font-bold">
                      IN PROGRESS
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Emergency NOC Hotline & Login CTAs */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-4">
          <a
            href={`https://wa.me/${config.emergencyContact.replace(/[^0-9]/g, "")}?text=Inquiry%20regarding%20scheduled%20maintenance`}
            target="_blank"
            rel="noreferrer"
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-glow-emerald transition-all flex items-center gap-2"
          >
            <span>💬</span>
            <span>Emergency NOC WhatsApp Desk</span>
          </a>

          <Link
            href="/login"
            className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-white font-bold text-xs transition-all flex items-center gap-2"
          >
            <span>Super Admin Sign In</span>
            <IconArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 font-mono gap-3">
        <div>
          &copy; {new Date().getFullYear()} Suntech Billing Technologies. All core network interfaces monitored 24/7.
        </div>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-slate-400 transition-colors">Terms</Link>
          <Link href="/refund-policy" className="hover:text-slate-400 transition-colors">Refunds</Link>
          <button
            onClick={() => setShowBypassModal(true)}
            className="hover:text-amber-400 transition-colors"
          >
            Staff Override
          </button>
        </div>
      </footer>

      {/* Staff / Super Admin Bypass Modal */}
      {showBypassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-6 space-y-4 shadow-2xl text-left font-sans">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <IconLock size={16} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">Super Admin Bypass Key</h3>
              </div>
              <button
                onClick={() => setShowBypassModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your Super Admin maintenance override key or sign in with your staff credentials to view the live landing page.
            </p>

            <form onSubmit={handleBypassSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Bypass Secret Key
                </label>
                <input
                  type="password"
                  value={bypassInput}
                  onChange={(e) => setBypassInput(e.target.value)}
                  placeholder="Enter bypass key (default: mkg-superadmin-bypass)"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-500 text-xs font-mono text-white focus:outline-none"
                  autoFocus
                />
              </div>

              {bypassError && (
                <div className="p-2 rounded-lg bg-rose-950 border border-rose-800 text-rose-300 text-xs font-mono">
                  ✕ Invalid secret key. Please check your Super Admin settings.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBypassModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs shadow-glow transition-all"
                >
                  Unlock Landing Page
                </button>
              </div>
            </form>

            <div className="pt-2 text-center border-t border-slate-900">
              <Link
                href="/login"
                className="text-xs text-brand-400 hover:underline font-mono"
              >
                Or Sign In with Super Admin Account &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
