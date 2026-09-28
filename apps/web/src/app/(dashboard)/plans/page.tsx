"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label, Badge } from "@/components/ui";
import { TENANT_FEATURES as SHARED_TENANT_FEATURES, TENANT_FEATURE_LABELS } from "@mashupkgrid/shared/src/features";

// One list for the whole platform (packages/shared features.ts), so a new feature shows up here.
const TENANT_FEATURES = SHARED_TENANT_FEATURES.map((key) => ({ key, label: TENANT_FEATURE_LABELS[key] }));

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthlyPriceMinor: number;
  annualPriceMinor: number | null;
  trialDays: number;
  maxCustomers: number | null;
  maxRouters: number | null;
  features: string[];
  isDefault: boolean;
  isActive: boolean;
}

function formatMinor(amountMinor: number): string {
  return `KES ${(amountMinor / 100).toLocaleString()}`;
}

function PlanManagePanel({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const toggleFeature = useMutation({
    mutationFn: (feature: string) => {
      const next = plan.features.includes(feature)
        ? plan.features.filter((f) => f !== feature)
        : [...plan.features, feature];
      return apiFetch(`/api/v1/platform/plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({ features: next }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["all-plans"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to update feature"),
  });

  const setDefault = useMutation({
    mutationFn: () => apiFetch(`/api/v1/platform/plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["all-plans"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to set default"),
  });

  const deactivate = useMutation({
    mutationFn: () => apiFetch(`/api/v1/platform/plans/${plan.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["all-plans"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to deactivate plan"),
  });

  return (
    <div className="mt-3 space-y-4 border-t border-slate-100 pt-4 dark:border-obsidian-800">
      {error && <ErrorText>{error}</ErrorText>}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Features Included</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {TENANT_FEATURES.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={plan.features.includes(f.key)}
                disabled={toggleFeature.isPending}
                onChange={() => toggleFeature.mutate(f.key)}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!plan.isDefault && (
          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={setDefault.isPending} onClick={() => setDefault.mutate()}>
            Set as Default
          </Button>
        )}
        {!plan.isDefault && (
          <Button variant="danger" className="px-2.5 py-1 text-xs" disabled={deactivate.isPending} onClick={() => deactivate.mutate()}>
            Deactivate
          </Button>
        )}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [annualPrice, setAnnualPrice] = useState("");
  const [trialDays, setTrialDays] = useState("7");
  const [maxCustomers, setMaxCustomers] = useState("");
  const [maxRouters, setMaxRouters] = useState("");

  // /platform/plans's GET only returns isActive plans, which is exactly what a super admin
  // managing the live catalog wants to see (deactivated ones are done, not hidden-but-relevant).
  const { data: plans, isLoading } = useQuery({
    queryKey: ["all-plans"],
    queryFn: () => apiFetch<Plan[]>("/api/v1/platform/plans"),
  });

  const createPlan = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/platform/plans", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug: slug.toLowerCase().trim(),
          monthlyPriceMinor: Math.round(parseFloat(monthlyPrice || "0") * 100),
          annualPriceMinor: annualPrice ? Math.round(parseFloat(annualPrice) * 100) : undefined,
          trialDays: parseInt(trialDays || "7", 10),
          maxCustomers: maxCustomers ? parseInt(maxCustomers, 10) : null,
          maxRouters: maxRouters ? parseInt(maxRouters, 10) : null,
        }),
      }),
    onSuccess: () => {
      setName("");
      setSlug("");
      setMonthlyPrice("");
      setAnnualPrice("");
      setTrialDays("7");
      setMaxCustomers("");
      setMaxRouters("");
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["all-plans"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to create plan"),
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Subscription plans
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            The catalog of plans sold to ISP tenants — pricing, trial length, usage limits, and features.
          </p>
        </div>
        <Button className="text-xs bg-purple-600 hover:bg-purple-700 font-bold" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Close Form" : "+ New Plan"}
        </Button>
      </div>
      {showCreate && (
        <Card className="border-purple-500/40 space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              createPlan.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div>
              <Label htmlFor="name">Plan Name</Label>
              <Input
                id="name"
                placeholder="e.g. Growth"
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
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="font-mono text-sm" required />
            </div>
            <div>
              <Label htmlFor="monthlyPrice">Monthly Price (KES)</Label>
              <Input id="monthlyPrice" type="number" min="0" value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="annualPrice">Annual Price (KES, optional)</Label>
              <Input id="annualPrice" type="number" min="0" value={annualPrice} onChange={(e) => setAnnualPrice(e.target.value)} />
              <HintText>Leave blank to fall back to 12x the monthly price.</HintText>
            </div>
            <div>
              <Label htmlFor="trialDays">Trial Days</Label>
              <Input id="trialDays" type="number" min="0" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </div>
            <div />
            <div>
              <Label htmlFor="maxCustomers">Max Customers (blank = unlimited)</Label>
              <Input id="maxCustomers" type="number" min="1" value={maxCustomers} onChange={(e) => setMaxCustomers(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="maxRouters">Max Routers (blank = unlimited)</Label>
              <Input id="maxRouters" type="number" min="1" value={maxRouters} onChange={(e) => setMaxRouters(e.target.value)} />
            </div>
            <div className="sm:col-span-2 pt-1">
              <Button type="submit" disabled={createPlan.isPending} className="bg-purple-600 hover:bg-purple-700 text-white font-bold">
                {createPlan.isPending ? "Creating..." : "Create Plan"}
              </Button>
            </div>
          </form>
          {error && <ErrorText>{error}</ErrorText>}
        </Card>
      )}

      {isLoading && <p className="text-sm text-slate-500">Loading plans...</p>}

      <div className="space-y-3">
        {plans?.map((plan) => (
          <Card key={plan.id} className="py-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">{plan.name}</h3>
                  {plan.isDefault && <Badge variant="info">Default</Badge>}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {formatMinor(plan.monthlyPriceMinor)}/mo
                  {plan.annualPriceMinor ? ` · ${formatMinor(plan.annualPriceMinor)}/yr` : ""} · {plan.trialDays}-day trial ·{" "}
                  {plan.maxCustomers ?? "∞"} customers · {plan.maxRouters ?? "∞"} routers
                </p>
              </div>
              <Button variant="secondary" className="text-xs py-1.5 self-start sm:self-auto" onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}>
                {expandedId === plan.id ? "Close" : "Manage"}
              </Button>
            </div>
            {expandedId === plan.id && <PlanManagePanel plan={plan} />}
          </Card>
        ))}

        {plans && plans.length === 0 && !isLoading && (
          <div className="py-12 text-center text-xs text-slate-400">No plans yet — create one to get started.</div>
        )}
      </div>
    </div>
  );
}
