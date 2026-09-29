"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Logo } from "@/components/marketing/brand";

interface Checkout {
  reference: string;
  purpose: "CUSTOMER_ACCOUNT" | "INVOICE";
  isp: string;
  customer: string | null;
  invoice: { number: string; status: string; dueDate: string; currency: string } | null;
  packageName: string | null;
  payable: boolean;
  amountDueMinor: number;
  fixedAmount: boolean;
  collectedBy: "MASHUPHOST" | "ISP";
  paybill: { number: string | null; account: string | null };
}

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "waiting"; checkoutRequestId: string; amountMinor: number; startedAt: number }
  | { kind: "paid"; receipt: string | null; amountMinor: number }
  | { kind: "failed"; message: string }
  | { kind: "timeout" };

const kes = (minor: number) => `KES ${(minor / 100).toLocaleString("en-KE", { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;
const POLL_MS = 3_000;
const GIVE_UP_MS = 120_000;

/**
 * Public "pay your internet bill" page for a Suntech payment reference. The browser never
 * decides that a payment succeeded: it only shows what the server recorded from M-Pesa's own
 * callback, polled every few seconds.
 */
export default function PayPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(params.reference ?? "");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch<Checkout>(`/api/v1/pay/${encodeURIComponent(reference)}`, { skipAuth: true })
      .then((c) => {
        setCheckout(c);
        if (!c.fixedAmount && c.amountDueMinor > 0) setAmount(String(Math.ceil(c.amountDueMinor / 100)));
      })
      .catch((e: unknown) => setLoadError(e instanceof ApiRequestError && e.status === 404 ? "not-found" : "error"));
  }, [reference]);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const tick = async () => {
      if (Date.now() - phase.startedAt > GIVE_UP_MS) {
        setPhase({ kind: "timeout" });
        return;
      }
      try {
        const s = await apiFetch<{ status: string; message: string | null; receipt: string | null; amountMinor: number }>(
          `/api/v1/pay/${encodeURIComponent(reference)}/status/${encodeURIComponent(phase.checkoutRequestId)}`,
          { skipAuth: true }
        );
        if (s.status === "COMPLETED") return setPhase({ kind: "paid", receipt: s.receipt, amountMinor: s.amountMinor });
        if (s.status === "CANCELLED") return setPhase({ kind: "failed", message: "The payment was cancelled on your phone. Nothing was charged." });
        if (s.status === "FAILED") return setPhase({ kind: "failed", message: s.message || "M-Pesa could not complete the payment. Nothing was charged." });
      } catch {
        // A dropped poll is not a failed payment; try again.
      }
      pollRef.current = setTimeout(() => void tick(), POLL_MS);
    };
    pollRef.current = setTimeout(() => void tick(), POLL_MS);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [phase, reference]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!/^(?:\+?254|0)?[17]\d{8}$/.test(phone.replace(/\s+/g, ""))) {
      setFormError("Enter the M-Pesa number that will pay, e.g. 0712 345 678.");
      return;
    }
    let amountMinor: number | undefined;
    if (checkout && !checkout.fixedAmount) {
      const n = Number(amount.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 1) {
        setFormError("Enter an amount of at least KES 1.");
        return;
      }
      amountMinor = Math.round(n * 100);
    }
    setPhase({ kind: "sending" });
    try {
      const res = await apiFetch<{ checkoutRequestId: string; amountMinor: number }>(`/api/v1/pay/${encodeURIComponent(reference)}/stk`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ phone, ...(amountMinor ? { amountMinor } : {}) }),
      });
      setPhase({ kind: "waiting", checkoutRequestId: res.checkoutRequestId, amountMinor: res.amountMinor, startedAt: Date.now() });
    } catch (err) {
      setPhase({ kind: "form" });
      setFormError(err instanceof ApiRequestError ? err.message : "We couldn't reach M-Pesa. Please try again.");
    }
  };

  return (
    <div className="force-light flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <Link href="/" aria-label="Suntech home">
          <Logo />
        </Link>
        <span className="text-xs text-slate-500">Secure M-Pesa checkout</span>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:py-14">
        <div className="w-full max-w-md">
          {!checkout && !loadError && <div className="h-96 animate-pulse rounded-lg bg-white shadow-sm" aria-label="Loading" />}

          {loadError === "not-found" && (
            <Card>
              <h1 className="text-xl font-semibold text-slate-950">Payment link not found</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Check the link or account number <span className="font-mono">{reference}</span> with your internet provider.
              </p>
            </Card>
          )}
          {loadError === "error" && (
            <Card>
              <h1 className="text-xl font-semibold text-slate-950">Something went wrong</h1>
              <p className="mt-2 text-sm text-slate-600">We couldn&apos;t load this payment. Please refresh the page.</p>
            </Card>
          )}

          {checkout && (
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Pay your internet bill</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{checkout.isp}</h1>

              <dl className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {checkout.customer && <Row label="Customer" value={checkout.customer} />}
                {checkout.packageName && <Row label="Package" value={checkout.packageName} />}
                {checkout.invoice && <Row label="Invoice" value={checkout.invoice.number} />}
                <Row label="Account number" value={<span className="font-mono">{checkout.reference}</span>} />
                <div className="flex items-baseline justify-between px-4 py-3">
                  <dt className="text-slate-600">Amount due</dt>
                  <dd className="text-lg font-semibold tabular-nums text-slate-950">{kes(checkout.amountDueMinor)}</dd>
                </div>
              </dl>

              {!checkout.payable ? (
                <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
                  This invoice is already paid. Thank you!
                </div>
              ) : phase.kind === "paid" ? (
                <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-950" role="status">
                  <p className="text-base font-semibold">Payment received — {kes(phase.amountMinor)}</p>
                  <p className="mt-1">
                    {phase.receipt ? (
                      <>
                        M-Pesa receipt <span className="font-mono font-semibold">{phase.receipt}</span>.{" "}
                      </>
                    ) : (
                      "M-Pesa confirmed your payment; your receipt number will arrive by SMS. "
                    )}
                    {checkout.isp} has been notified.
                  </p>
                </div>
              ) : phase.kind === "waiting" ? (
                <div className="mt-5 rounded-md border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-950" role="status" aria-live="polite">
                  <p className="flex items-center gap-2 font-semibold">
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-800" />
                    Check your phone
                  </p>
                  <p className="mt-1">Enter your M-Pesa PIN to pay {kes(phase.amountMinor)}. This page updates on its own.</p>
                </div>
              ) : phase.kind === "timeout" ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
                    We haven&apos;t heard back from M-Pesa yet. If you entered your PIN, the payment will still be recorded — you&apos;ll get an M-Pesa SMS.
                    Don&apos;t pay again unless you&apos;re sure it didn&apos;t go through.
                  </div>
                  <button type="button" className="text-sm font-semibold text-blue-700 hover:underline" onClick={() => setPhase({ kind: "form" })}>
                    Start again
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                  {phase.kind === "failed" && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
                      {phase.message}
                    </div>
                  )}
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-slate-800">Payment method</legend>
                    <div className="flex items-center gap-3 rounded-md border border-emerald-600 bg-emerald-50/60 px-4 py-3 shadow-[0_0_0_1px_rgb(5,150,105)]">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-900">M-Pesa</span>
                      <span className="ml-auto text-xs text-emerald-800">STK push to your phone</span>
                    </div>
                  </fieldset>
                  {!checkout.fixedAmount && (
                    <div>
                      <label htmlFor="pay-amount" className="mb-1.5 block text-sm font-medium text-slate-800">
                        Amount (KES)
                      </label>
                      <input
                        id="pay-amount"
                        inputMode="numeric"
                        className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-base shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="pay-phone" className="mb-1.5 block text-sm font-medium text-slate-800">
                      M-Pesa phone number
                    </label>
                    <input
                      id="pay-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="07XX XXX XXX"
                      className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-base shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  {formError && (
                    <p className="text-sm text-red-700" role="alert">
                      {formError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={phase.kind === "sending"}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {phase.kind === "sending" ? "Sending prompt…" : "Pay now"}
                  </button>
                </form>
              )}

              {checkout.payable && checkout.paybill.number && checkout.paybill.account && phase.kind !== "paid" && (
                <div className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">Or pay by Paybill</p>
                  <p className="mt-1">
                    Business number <span className="font-mono font-semibold text-slate-900">{checkout.paybill.number}</span>, account number{" "}
                    <span className="font-mono font-semibold text-slate-900">{checkout.paybill.account}</span>.
                  </p>
                </div>
              )}
            </Card>
          )}

          <p className="mt-6 text-center text-xs text-slate-500">
            {checkout?.collectedBy === "MASHUPHOST"
              ? `Payments to ${checkout.isp} are processed by Suntech.`
              : "Powered by Suntech."}{" "}
            Suntech will never ask for your M-Pesa PIN outside the M-Pesa prompt on your phone.
          </p>
        </div>
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.18)]">{children}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right text-slate-900">{value}</dd>
    </div>
  );
}
