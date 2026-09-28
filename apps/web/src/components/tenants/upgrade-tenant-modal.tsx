"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Input } from "@/components/ui";

/** A plan from the real catalogue (/api/v1/platform/plans), which the server accepts. */
interface PlanRow {
  id: string;
  name: string;
  monthlyPriceMinor: number;
  annualPriceMinor: number | null;
  maxCustomers: number | null;
  maxRouters: number | null;
  trialDays: number;
}

interface Props {
  tenant: {
    id: string;
    name: string;
    slug: string;
    subscription?: {
      plan?: { id: string; name: string };
      billingCycle?: "MONTHLY" | "ANNUAL";
    } | null;
  };
  onClose: () => void;
}

type Action = "trial" | "paid" | "plan";

const ACTIONS: { id: Action; label: string; hint: string }[] = [
  { id: "trial", label: "Free trial", hint: "Unlocks everything for the days you choose. Nothing is charged." },
  { id: "paid", label: "Paid (cash, bank…)", hint: "Activates the plan for the months paid and records the payment in their billing history." },
  { id: "plan", label: "Change plan only", hint: "Switches their plan and limits. Their paid-until date doesn't change." },
];

const kes = (minor: number) => `KES ${Math.round(minor / 100).toLocaleString()}`;
const limit = (n: number | null, what: string) => (n === null ? `Unlimited ${what}` : `${n.toLocaleString()} ${what}`);

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100";

/**
 * Super admin: give an ISP a free trial, activate a plan they paid for outside M-Pesa, or change
 * their plan. Uses the platform's real plans; each action calls its own endpoint in
 * apps/api/src/routes/tenants.ts (/trial, /subscription/activate, /subscription).
 */
export function UpgradeTenantModal({ tenant, onClose }: Props) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>("trial");
  const [planId, setPlanId] = useState(tenant.subscription?.plan?.id ?? "");
  const [trialDays, setTrialDays] = useState(14);
  const [months, setMonths] = useState(1);
  const [amountKes, setAmountKes] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ["platform-plans"],
    queryFn: () => apiFetch<PlanRow[]>("/api/v1/platform/plans"),
  });
  const selectedPlan = plans.data?.find((p) => p.id === planId) ?? null;

  const run = useMutation({
    mutationFn: async (): Promise<string> => {
      const base = `/api/v1/platform/tenants/${tenant.id}`;
      if (action === "trial") {
        const r = await apiFetch<{ trialEndsAt: string }>(`${base}/trial`, {
          method: "POST",
          body: JSON.stringify({ action: "extend", days: trialDays }),
        });
        // A chosen plan sets the limits during the trial too.
        if (planId && planId !== tenant.subscription?.plan?.id) {
          await apiFetch(`${base}/subscription`, { method: "PATCH", body: JSON.stringify({ planId }) });
        }
        return `Free trial until ${new Date(r.trialEndsAt).toLocaleDateString()}.`;
      }
      if (action === "paid") {
        const r = await apiFetch<{ planName: string; activeUntil: string }>(`${base}/subscription/activate`, {
          method: "POST",
          body: JSON.stringify({
            months,
            ...(planId ? { planId } : {}),
            ...(amountKes.trim() ? { amountKes: Number(amountKes) } : {}),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          }),
        });
        return `${r.planName} is active until ${new Date(r.activeUntil).toLocaleDateString()}.`;
      }
      await apiFetch(`${base}/subscription`, { method: "PATCH", body: JSON.stringify({ planId }) });
      return `Plan changed to ${selectedPlan?.name ?? "the chosen plan"}.`;
    },
    onSuccess: (message) => {
      setError(null);
      setDone(message);
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "That didn't work. Try again."),
  });

  const needsPlan = action === "plan" || (action === "paid" && !tenant.subscription);
  const canSubmit = !run.isPending && !(needsPlan && !planId);
  const buttonLabel =
    action === "trial"
      ? `Give ${trialDays}-day free trial`
      : action === "paid"
        ? `Activate ${months} month${months > 1 ? "s" : ""}`
        : "Change plan";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Plan for ${tenant.name}`}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-left shadow-lg dark:border-obsidian-800 dark:bg-obsidian-950 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Plan &amp; trial</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {tenant.name} · {tenant.subscription?.plan ? `on ${tenant.subscription.plan.name}` : "no plan yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-obsidian-800 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* What to do */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAction(a.id);
                setDone(null);
                setError(null);
              }}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                action === a.id
                  ? "border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-slate-200 text-slate-700 hover:border-slate-300 dark:border-obsidian-800 dark:text-slate-300 dark:hover:border-obsidian-700"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">{ACTIONS.find((a) => a.id === action)!.hint}</p>

        {/* Plans */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Plan{action === "trial" ? " (optional)" : ""}
          </p>
          {plans.isLoading ? (
            <p className="text-sm text-slate-500">Loading plans…</p>
          ) : plans.isError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">Could not load plans.</p>
          ) : plans.data && plans.data.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {plans.data.map((p) => {
                const selected = planId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(selected && action === "trial" ? "" : p.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-brand-500 ring-1 ring-brand-500/40"
                        : "border-slate-200 hover:border-slate-300 dark:border-obsidian-800 dark:hover:border-obsidian-700"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {p.name}
                      {tenant.subscription?.plan?.id === p.id && <span className="ml-1 text-xs font-normal text-slate-500">(current)</span>}
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{kes(p.monthlyPriceMinor)}/mo</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {limit(p.maxRouters, "routers")} · {limit(p.maxCustomers, "customers")}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No plans yet. Create one under Plans.</p>
          )}
        </div>

        {/* Details for the chosen action */}
        {action === "trial" && (
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            Free for
            <select aria-label="Trial days" className={selectClass} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">added after any trial time left</span>
          </label>
        )}
        {action === "paid" && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Months" className={selectClass} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[1, 2, 3, 6, 12].map((m) => (
                <option key={m} value={m}>
                  {m} month{m > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <Input
              aria-label="Amount paid (KES)"
              inputMode="decimal"
              placeholder={selectedPlan ? `KES ${Math.round((selectedPlan.monthlyPriceMinor * months) / 100).toLocaleString()}` : "Amount KES"}
              value={amountKes}
              onChange={(e) => setAmountKes(e.target.value.replace(/[^\d.]/g, ""))}
              className="!w-40"
            />
            <Input
              aria-label="Reference"
              placeholder="Reference (receipt, bank ref…)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="!w-56"
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
            ✓ {done}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-obsidian-800">
          <Button variant="secondary" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              setDone(null);
              setError(null);
              run.mutate();
            }}
          >
            {run.isPending ? "Saving…" : buttonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
