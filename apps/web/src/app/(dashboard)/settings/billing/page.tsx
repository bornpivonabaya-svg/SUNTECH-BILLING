"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Card, Button, Input, Label, Badge, StatusDot, ErrorText, HintText } from "@/components/ui";
import { IconLayers } from "@/components/icons";
import { tr } from "@/lib/tr";

interface TenantPlanSummary {
  id: string;
  name: string;
  monthlyPriceMinor: number;
  annualPriceMinor: number | null;
  maxCustomers: number | null;
  maxRouters: number | null;
}

interface Subscription {
  id: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";
  billingCycle: "MONTHLY" | "ANNUAL";
  currentPeriodEnd: string;
  plan: TenantPlanSummary;
}

interface UsageLimit {
  used: number;
  limit: number | null;
}

interface SubscriptionPayment {
  id: string;
  amountMinor: number;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  mpesaReceiptNumber: string | null;
  createdAt: string;
}

interface PlanOption extends TenantPlanSummary {
  description: string | null;
}

interface BillingResponse {
  /** Null until the ISP picks a plan (a new account on its free trial). */
  subscription: Subscription | null;
  usage: { customers: UsageLimit; routers: UsageLimit };
  payments: SubscriptionPayment[];
  plans: PlanOption[];
}

const STATUS_META: Record<Subscription["status"], { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  TRIALING: { label: "Trial", variant: "info" },
  ACTIVE: { label: "Active", variant: "success" },
  PAST_DUE: { label: "Past Due", variant: "warning" },
  EXPIRED: { label: "Expired", variant: "danger" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
};

const latestPaymentPending = (payments: SubscriptionPayment[]) => payments[0]?.status === "PENDING";

function formatMinor(amountMinor: number): string {
  return `KES ${(amountMinor / 100).toLocaleString()}`;
}

function UsageBar({ label, usage }: { label: string; usage: UsageLimit }) {
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="text-slate-400">{usage.used} / {usage.limit ?? "Unlimited"}</span>
      </div>
      {usage.limit !== null && (
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-obsidian-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Plan cards with a monthly / yearly switch. Picking one saves it; paying is the step after. */
function PlanPicker({ plans, currentPlanId, onChosen }: { plans: PlanOption[]; currentPlanId?: string; onChosen: () => void }) {
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [error, setError] = useState<string | null>(null);
  const choose = useMutation({
    mutationFn: (planId: string) => apiFetch("/api/v1/billing/choose-plan", { method: "POST", body: JSON.stringify({ planId, billingCycle: cycle }) }),
    onSuccess: onChosen,
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : tr("Something went wrong.")),
  });
  if (plans.length === 0) {
    return <p className="text-sm text-slate-500">{tr("No plans are available yet. Contact support to get set up.")}</p>;
  }
  const hasAnnual = plans.some((p) => p.annualPriceMinor !== null);
  return (
    <div className="space-y-3">
      {hasAnnual && (
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-obsidian-700" role="group" aria-label={tr("Billing period")}>
          {(["MONTHLY", "ANNUAL"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded-md px-3 py-1 font-medium ${cycle === c ? "bg-slate-900 text-white dark:bg-obsidian-700" : "text-slate-500"}`}
            >
              {c === "MONTHLY" ? tr("Monthly") : tr("Yearly")}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const price = cycle === "ANNUAL" ? plan.annualPriceMinor ?? plan.monthlyPriceMinor * 12 : plan.monthlyPriceMinor;
          return (
            <Card key={plan.id} className={`space-y-2 ${plan.id === currentPlanId ? "border-brand-500" : ""}`}>
              <p className="font-semibold text-slate-900 dark:text-white">{plan.name}</p>
              {plan.description && <p className="text-xs text-slate-500">{plan.description}</p>}
              <p className="text-lg font-bold text-slate-900 dark:text-white">
                {formatMinor(price)} <span className="text-xs font-normal text-slate-500">/ {cycle === "ANNUAL" ? tr("year") : tr("month")}</span>
              </p>
              <p className="text-xs text-slate-500">
                {tr("Customers")}: {plan.maxCustomers ?? tr("Unlimited")} · {tr("Routers")}: {plan.maxRouters ?? tr("Unlimited")}
              </p>
              <Button className="w-full" disabled={choose.isPending} onClick={() => { setError(null); choose.mutate(plan.id); }}>
                {plan.id === currentPlanId ? tr("Keep this plan") : tr("Choose this plan")}
              </Button>
            </Card>
          );
        })}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changingPlan, setChangingPlan] = useState(false);
  const refresh = () => {
    setChangingPlan(false);
    void queryClient.invalidateQueries({ queryKey: ["billing"] });
  };

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["billing"],
    queryFn: () => apiFetch<BillingResponse>("/api/v1/billing"),
    refetchInterval: (query) =>
      query.state.data?.payments[0]?.status === "PENDING" ? 3000 : false,
  });

  const renew = useMutation({
    mutationFn: () => apiFetch("/api/v1/billing/renew", { method: "POST", body: JSON.stringify({ phone }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billing"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to start renewal"),
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">{tr("Loading subscription...")}</p>;
  }
  if (!data) {
    return (
      <p className="text-sm text-slate-400">
        {tr("Couldn't load your subscription:")} {loadError instanceof Error ? loadError.message : tr("please try again.")}
      </p>
    );
  }

  const { subscription, usage, payments, plans } = data;
  if (!subscription || changingPlan) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <IconLayers size={18} className="text-brand-600 dark:text-brand-400" />
            {subscription ? tr("Change plan") : tr("Choose your plan")}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tr("Pick a plan, then pay for it with M-Pesa on the next step. Your account unlocks as soon as the payment goes through.")}
          </p>
        </div>
        <PlanPicker plans={plans} currentPlanId={subscription?.plan.id} onChosen={refresh} />
        {subscription && (
          <Button variant="secondary" onClick={() => setChangingPlan(false)}>
            {tr("Cancel")}
          </Button>
        )}
      </div>
    );
  }

  const meta = STATUS_META[subscription.status];
  const price =
    subscription.billingCycle === "ANNUAL"
      ? subscription.plan.annualPriceMinor ?? subscription.plan.monthlyPriceMinor * 12
      : subscription.plan.monthlyPriceMinor;
  const latestPayment = payments[0];
  const periodEnd = new Date(subscription.currentPeriodEnd);
  const daysLeft = Math.ceil((periodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <IconLayers size={18} className="text-brand-600 dark:text-brand-400" />
          {tr("My Subscription")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tr("Your current plan, usage, and renewal history.")}
        </p>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{tr("Current Plan")}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{subscription.plan.name}</p>
            {subscription.status !== "ACTIVE" && latestPaymentPending(payments) === false && (
              <button type="button" className="mt-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400" onClick={() => setChangingPlan(true)}>
                {tr("Change plan")}
              </button>
            )}
          </div>
          <Badge variant={meta.variant}>
            <StatusDot status={meta.variant === "success" ? "ONLINE" : meta.variant === "danger" ? "DOWN" : "UNKNOWN"} />
            <span>{meta.label}</span>
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-slate-400 text-xs">{tr("Price")}</p>
            <p className="font-medium text-slate-800 dark:text-slate-200">
              {formatMinor(price)} / {subscription.billingCycle === "ANNUAL" ? "year" : "month"}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">
              {subscription.status === "TRIALING" ? tr("Trial ends") : subscription.status === "EXPIRED" ? tr("Status") : tr("Renews / due")}
            </p>
            <p className="font-medium text-slate-800 dark:text-slate-200">
              {subscription.status === "EXPIRED" ? tr("Not paid yet — pay below to unlock your account") : `${periodEnd.toLocaleDateString()} (${daysLeft >= 0 ? `${daysLeft} ${tr("days left")}` : tr("overdue")})`}
            </p>
          </div>
        </div>
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-obsidian-800">
          <UsageBar label={tr("Customers")} usage={usage.customers} />
          <UsageBar label={tr("Routers")} usage={usage.routers} />
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{subscription.status === "EXPIRED" ? tr("Pay now") : tr("Renew Now")}</p>
        <div>
          <Label htmlFor="phone">{tr("M-Pesa Phone Number")}</Label>
          <Input
            id="phone"
            placeholder="0712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={latestPayment?.status === "PENDING"}
          />
          <HintText>You&apos;ll receive an STK push prompt on this number for {formatMinor(price)}.</HintText>
        </div>
        <Button
          disabled={!phone || renew.isPending || latestPayment?.status === "PENDING"}
          onClick={() => {
            setError(null);
            renew.mutate();
          }}
        >
          {latestPayment?.status === "PENDING" ? tr("Waiting for payment...") : renew.isPending ? tr("Starting...") : subscription.status === "EXPIRED" ? tr("Pay with M-Pesa") : tr("Renew Now")}
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{tr("Payment History")}</p>
        {payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-obsidian-800 p-6 text-center">
            <p className="text-sm text-slate-500">{tr("No payments yet")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => (
              <Card key={payment.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {formatMinor(payment.amountMinor)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(payment.createdAt).toLocaleString()}
                    {payment.mpesaReceiptNumber ? ` · ${payment.mpesaReceiptNumber}` : ""}
                  </p>
                </div>
                <Badge
                  variant={
                    payment.status === "COMPLETED"
                      ? "success"
                      : payment.status === "PENDING"
                      ? "warning"
                      : "danger"
                  }
                >
                  {payment.status}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
