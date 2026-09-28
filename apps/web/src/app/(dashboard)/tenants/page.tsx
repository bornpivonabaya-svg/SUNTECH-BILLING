"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { Button, Card, ErrorText, HintText, Input, Label, Badge, StatusDot } from "@/components/ui";
import { IconTenants, IconCopy, IconCheck } from "@/components/icons";
import { UpgradeTenantModal } from "@/components/tenants/upgrade-tenant-modal";
import { TENANT_FEATURES as SHARED_TENANT_FEATURES, TENANT_FEATURE_LABELS } from "@mashupkgrid/shared/src/features";

// One list for the whole platform (packages/shared features.ts), so a new feature shows up here.
const TENANT_FEATURES = SHARED_TENANT_FEATURES.map((key) => ({ key, label: TENANT_FEATURE_LABELS[key] }));

interface TenantPlanSummary {
  id: string;
  name: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED" | "PENDING_APPROVAL";
  createdAt: string;
  trialEndsAt: string | null;
  disabledFeatures: string[];
  /** `https://{slug}.{platformBaseDomain}` — computed server-side (see apps/api's tenants
   *  route), not yet a live URL (no hostname-routing layer exists to serve it) but the value
   *  this tenant's subdomain will resolve to once that ships. */
  platformUrl: string;
  /** Live usage, computed server-side — see loadTenantUsage in apps/api's tenants route. */
  usage?: TenantUsage;
  /** OWN = they collect on their own M-Pesa account; PLATFORM = this platform collects and owes
   *  them the balance. */
  collectionMode?: "OWN" | "PLATFORM";
  payoutShortcode?: string | null;
  payoutShortcodeType?: "PAYBILL" | "TILL";
  /** The account that signed the ISP up (its earliest user). */
  owner?: { name: string | null; email: string; phone: string | null; emailVerified: boolean; lastLoginAt: string | null } | null;
  subscription: {
    id: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";
    billingCycle: "MONTHLY" | "ANNUAL";
    currentPeriodEnd?: string;
    plan: TenantPlanSummary;
  } | null;
}

interface TenantUsage {
  routerCount: number;
  routersOnline: number;
  customerCount: number;
  revenue30dMinor: number;
}

/**
 * Why a tenant needs attention, or null if nothing is wrong.
 *
 * Ordered by urgency, and each one is a thing a platform operator can act on today. "Never got
 * started" is the one worth reading twice: a tenant who signed up and never linked a router will
 * churn silently, and administrative state alone (ACTIVE, on a plan, trial running) makes them
 * look identical to a thriving customer.
 */
function tenantRisk(tenant: Tenant): { label: string; detail: string } | null {
  const usage = tenant.usage;
  const trialMsLeft = tenant.trialEndsAt ? new Date(tenant.trialEndsAt).getTime() - Date.now() : null;

  if (tenant.subscription?.status === "PAST_DUE") {
    return { label: "Past due", detail: "Subscription payment has failed" };
  }
  if (usage && usage.routerCount === 0) {
    return { label: "Never got started", detail: "No router has ever been linked" };
  }
  if (usage && usage.routerCount > 0 && usage.routersOnline === 0) {
    return { label: "All routers down", detail: `${usage.routerCount} linked, none reporting` };
  }
  if (trialMsLeft !== null && trialMsLeft > 0 && trialMsLeft < 3 * 24 * 60 * 60 * 1000) {
    return { label: "Trial ending", detail: "Fewer than 3 days left" };
  }
  if (usage && usage.customerCount > 0 && usage.revenue30dMinor === 0) {
    return { label: "No revenue", detail: "Has customers but took no payments in 30 days" };
  }
  return null;
}

