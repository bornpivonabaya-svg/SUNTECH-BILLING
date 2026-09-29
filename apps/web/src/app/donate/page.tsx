"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getApiBaseUrl } from "@/lib/api-client";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

const PRESETS = [
  { amount: 50, label: "Chai" },
  { amount: 100, label: "Coffee" },
  { amount: 250, label: "Snack" },
  { amount: 500, label: "Lunch" },
  { amount: 1000, label: "Data bundle" },
  { amount: 2000, label: "A month of servers" },
] as const;

interface Supporter {
  id: string;
  amount: number;
  name: string | null;
  message: string | null;
  createdAt: string;
}

interface DonateConfig {
  paybill: string | null;
  accountReference: string;
  enabled: boolean;
}

type Stage = "form" | "waiting" | "done";

const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString("en-KE");
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/payments/mpesa${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, data: json?.data, message: json?.error?.message };
  } catch {
    return { ok: false, message: "Couldn't reach the payment service. Check your connection and try again." };
  }
}

export default function DonatePage() {
  const [config, setConfig] = useState<DonateConfig | null>(null);
  const [supporters, setSupporters] = useState<{ supporterCount: number; recent: Supporter[] } | null>(null);

  const [amount, setAmount] = useState<number>(100);
  const [custom, setCustom] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [showPublicly, setShowPublicly] = useState(true);

  const [stage, setStage] = useState<Stage>("form");
  const [sending, setSending] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitNote, setWaitNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadSupporters = () => {
    void api<{ supporterCount: number; recent: Supporter[] }>("/donate/supporters").then((r) => r.ok && r.data && setSupporters(r.data));
  };

  useEffect(() => {
    void api<DonateConfig>("/donate/config").then((r) => r.ok && r.data && setConfig(r.data));
    loadSupporters();
  }, []);

  const finalAmount = custom ? Number(custom) : amount;

  // While waiting, poll the payment until M-Pesa settles it one way or the other.
  useEffect(() => {
    if (stage !== "waiting" || !checkoutId) return;
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      if (stopped) return;
      tries += 1;
      const r = await api<{ status: string; resultDesc?: string }>(`/donate/${checkoutId}/status`);
      if (stopped) return;
      if (r.data?.status === "COMPLETED") {
        setStage("done");
        loadSupporters();
        return;
      }
      if (r.data?.status === "FAILED" || r.data?.status === "CANCELLED") {
        setStage("form");
        setError(r.data.status === "CANCELLED" ? "The M-Pesa request was cancelled on your phone. You can try again." : r.data.resultDesc || "M-Pesa didn't complete the payment. You can try again.");
        return;
      }
      if (tries < 40) setTimeout(tick, 3000);
      else setWaitNote("Still waiting for M-Pesa. If you entered your PIN, tap “I've paid” to check again.");
    };
    const first = setTimeout(tick, 2500);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [stage, checkoutId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setWaitNote(null);
    const digits = phone.replace(/\D/g, "");
    if (!/^(0[71]\d{8}|[71]\d{8}|254[71]\d{8})$/.test(digits)) return setError("Enter the M-Pesa number that will pay, e.g. 0712 345 678.");
    if (!Number.isInteger(finalAmount) || finalAmount < 1) return setError("Enter an amount of at least KSh 1.");
    setSending(true);
    const r = await api<{ checkoutRequestId: string }>("/donate", {
      method: "POST",
      body: JSON.stringify({ phone: digits, amount: finalAmount, name: name.trim() || undefined, message: message.trim() || undefined, showPublicly }),
    });
    setSending(false);
    if (!r.ok || !r.data?.checkoutRequestId) return setError(r.message ?? "Couldn't send the M-Pesa prompt. Please try again.");
    setCheckoutId(r.data.checkoutRequestId);
    setStage("waiting");
  };

  // "I've paid": ask M-Pesa directly instead of waiting for its callback.
  const checkNow = async () => {
    if (!checkoutId) return;
    setChecking(true);
    setWaitNote(null);
    const r = await api<{ status: string; resultDesc?: string }>(`/donate/${checkoutId}/status?verify=true`);
    setChecking(false);
    if (r.data?.status === "COMPLETED") {
      setStage("done");
      loadSupporters();
    } else if (r.data?.status === "FAILED" || r.data?.status === "CANCELLED") {
      setStage("form");
      setError(r.data.resultDesc || "M-Pesa didn't complete the payment. You can try again.");
    } else {
      setWaitNote("M-Pesa hasn't confirmed it yet. Give it a few seconds; this page updates by itself.");
    }
  };

  const paybillLine = config?.paybill ? `Paybill ${config.paybill}, account ${config.accountReference}` : null;

  return (
    <div className="force-light min-h-screen bg-white text-slate-900 antialiased">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-600">Support Suntech</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Buy the team a coffee</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Suntech is built in Kenya for ISPs and hotspot owners. If it has saved you time or made you money, a tip helps pay for servers, SMS and
            test routers, and keeps new features coming. Every shilling is appreciated.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-slate-200 p-5 sm:p-7">
            {stage === "form" && (
              <form onSubmit={submit} className="space-y-6">
                <fieldset>
                  <legend className="text-sm font-medium text-slate-900">Choose an amount</legend>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {PRESETS.map((p) => {
                      const active = !custom && amount === p.amount;
                      return (
                        <button
                          key={p.amount}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setAmount(p.amount);
                            setCustom("");
                          }}
                          className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                            active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <span className="block text-base font-semibold tabular-nums text-slate-950">{ksh(p.amount)}</span>
                          <span className="block text-sm text-slate-500">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 block">
                    <span className="text-sm text-slate-600">Or your own amount</span>
                    <div className="mt-1 flex items-center rounded-lg border border-slate-300 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20">
                      <span className="pl-3 text-sm text-slate-500">KSh</span>
                      <input
                        inputMode="numeric"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
                        placeholder="e.g. 300"
                        className="w-full rounded-lg bg-transparent px-2 py-2.5 text-sm outline-none"
                      />
                    </div>
                  </label>
                </fieldset>

                <label className="block">
                  <span className="text-sm font-medium text-slate-900">M-Pesa number</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0712 345 678"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                  />
                  <span className="mt-1 block text-xs text-slate-500">You&apos;ll get a prompt on this phone to enter your PIN. Never shown publicly.</span>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-900">Your name <span className="font-normal text-slate-500">(optional)</span></span>
                    <input
                      value={name}
                      maxLength={100}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Jane from Kisumu"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-900">A note <span className="font-normal text-slate-500">(optional)</span></span>
                    <input
                      value={message}
                      maxLength={280}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Say something nice"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                    />
                  </label>
                </div>

                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={showPublicly} onChange={(e) => setShowPublicly(e.target.checked)} />
                  <span className="text-sm text-slate-600">Show my name and note in the supporters list on this page</span>
                </label>

                {error && (
                  <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={sending}
                  className="w-full rounded-xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
                >
                  {sending ? "Sending prompt…" : `Send ${finalAmount >= 1 ? ksh(finalAmount) : ""} with M-Pesa`}
                </button>
              </form>
            )}

            {stage === "waiting" && (
              <div className="py-4 text-center">
                <p className="text-lg font-semibold text-slate-950">Check your phone</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                  We sent an M-Pesa request for <strong className="text-slate-900">{ksh(finalAmount)}</strong>. Enter your PIN to complete it. This page
                  updates as soon as M-Pesa confirms.
                </p>
                <span aria-hidden="true" className="mx-auto mt-5 block h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
                {waitNote && <p className="mx-auto mt-4 max-w-sm text-sm text-slate-600">{waitNote}</p>}
                <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={checkNow}
                    disabled={checking}
                    className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {checking ? "Checking…" : "I've paid"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStage("form");
                      setCheckoutId(null);
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Start again
                  </button>
                </div>
                {paybillLine && <p className="mt-6 text-xs text-slate-500">No prompt? Pay with M-Pesa {paybillLine}, amount {ksh(finalAmount)}.</p>}
              </div>
            )}

            {stage === "done" && (
              <div className="py-6 text-center">
                <p className="text-4xl" aria-hidden="true">
                  ☕
                </p>
                <p className="mt-3 text-xl font-semibold text-slate-950">Thank you{name.trim() ? `, ${name.trim()}` : ""}!</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                  M-Pesa confirmed your {ksh(finalAmount)}. It genuinely helps, and it means a lot to know Suntech is useful to you.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStage("form");
                    setCheckoutId(null);
                    setMessage("");
                  }}
                  className="mt-6 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Done
                </button>
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-950">Recent supporters</h2>
              {supporters && supporters.supporterCount > 0 && (
                <p className="mt-1 text-sm text-slate-500">
                  {supporters.supporterCount.toLocaleString()} {supporters.supporterCount === 1 ? "person has" : "people have"} chipped in so far.
                </p>
              )}
              {!supporters ? (
                <p className="mt-4 text-sm text-slate-500">Loading…</p>
              ) : supporters.recent.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No one yet. You could be the first.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {supporters.recent.map((s) => (
                    <li key={s.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-slate-900">{s.name || "Anonymous"}</span>
                        <span className="shrink-0 text-sm tabular-nums text-slate-600">{ksh(s.amount)}</span>
                      </div>
                      {s.message && <p className="mt-0.5 text-sm text-slate-600">&ldquo;{s.message}&rdquo;</p>}
                      <p className="mt-0.5 text-xs text-slate-400">{timeAgo(s.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {paybillLine && config && (
              <section className="rounded-2xl border border-slate-200 p-5">
                <h2 className="text-sm font-semibold text-slate-950">Prefer Paybill?</h2>
                <p className="mt-1 text-sm text-slate-600">Lipa na M-Pesa → Paybill</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-xs text-slate-500">Business no.</dt>
                    <dd className="font-semibold tabular-nums text-slate-950">{config.paybill}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-xs text-slate-500">Account</dt>
                    <dd className="font-semibold text-slate-950">{config.accountReference}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(config.paybill ?? "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="mt-3 text-sm font-medium text-brand-600 hover:underline"
                >
                  {copied ? "Copied" : "Copy paybill number"}
                </button>
              </section>
            )}
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
