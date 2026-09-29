"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ApiRequestError } from "@/lib/api-client";
import { recentOrders, trackOrder, type HardwareOrder, type RecentOrderRef } from "@/lib/hardware-store";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { whatsappLink } from "@/components/marketing/brand";

const ksh = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

const STEPS = [
  { key: "PAID", label: "Paid" },
  { key: "PROCESSING", label: "Being prepared" },
  { key: "DISPATCHED", label: "On the way" },
  { key: "DELIVERED", label: "Delivered" },
] as const;

/** How many of the steps above are done. */
function stepIndex(order: HardwareOrder): number {
  return ["PENDING", "PAID", "PROCESSING", "DISPATCHED", "DELIVERED"].indexOf(order.status);
}

function statusLine(order: HardwareOrder): string {
  switch (order.status) {
    case "PENDING":
      return order.paymentMethod === "PAY_ON_DELIVERY"
        ? `Order received. You'll pay ${ksh(order.totalAmount)} with M-Pesa on delivery; we'll call to confirm.`
        : order.awaitingMpesa
          ? "Waiting for your M-Pesa payment."
          : `Not paid yet${order.paymentNote ? `: ${order.paymentNote}` : "."}`;
    case "PAID":
      return "Paid. We're getting your order ready.";
    case "PROCESSING":
      return "Your order is being prepared.";
    case "DISPATCHED":
      return "Your order is on the way.";
    case "DELIVERED":
      return "Delivered.";
    case "CANCELLED":
      return "This order was cancelled.";
  }
}

function TrackContent() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("orderId") || params.get("q") || "");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<HardwareOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentOrderRef[]>([]);

  useEffect(() => setRecent(recentOrders()), []);

  const lookup = async (q: string, p: string) => {
    setError(null);
    if (q.trim().length < 4) return setError("Enter your order number, e.g. ORD-482913, or your M-Pesa receipt.");
    if (p.replace(/\D/g, "").length < 9) return setError("Enter the phone number you ordered with.");
    setLoading(true);
    try {
      setOrder(await trackOrder(q, p));
    } catch (err) {
      setOrder(null);
      setError(
        err instanceof ApiRequestError && err.status === 404
          ? "We couldn't find an order with that number and phone. Check both and try again."
          : "Couldn't check right now. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void lookup(query, phone);
  };

  const current = order ? stepIndex(order) : 0;

  return (
    <div className="force-light flex min-h-screen flex-col bg-white text-slate-900 antialiased">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Track your order</h1>
        <p className="mt-2 text-base text-slate-600">Enter your order number (or M-Pesa receipt) and the phone number you ordered with.</p>

        <form onSubmit={submit} className="mt-8 grid gap-3 rounded-2xl border border-slate-200 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Order number</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ORD-482913"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm uppercase outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-900">Phone number</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712 345 678"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
          <button type="submit" disabled={loading} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {loading ? "Checking…" : "Track"}
          </button>
          {recent.length > 0 && !order && (
            <div className="sm:col-span-3">
              <p className="text-xs text-slate-500">Recent orders on this device</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {recent.slice(0, 4).map((r) => (
                  <button
                    key={r.orderNumber}
                    type="button"
                    onClick={() => {
                      setQuery(r.orderNumber);
                      setPhone(r.phone);
                      void lookup(r.orderNumber, r.phone);
                    }}
                    className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {r.orderNumber}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        )}

        {order && (
          <section className="mt-8 rounded-2xl border border-slate-200 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xl font-semibold text-slate-950">{order.orderNumber}</p>
                <p className="mt-0.5 text-sm text-slate-500">Placed {new Date(order.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}</p>
              </div>
              <a
                href={whatsappLink(`Hello Suntech, I have a question about order ${order.orderNumber}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Ask on WhatsApp
              </a>
            </div>

            <p className="mt-4 text-sm font-medium text-slate-900">{statusLine(order)}</p>

            {order.status !== "CANCELLED" && (
              <ol className="mt-5 grid grid-cols-4 gap-2">
                {STEPS.map((s, i) => {
                  const done = current >= i + 1;
                  return (
                    <li key={s.key}>
                      <span className={`block h-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-slate-200"}`} />
                      <span className={`mt-2 block text-xs ${done ? "font-medium text-slate-900" : "text-slate-500"}`}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-medium text-slate-900">Items</h2>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {order.items.map((it) => (
                    <li key={it.productId} className="flex justify-between gap-3">
                      <span className="text-slate-700">
                        {it.quantity} × {it.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-900">{ksh(it.price * it.quantity)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 text-slate-500">
                    <span>Delivery</span>
                    <span className="tabular-nums">{ksh(order.shippingFee)}</span>
                  </li>
                  <li className="flex justify-between gap-3 border-t border-slate-100 pt-1.5 font-semibold text-slate-950">
                    <span>Total</span>
                    <span className="tabular-nums">{ksh(order.totalAmount)}</span>
                  </li>
                </ul>
              </div>
              <div>
                <h2 className="text-sm font-medium text-slate-900">Delivery</h2>
                <p className="mt-2 text-sm text-slate-700">{order.customerName}</p>
                <p className="text-sm text-slate-700">
                  {order.deliveryAddress}, {order.county}
                </p>
                {order.status === "PAID" || order.status === "PROCESSING" || order.status === "DISPATCHED" || order.status === "DELIVERED" ? (
                  order.mpesaReceiptNumber && !order.mpesaReceiptNumber.startsWith("STK-") ? (
                    <p className="mt-3 text-sm text-slate-500">M-Pesa receipt {order.mpesaReceiptNumber}</p>
                  ) : null
                ) : null}
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={null}>
      <TrackContent />
    </Suspense>
  );
}