interface PaginatedTenants {
  items: Tenant[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  platformBaseDomain: string;
}

type OnboardingFee = {
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  amountMinor: number;
  phone: string | null;
  mpesaReceiptNumber: string | null;
} | null;

function trialCountdown(trialEndsAt: string | null): string | null {
  if (!trialEndsAt) return null;
  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  if (msLeft <= 0) return "Trial ended";
  const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${days}d ${hours}h left in trial`;
}

function whatsappHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("0") ? `254${digits.slice(1)}` : digits}`;
}

/** Who to contact about this ISP, visible without opening "Manage". */
function OwnerLine({ owner }: { owner: NonNullable<Tenant["owner"]> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-semibold text-slate-700 dark:text-slate-200">{owner.name || "Owner"}</span>
      <a href={`mailto:${owner.email}`} className="text-brand-600 hover:underline dark:text-brand-400">
        {owner.email}
      </a>
      <button
        type="button"
        title="Copy email"
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        onClick={() => {
          void navigator.clipboard.writeText(owner.email);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </button>
      {owner.phone && (
        <a href={whatsappHref(owner.phone)} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline dark:text-emerald-400">
          {owner.phone} (WhatsApp)
        </a>
      )}
      {!owner.emailVerified && <span className="text-amber-600 dark:text-amber-400">email not verified</span>}
      <span className="text-slate-400">{owner.lastLoginAt ? `last signed in ${new Date(owner.lastLoginAt).toLocaleDateString()}` : "never signed in"}</span>
    </div>
  );
}

/** Extend, set or end the free trial. Uses the trial endpoint, which also keeps the ISP's trial
 *  plan in step and shows them a banner with the new date. */
/** "Activate (paid)": unlocks an ISP that paid outside M-Pesa — cash, bank, a deal. The
 *  subscription becomes active for the chosen months (added after any paid time left) and the
 *  payment is recorded in the ISP's billing history with the reference given. */
function ActivateSubscription({ tenant, plans, onError }: { tenant: Tenant; plans: TenantPlanSummary[]; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [months, setMonths] = useState(1);
  const [planId, setPlanId] = useState(tenant.subscription?.plan.id ?? "");
  const [amountKes, setAmountKes] = useState("");
  const [reference, setReference] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const activate = useMutation({
    mutationFn: () =>
      apiFetch<{ planName: string; activeUntil: string }>(`/api/v1/platform/tenants/${tenant.id}/subscription/activate`, {
        method: "POST",
        body: JSON.stringify({
          months,
          ...(planId ? { planId } : {}),
          ...(amountKes.trim() ? { amountKes: Number(amountKes) } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        }),
      }),
    onSuccess: (r) => {
      setDone(`${r.planName} is active until ${new Date(r.activeUntil).toLocaleDateString()}.`);
      setAmountKes("");
      setReference("");
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err) => onError(err instanceof ApiRequestError ? err.message : "Could not activate the subscription"),
  });
  const paidUntil = tenant.subscription?.status === "ACTIVE" && tenant.subscription.currentPeriodEnd ? new Date(tenant.subscription.currentPeriodEnd) : null;

  return (
    <div className="mt-2 rounded-xl border border-slate-200 p-3 dark:border-obsidian-800">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Activate (paid outside M-Pesa)</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        {paidUntil
          ? `Paid until ${paidUntil.toLocaleDateString()}. New months are added after that.`
          : "Unlocks the ISP now and records the payment in their billing history."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="Plan"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">{tenant.subscription ? "Current plan" : "Choose plan…"}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Months"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          {[1, 2, 3, 6, 12].map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <Input
          aria-label="Amount paid (KES)"
          inputMode="decimal"
          placeholder="Amount KES (plan price)"
          value={amountKes}
          onChange={(e) => setAmountKes(e.target.value.replace(/[^\d.]/g, ""))}
          className="!w-40 !py-1 text-xs"
        />
        <Input
          aria-label="Reference"
          placeholder="Reference (receipt, bank ref…)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="!w-52 !py-1 text-xs"
        />
        <Button
          className="px-2.5 py-1 text-xs"
          disabled={activate.isPending || (!tenant.subscription && !planId)}
          onClick={() => {
            setDone(null);
            activate.mutate();
          }}
        >
          {activate.isPending ? "Activating…" : `Activate ${months} month${months > 1 ? "s" : ""}`}
        </Button>
      </div>
      {done && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400" role="status">✓ {done}</p>}
    </div>
  );
}

function TrialControls({ tenant, onError }: { tenant: Tenant; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [until, setUntil] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const trial = useMutation({
    mutationFn: (body: { action: "extend"; days: number } | { action: "set"; until: string } | { action: "end" }) =>
      apiFetch<{ trialEndsAt: string }>(`/api/v1/platform/tenants/${tenant.id}/trial`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r, body) => {
      setDone(body.action === "end" ? "Trial ended." : `Trial now ends ${new Date(r.trialEndsAt).toLocaleString()}. The ISP sees a banner with the new date.`);
      setUntil("");
      void queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err) => onError(err instanceof ApiRequestError ? err.message : "Failed to change the trial"),
  });
  const minDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 14, 30].map((days) => (
          <Button key={days} variant="secondary" className="px-2.5 py-1 text-xs" disabled={trial.isPending} onClick={() => trial.mutate({ action: "extend", days })}>
            +{days} days
          </Button>
        ))}
        <span className="text-xs text-slate-400">or until</span>
        <input
          type="date"
          min={minDate}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          aria-label="Trial end date"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
        />
        <Button
          variant="secondary"
          className="px-2.5 py-1 text-xs"
          disabled={!until || trial.isPending}
          onClick={() => trial.mutate({ action: "set", until: new Date(`${until}T23:59:00`).toISOString() })}
        >
          Set date
        </Button>
        <Button
          variant="danger"
          className="px-2.5 py-1 text-xs"
          disabled={trial.isPending || !tenant.trialEndsAt}
          onClick={() => {
            if (confirm(`End ${tenant.name}'s free trial now? Their dashboard locks until they pay for a plan.`)) trial.mutate({ action: "end" });
          }}
        >
          End trial now
        </Button>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Extending adds days to the current end date (or to today if it has already ended) and unlocks the ISP straight away.
      </p>
      {done && <p className="text-xs text-emerald-600 dark:text-emerald-400">{done}</p>}
    </div>
  );
}

function TenantManagePanel({ tenant, onOpenUpgrade }: { tenant: Tenant; onOpenUpgrade: () => void }) {
  const queryClient = useQueryClient();
  const [collectionMode, setCollectionMode] = useState<"OWN" | "PLATFORM">(
    tenant.collectionMode ?? "OWN"
  );
  const [payoutShortcode, setPayoutShortcode] = useState(tenant.payoutShortcode ?? "");
  const [payoutShortcodeType, setPayoutShortcodeType] = useState<"PAYBILL" | "TILL">(
    tenant.payoutShortcodeType ?? "PAYBILL"
  );
  const [chargePhone, setChargePhone] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: fee } = useQuery({
    queryKey: ["onboarding-fee", tenant.id],
    queryFn: () => apiFetch<OnboardingFee>(`/api/v1/platform/tenants/${tenant.id}/onboarding-fee`),
  });

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: () => apiFetch<TenantPlanSummary[]>("/api/v1/platform/plans"),
  });

  const changePlan = useMutation({
    mutationFn: (planId: string) =>
      apiFetch(`/api/v1/platform/tenants/${tenant.id}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({ planId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to change plan"),
  });

  const toggleFeature = useMutation({
    mutationFn: (feature: string) => {
      const enabled = tenant.disabledFeatures.includes(feature);
      const next = enabled
        ? tenant.disabledFeatures.filter((f) => f !== feature)
        : [...tenant.disabledFeatures, feature];
      return apiFetch(`/api/v1/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabledFeatures: next }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to update feature"),
  });

  const clearTrial = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ trialEndsAt: null }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to clear trial"),
  });

  const saveSettlement = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/platform/tenants/${tenant.id}/settlement`, {
        method: "PATCH",
        body: JSON.stringify({ collectionMode, payoutShortcode, payoutShortcodeType }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (err) =>
      setError(err instanceof ApiRequestError ? err.message : "Failed to save collection settings"),
  });

  const chargeOnboardingFee = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/platform/tenants/${tenant.id}/onboarding-fee/charge`, {
        method: "POST",
        body: JSON.stringify({ phone: chargePhone.trim() }),
      }),
    onSuccess: () => {
      setChargePhone("");
      queryClient.invalidateQueries({ queryKey: ["onboarding-fee", tenant.id] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to send STK push"),
  });

  const sendAnnouncement = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/announcements", {
        method: "POST",
        body: JSON.stringify({
          tenantId: tenant.id,
          title: announcementTitle.trim(),
          body: announcementBody.trim(),
          severity: "INFO",
        }),
      }),
    onSuccess: () => {
      setAnnouncementTitle("");
      setAnnouncementBody("");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to send message"),
  });

  return (
    <div className="mt-3 space-y-4 border-t border-slate-100 pt-4 dark:border-obsidian-800">
      {error && <ErrorText>{error}</ErrorText>}

      {/* Plan */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Subscription Plan</p>
        <div className="flex flex-wrap items-center gap-2">
          {tenant.subscription ? (
            <Badge variant={tenant.subscription.status === "ACTIVE" ? "success" : tenant.subscription.status === "PAST_DUE" ? "warning" : tenant.subscription.status === "EXPIRED" ? "danger" : "info"}>
              {tenant.subscription.plan.name} · {tenant.subscription.status}
            </Badge>
          ) : (
            <span className="text-xs text-slate-500">No plan assigned</span>
          )}
          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs font-bold bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 border border-brand-500/30"
            onClick={onOpenUpgrade}
          >
            Upgrade Plan &amp; Quotas
          </Button>
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
            disabled={changePlan.isPending}
            value=""
            onChange={(e) => {
              if (e.target.value) changePlan.mutate(e.target.value);
            }}
          >
            <option value="">Quick override...</option>
            {plans?.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>
        <ActivateSubscription tenant={tenant} plans={plans ?? []} onError={setError} />
      </div>
      {/* Settlement — who collects this tenant's customer payments, and where their money is
          sent when this platform collects on their behalf. */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Money collection
        </p>
        <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-obsidian-800">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
              value={collectionMode}
              onChange={(e) => setCollectionMode(e.target.value as "OWN" | "PLATFORM")}
            >
              <option value="OWN">They collect (their own M-Pesa)</option>
              <option value="PLATFORM">I collect (my paybill, I pay them out)</option>
            </select>
            <Badge variant={tenant.collectionMode === "PLATFORM" ? "warning" : "neutral"}>
              Currently: {tenant.collectionMode === "PLATFORM" ? "Platform collects" : "Tenant collects"}
            </Badge>
          </div>
          {collectionMode === "PLATFORM" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="Their paybill or till number"
                value={payoutShortcode}
                onChange={(e) => setPayoutShortcode(e.target.value)}
              />
              <select
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-100"
                value={payoutShortcodeType}
                onChange={(e) => setPayoutShortcodeType(e.target.value as "PAYBILL" | "TILL")}
              >
                <option value="PAYBILL">Paybill</option>
                <option value="TILL">Till (Buy Goods)</option>
              </select>
            </div>
          )}

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Switching to &quot;I collect&quot; changes where this tenant&apos;s customers&apos; money
            lands from their account to yours. They are then owed a balance which is paid out
            automatically to the number above.
          </p>
          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs"
            disabled={saveSettlement.isPending}
            onClick={() => saveSettlement.mutate()}
          >
            {saveSettlement.isPending ? "Saving..." : "Save collection settings"}
          </Button>
        </div>
      </div>
      {/* Trial controls */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Free Trial</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {tenant.trialEndsAt
              ? `${trialCountdown(tenant.trialEndsAt)} (ends ${new Date(tenant.trialEndsAt).toLocaleString()})`
              : "No trial set"}
          </span>
          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => clearTrial.mutate()}>
            Mark as paid (clear trial)
          </Button>
        </div>
        <div className="mt-2">
          <TrialControls tenant={tenant} onError={setError} />
        </div>
      </div>
      {/* Onboarding fee */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Onboarding Fee (KES 450)
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {fee ? (
            <Badge variant={fee.status === "COMPLETED" ? "success" : fee.status === "PENDING" ? "warning" : "danger"}>
              {fee.status}
              {fee.mpesaReceiptNumber ? ` · ${fee.mpesaReceiptNumber}` : ""}
            </Badge>
          ) : (
            <span className="text-xs text-slate-500">Not charged yet</span>
          )}
          {fee?.status !== "COMPLETED" && (
            <>
              <Input
                placeholder="0712345678"
                value={chargePhone}
                onChange={(e) => setChargePhone(e.target.value)}
                className="w-40 py-1 text-xs"
              />
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                disabled={!chargePhone.trim() || chargeOnboardingFee.isPending}
                onClick={() => chargeOnboardingFee.mutate()}
              >
                {chargeOnboardingFee.isPending ? "Sending STK..." : "Charge via M-Pesa"}
              </Button>
            </>
          )}
        </div>
      </div>
      {/* Feature toggles */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Features</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {TENANT_FEATURES.map((f) => {
            const enabled = !tenant.disabledFeatures.includes(f.key);
            return (
              <label key={f.key} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={toggleFeature.isPending}
                  onChange={() => toggleFeature.mutate(f.key)}
                />
                {f.label}
              </label>
            );
          })}
        </div>
      </div>
      {/* Send announcement */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Send a Message to This Tenant
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            sendAnnouncement.mutate();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Input
            placeholder="Title"
            value={announcementTitle}
            onChange={(e) => setAnnouncementTitle(e.target.value)}
            className="w-40 py-1 text-xs"
            required
          />
          <Input
            placeholder="Message"
            value={announcementBody}
            onChange={(e) => setAnnouncementBody(e.target.value)}
            className="flex-1 min-w-[200px] py-1 text-xs"
            required
          />
          <Button type="submit" variant="secondary" className="px-2.5 py-1 text-xs" disabled={sendAnnouncement.isPending}>
            {sendAnnouncement.isPending ? "Sending..." : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function TenantsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [provisionSuccessData, setProvisionSuccessData] = useState<{
    name: string;
    slug: string;
    subdomainUrl: string;
    dashboardLoginUrl: string;
    owner?: { email: string; name: string; phone?: string; temporaryPassword?: string } | null;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "TRIAL" | "SUSPENDED" | "PENDING" | "ATTENTION">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [upgradeTenant, setUpgradeTenant] = useState<Tenant | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => apiFetch<PaginatedTenants>("/api/v1/platform/tenants?limit=100"),
  });

  const copyPlatformUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const createTenant = useMutation({
    mutationFn: () =>
      apiFetch<{
        name: string;
        slug: string;
        subdomainUrl: string;
        dashboardLoginUrl: string;
        owner?: { email: string; name: string; phone?: string; temporaryPassword?: string } | null;
      }>("/api/v1/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug: slug.toLowerCase().trim(),
          ownerName: ownerName.trim() || undefined,
          ownerEmail: ownerEmail.trim() || undefined,
          ownerPhone: ownerPhone.trim() || undefined,
          ownerPassword: ownerPassword.trim() || undefined,
        }),
      }),
    onSuccess: (res) => {
      setProvisionSuccessData(res);
      setName("");
      setSlug("");
      setOwnerName("");
      setOwnerEmail("");
      setOwnerPhone("");
      setOwnerPassword("");
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to create tenant"),
  });

  const toggleSuspend = useMutation({
    mutationFn: ({ id, suspend }: { id: string; suspend: boolean }) =>
      apiFetch(`/api/v1/platform/tenants/${id}/${suspend ? "suspend" : "reactivate"}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to update tenant"),
  });

  // Approval sends the owner their sign-in details automatically (email, and WhatsApp when they
  // gave a number) — the server reports which channels were queued so the admin knows.
  const [decisionNote, setDecisionNote] = useState<string | null>(null);
  const approveTenant = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ name: string; notified: { email: boolean; whatsapp: boolean } }>(`/api/v1/platform/tenants/${id}/approve`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      const channels = [res.notified.email && "email", res.notified.whatsapp && "WhatsApp"].filter(Boolean).join(" and ");
      setDecisionNote(`${res.name} approved. Sign-in details sent by ${channels || "no channel — the owner has no contact details on file"}.`);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to approve tenant"),
  });
  const rejectTenant = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<{ name: string }>(`/api/v1/platform/tenants/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      setDecisionNote(`${res.name} was not approved. The applicant has been told.`);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to reject tenant"),
  });
  const askRejectReason = (id: string, name: string) => {
    const reason = window.prompt(`Why is ${name} not being approved? This is sent to the applicant (leave empty to send no reason).`);
    if (reason === null) return; // cancelled
    rejectTenant.mutate({ id, reason: reason.trim().slice(0, 500) });
  };

  const sendBroadcast = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/announcements", {
        method: "POST",
        body: JSON.stringify({
          tenantId: null,
          title: broadcastTitle.trim(),
          body: broadcastBody.trim(),
          severity: "INFO",
        }),
      }),
    onSuccess: () => {
      setBroadcastTitle("");
      setBroadcastBody("");
      setShowBroadcast(false);
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to send broadcast"),
  });

  const allItems = data?.items ?? [];
  const totalCount = allItems.length;
  const activeCount = allItems.filter((t) => t.status === "ACTIVE").length;
  const trialCount = allItems.filter((t) => t.trialEndsAt && new Date(t.trialEndsAt) > new Date()).length;
  const suspendedCount = allItems.filter((t) => t.status === "SUSPENDED").length;
  const pendingCount = allItems.filter((t) => t.status === "PENDING_APPROVAL").length;
  const attentionCount = allItems.filter((t) => tenantRisk(t) !== null).length;

  const filteredItems = allItems.filter((tenant) => {
    const q = search.toLowerCase();
    const matchesSearch =
      search === "" ||
      [tenant.name, tenant.slug, tenant.owner?.name, tenant.owner?.email, tenant.owner?.phone].some((v) => v?.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (statusFilter === "ACTIVE") return tenant.status === "ACTIVE";
    if (statusFilter === "SUSPENDED") return tenant.status === "SUSPENDED";
    if (statusFilter === "PENDING") return tenant.status === "PENDING_APPROVAL";
    if (statusFilter === "TRIAL") return Boolean(tenant.trialEndsAt && new Date(tenant.trialEndsAt) > new Date());
    if (statusFilter === "ATTENTION") return tenantRisk(tenant) !== null;
    return true;
  });

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <IconTenants size={20} />
            </span>
            ISPs
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Every ISP on the platform: applications to approve, trials, plans and status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="text-xs" onClick={() => setShowBroadcast((v) => !v)}>
            {showBroadcast ? "Cancel" : "Send announcement"}
          </Button>
          <Button
            className="text-xs font-medium"
            onClick={() => setShowProvision((v) => !v)}
          >
            {showProvision ? "Cancel" : "Add an ISP"}
          </Button>
        </div>
      </div>
      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div
          onClick={() => setStatusFilter("ALL")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "ALL"
              ? "border-brand-500/50"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 block">Total Tenants</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{totalCount}</span>
        </div>
        <div
          onClick={() => setStatusFilter("ACTIVE")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "ACTIVE"
              ? "bg-emerald-50/50 border-emerald-500/50 dark:bg-emerald-950/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 block">Active</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{activeCount}</span>
        </div>
        <div
          onClick={() => setStatusFilter("TRIAL")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "TRIAL"
              ? "bg-amber-50/50 border-amber-500/50 dark:bg-amber-950/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 block">In Trial</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{trialCount}</span>
        </div>
        <div
          onClick={() => setStatusFilter("SUSPENDED")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "SUSPENDED"
              ? "bg-rose-50/50 border-rose-500/50 dark:bg-rose-950/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 block">Suspended</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{suspendedCount}</span>
        </div>
        <div
          onClick={() => setStatusFilter("PENDING")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "PENDING"
              ? "bg-orange-50/50 border-orange-500/50 dark:bg-orange-950/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 block">Pending</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{pendingCount}</span>
        </div>
        {/* The card an operator should look at first: administrative status says a tenant is
            fine, usage says whether they actually are. */}
        <div
          onClick={() => setStatusFilter("ATTENTION")}
          className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === "ATTENTION"
              ? "bg-amber-50/50 border-amber-500/50 dark:bg-amber-950/20"
              : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
          }`}
        >
          <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Needs attention
          </span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{attentionCount}</span>
        </div>
      </div>
      {/* Broadcast Box */}
      {showBroadcast && (
        <Card className="border-brand-500/40 bg-brand-50/20 dark:bg-brand-950/20 space-y-3">
          <h2 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            Broadcast Announcement to Every Tenant
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              sendBroadcast.mutate();
            }}
            className="space-y-3"
          >
            <Input placeholder="Title" value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} required />
            <Input placeholder="Message" value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} required />
            <Button type="submit" disabled={sendBroadcast.isPending}>
              {sendBroadcast.isPending ? "Sending..." : "Send to All Tenants"}
            </Button>
          </form>
        </Card>
      )}

      {/* Provision Success Dialog / Card */}
      {provisionSuccessData && (
        <Card className="border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/20 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
            <div className="flex items-center gap-2">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Tenant Provisioned Successfully!</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Subdomain and credentials have been dispatched via WhatsApp and Email to the tenant owner.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProvisionSuccessData(null)}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-white dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block">Dedicated Subdomain</span>
              <a
                href={provisionSuccessData.dashboardLoginUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-brand-600 dark:text-brand-400 font-medium text-xs hover:underline flex items-center gap-1 mt-0.5"
              >
                {provisionSuccessData.subdomainUrl}
                
              </a>
            </div>
            <div className="bg-white dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 block">Owner Login Username</span>
              <span className="font-semibold text-slate-900 dark:text-white text-xs block mt-0.5">
                {provisionSuccessData.owner?.email ?? "No owner account"}
              </span>
            </div>
            {provisionSuccessData.owner?.temporaryPassword && (
              <div className="sm:col-span-2 bg-white dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-500 block">Temporary Password</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white text-sm">
                    {provisionSuccessData.owner.temporaryPassword}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const text = `Organization: ${provisionSuccessData.name}\nSubdomain: ${provisionSuccessData.subdomainUrl}\nUsername: ${provisionSuccessData.owner?.email}\nPassword: ${provisionSuccessData.owner?.temporaryPassword}\nLogin: ${provisionSuccessData.dashboardLoginUrl}`;
                    navigator.clipboard.writeText(text);
                    setCopiedCredentials(true);
                    setTimeout(() => setCopiedCredentials(false), 2500);
                  }}
                  className="text-xs font-semibold"
                >
                  {copiedCredentials ? "Copied! ✓" : "Copy All Credentials"}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Provision New Tenant Card */}
      {showProvision && (
        <Card className="border-obsidian-700 space-y-4">
          <div className="pb-2 border-b border-slate-100 dark:border-slate-800">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">Provision New ISP Tenant</h2>
            <p className="text-xs text-slate-500">
              Creates a dedicated tenant domain, owner credentials, FreeRADIUS database slice, and trial. Dispatches welcome details via WhatsApp & Email.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              createTenant.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div>
              <Label htmlFor="name">Organization / ISP Name</Label>
              <Input
                id="name"
                placeholder="e.g. SafariNet ISP Ltd"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]/g, "-")) {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""));
                  }
                }}
                required
              />
            </div>
            <div>
              <Label htmlFor="slug">Subdomain / Tenant Slug</Label>
              <Input
                id="slug"
                placeholder="e.g. safarinet"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="font-mono text-sm"
                required
              />
              <p className="text-[10px] text-slate-400 mt-1 font-mono">
                URL: https://{slug || "your-slug"}.{data?.platformBaseDomain ?? "mashuphost.tech"}
              </p>
            </div>
            <div>
              <Label htmlFor="ownerName">Owner Full Name (Optional)</Label>
              <Input
                id="ownerName"
                placeholder="e.g. Jane Mwangi"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ownerEmail">Owner Email (For Login & Credentials)</Label>
              <Input
                id="ownerEmail"
                type="email"
                placeholder="owner@isp.co.ke"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                required
              />
              <HintText>Receives subdomain details, username and temporary password.</HintText>
            </div>
            <div>
              <Label htmlFor="ownerPhone">Owner Phone (WhatsApp & M-Pesa)</Label>
              <Input
                id="ownerPhone"
                placeholder="0712345678"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                required
              />
              <HintText>
                Receives WhatsApp welcome message. Auto-normalizes to Kenyan international format (+254).
              </HintText>
            </div>
            <div>
              <Label htmlFor="ownerPassword">Initial Password (Optional)</Label>
              <Input
                id="ownerPassword"
                type="password"
                placeholder="Leave blank to auto-generate"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
              />
              <HintText>Auto-generates a secure password if left empty.</HintText>
            </div>
            <div className="sm:col-span-2 pt-1 flex items-center justify-between">
              <Button type="button" variant="outline" onClick={() => setShowProvision(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTenant.isPending} className="text-white font-medium">
                {createTenant.isPending ? "Provisioning..." : "Create Tenant Account & Send Credentials"}
              </Button>
            </div>
          </form>
          {error && <ErrorText>{error}</ErrorText>}
          {decisionNote && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              {decisionNote}
            </div>
          )}
        </Card>
      )}

      {/* Search & Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search by ISP, address, owner name, email or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
          />
        </div>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading tenants...</p>}

      {/* Tenants List */}
      <div className="space-y-3">
        {filteredItems.map((tenant) => {
          const countdown = trialCountdown(tenant.trialEndsAt);
          const risk = tenantRisk(tenant);
          const usage = tenant.usage;
          return (
            <Card key={tenant.id} className="py-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">{tenant.name}</h3>
                    <span className="font-mono text-xs text-slate-300 bg-obsidian-800 px-2 py-0.5 rounded-md border border-obsidian-700">
                      {tenant.slug}
                    </span>
                    {risk && (
                      <span
                        title={risk.detail}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        {risk.label}
                      </span>
                    )}
                    {/* Visible without expanding: whose account this tenant's customer payments
                        land in is the first thing to know about them, and hunting for it inside a
                        panel is how a tenant ends up collecting the wrong way for a month. */}
                    {tenant.collectionMode === "PLATFORM" ? (
                      <span
                        title={
                          tenant.payoutShortcode
                            ? `Paid out to ${tenant.payoutShortcodeType === "TILL" ? "till" : "paybill"} ${tenant.payoutShortcode}`
                            : "No payout number set — their balance is held until they add one"
                        }
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          tenant.payoutShortcode
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {tenant.payoutShortcode ? `Pays to ${tenant.payoutShortcode}` : "No payout number"}
                      </span>
                    ) : (
                      <span className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-obsidian-700">
                        Collects their own
                      </span>
                    )}
                  </div>
                  {tenant.owner && <OwnerLine owner={tenant.owner} />}
                  <p className="text-xs text-slate-400 mt-1">
                    Created {new Date(tenant.createdAt).toLocaleDateString()}
                    {countdown && (
                      <span className={countdown === "Trial ended" ? "ml-2 text-rose-500 font-semibold" : "ml-2 text-amber-500 font-semibold"}>
                        · {countdown}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="font-mono text-[11px] text-slate-500">{tenant.platformUrl}</span>
                    <button
                      type="button"
                      onClick={() => copyPlatformUrl(tenant.platformUrl)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      title="Copy platform URL"
                    >
                      {copiedUrl === tenant.platformUrl ? <IconCheck size={12} /> : <IconCopy size={12} />}
                    </button>
                  </div>
                  {/* Live usage — what administrative status cannot tell you. */}
                  {usage && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {usage.routersOnline}/{usage.routerCount}
                        </span>{" "}
                        routers online
                      </span>
                      <span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {usage.customerCount}
                        </span>{" "}
                        customers
                      </span>
                      <span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {formatMoney(usage.revenue30dMinor)}
                        </span>{" "}
                        in 30 days
                      </span>
                      {risk && <span className="text-amber-600 dark:text-amber-400">{risk.detail}</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                  <a
                    href={`/hotspot/${tenant.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-white hover:text-white hidden md:inline-block px-1"
                  >
                    Preview Portal &rarr;
                  </a>
                  <Button
                    className="text-xs py-1.5 bg-brand-600 hover:bg-brand-500 text-white font-bold"
                    onClick={() => setUpgradeTenant(tenant)}
                  >
                    Upgrade
                  </Button>
                  <Badge variant={tenant.status === "ACTIVE" ? "success" : tenant.status === "PENDING_APPROVAL" ? "warning" : "danger"}>
                    <StatusDot status={tenant.status} />
                    <span>{tenant.status === "PENDING_APPROVAL" ? "PENDING" : tenant.status}</span>
                  </Badge>
                  <Button
                    variant="secondary"
                    className="text-xs py-1.5"
                    onClick={() => setExpandedId(expandedId === tenant.id ? null : tenant.id)}
                  >
                    {expandedId === tenant.id ? "Close" : "Manage"}
                  </Button>
                  {tenant.status === "PENDING_APPROVAL" ? (
                    <>
                      <Button
                        className="text-xs py-1.5"
                        onClick={() => approveTenant.mutate(tenant.id)}
                        disabled={approveTenant.isPending || rejectTenant.isPending}
                      >
                        {approveTenant.isPending ? "Approving…" : "Approve"}
                      </Button>
                      <Button
                        variant="outline"
                        className="text-xs py-1.5"
                        onClick={() => askRejectReason(tenant.id, tenant.name)}
                        disabled={approveTenant.isPending || rejectTenant.isPending}
                      >
                        Reject
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant={tenant.status === "ACTIVE" ? "danger" : "secondary"}
                      className="text-xs py-1.5"
                      onClick={() => toggleSuspend.mutate({ id: tenant.id, suspend: tenant.status === "ACTIVE" })}
                      disabled={toggleSuspend.isPending}
                    >
                      {tenant.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                    </Button>
                  )}
                </div>
              </div>
              {expandedId === tenant.id && (
                <TenantManagePanel
                  tenant={tenant}
                  onOpenUpgrade={() => setUpgradeTenant(tenant)}
                />
              )}
            </Card>
          );
        })}

        {filteredItems.length === 0 && !isLoading && (
          <div className="py-12 text-center text-xs text-slate-400">
            No tenants match your search/filter criteria.
          </div>
        )}
      </div>
      {upgradeTenant && (
        <UpgradeTenantModal
          tenant={upgradeTenant}
          onClose={() => setUpgradeTenant(null)}
        />
      )}
    </div>
  );
}
