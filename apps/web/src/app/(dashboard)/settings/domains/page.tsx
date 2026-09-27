"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label, Badge, StatusDot } from "@/components/ui";
import { IconGlobe, IconCopy, IconCheck } from "@/components/icons";
import { tr } from "@/lib/tr";

type DomainStatus =
  | "PENDING"
  | "CHECKING"
  | "VERIFIED"
  | "DNS_ERROR"
  | "SSL_PENDING"
  | "SSL_ACTIVE"
  | "SUSPENDED"
  | "REMOVED";

interface Domain {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  lastError: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface TenantSettings {
  slug: string;
  platformUrl: string;
}

const STATUS_META: Record<DomainStatus, { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  PENDING: { label: "Pending", variant: "neutral" },
  CHECKING: { label: "Checking", variant: "info" },
  VERIFIED: { label: "Verified", variant: "success" },
  DNS_ERROR: { label: "DNS Error", variant: "danger" },
  SSL_PENDING: { label: "SSL Pending", variant: "warning" },
  SSL_ACTIVE: { label: "SSL Active", variant: "success" },
  SUSPENDED: { label: "Suspended", variant: "danger" },
  REMOVED: { label: "Removed", variant: "neutral" },
};

function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-lg bg-slate-100 dark:bg-obsidian-900 px-2.5 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        title={tr("Copy")}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

interface SetupPlan {
  hostname: string;
  zone: string | null;
  nameservers: string[];
  provider: { id: string; name: string; site: string; color: string; steps: string[]; hostField: string; note?: string };
  detected: boolean;
  records: { type: "CNAME" | "A"; host: string; value: string; ttl: string }[];
  isRoot: boolean;
  dnsUrl: string | null;
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The DNS company's icon (from its own site), or its initial on its brand colour if that can't load. */
function ProviderLogo({ provider }: { provider: SetupPlan["provider"] }) {
  const [failed, setFailed] = useState(false);
  if (!provider.site || failed) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white" style={{ background: provider.color }}>
        {provider.name.charAt(0)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${provider.site}&sz=64`}
      alt={provider.name}
      width={40}
      height={40}
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white p-1.5 dark:border-obsidian-700"
    />
  );
}

/** Who runs the domain's DNS, their own steps, and the exact record to add there. */
function ProviderSetup({ plan }: { plan: SetupPlan }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-obsidian-800">
      <div className="flex items-center gap-3">
        <ProviderLogo provider={plan.provider} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {plan.detected ? tr("Your DNS is at {name}").replace("{name}", plan.provider.name) : tr("We couldn't tell who runs this domain's DNS")}
          </p>
          <p className="truncate text-xs text-slate-500">
            {plan.nameservers.length ? `${tr("Nameservers")}: ${plan.nameservers.slice(0, 2).join(", ")}` : tr("No nameservers found yet. Check the spelling, or that the domain is registered.")}
          </p>
        </div>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
        {plan.provider.steps.map((step) => (
          <li key={step}>{tr(step)}</li>
        ))}
      </ol>
      <div className="space-y-2">
        {plan.records.map((r) => (
          <div key={`${r.type}-${r.value}`} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-obsidian-900/60">
            <span className="text-slate-400">{tr("Type")}</span>
            <span className="font-mono font-semibold">{r.type}</span>
            <span className="text-slate-400">{tr(plan.provider.hostField)}</span>
            <CopyableValue value={r.host} />
            <span className="text-slate-400">{r.type === "A" ? tr("Value / Points to") : tr("Value / Target")}</span>
            <CopyableValue value={r.value} />
            <span className="text-slate-400">TTL</span>
            <span>{tr(r.ttl)}</span>
          </div>
        ))}
      </div>
      {plan.provider.note && <p className="text-xs text-amber-600 dark:text-amber-400">{tr(plan.provider.note)}</p>}
      {plan.dnsUrl && (
        <a href={plan.dnsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
          {tr("Open {name} DNS settings").replace("{name}", plan.provider.name)} ↗
        </a>
      )}
    </div>
  );
}

function DomainCard({ domain }: { domain: Domain }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS_META[domain.status];

  const verify = useMutation({
    mutationFn: () => apiFetch<Domain>(`/api/v1/domains/${domain.id}/verify`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["domains"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Verification failed"),
  });

  const setPrimary = useMutation({
    mutationFn: () => apiFetch(`/api/v1/domains/${domain.id}/set-primary`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["domains"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to set primary"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/v1/domains/${domain.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["domains"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to remove domain"),
  });

  const isVerified = domain.status === "VERIFIED" || domain.status === "SSL_ACTIVE" || domain.status === "SSL_PENDING";
  const { data: setup } = useQuery({
    queryKey: ["domain-setup", domain.id],
    queryFn: () => apiFetch<SetupPlan>(`/api/v1/domains/${domain.id}/setup`),
    enabled: !isVerified,
    staleTime: 10 * 60 * 1000,
  });

  // Keep checking on our own while the page is open: no "verify" button to remember.
  const verifyNow = verify.mutate;
  useEffect(() => {
    if (isVerified) return;
    const id = setInterval(() => verifyNow(), 30_000);
    return () => clearInterval(id);
  }, [isVerified, verifyNow]);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{domain.hostname}</span>
          {domain.isPrimary && <Badge variant="info">{tr("Primary")}</Badge>}
        </div>
        <Badge variant={meta.variant}>
          <StatusDot status={meta.variant === "success" ? "ONLINE" : meta.variant === "danger" ? "DOWN" : "UNKNOWN"} />
          <span>{meta.label}</span>
        </Badge>
      </div>

      {!isVerified && setup && <ProviderSetup plan={setup} />}
      {!isVerified && (
        <p className="text-xs text-slate-500">
          {tr("We check automatically every 30 seconds while this page is open, and every few minutes after that. It goes live on its own once the record shows up.")}
        </p>
      )}
      {!isVerified && domain.lastError && <ErrorText>{domain.lastError}</ErrorText>}

      <div className="flex items-center gap-2">
        {!isVerified && (
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => { setError(null); verify.mutate(); }} disabled={verify.isPending}>
            {verify.isPending ? tr("Checking DNS...") : tr("Check now")}
          </Button>
        )}
        {isVerified && !domain.isPrimary && (
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => { setError(null); setPrimary.mutate(); }} disabled={setPrimary.isPending}>
            {setPrimary.isPending ? "Setting..." : "Make Primary"}
          </Button>
        )}
        <Button
          variant="danger"
          className="text-xs py-1.5"
          onClick={() => {
            if (confirm(`Remove "${domain.hostname}"?`)) {
              setError(null);
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
        >
          {tr("Remove")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

export default function DomainManagementPage() {
  const queryClient = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<TenantSettings>("/api/v1/settings"),
  });

  const { data: domains, isLoading } = useQuery({
    queryKey: ["domains"],
    queryFn: () => apiFetch<Domain[]>("/api/v1/domains"),
  });

  // As the ISP types, find out who runs the domain's DNS and show their steps before saving.
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [detecting, setDetecting] = useState(false);
  useEffect(() => {
    const h = hostname.trim().toLowerCase();
    setPlan(null);
    if (!HOSTNAME.test(h)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setDetecting(true);
      apiFetch<SetupPlan>("/api/v1/domains/detect", { method: "POST", body: JSON.stringify({ hostname: h }) })
        .then((p) => !cancelled && setPlan(p))
        .catch(() => undefined)
        .finally(() => !cancelled && setDetecting(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [hostname]);

  const addDomain = useMutation({
    mutationFn: () => apiFetch("/api/v1/domains", { method: "POST", body: JSON.stringify({ hostname: hostname.trim().toLowerCase() }) }),
    onSuccess: () => {
      setHostname("");
      setShowConnect(false);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to add domain"),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <IconGlobe size={18} className="text-brand-600 dark:text-brand-400" />
          {tr("Domain Management")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tr("Your platform subdomain always works — connect a custom domain if you want your own branded URL.")}
        </p>
      </div>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{tr("Your Platform Domain")}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{settings?.platformUrl ?? "..."}</span>
          <Badge variant="success">
            <StatusDot status="ONLINE" />
            <span>{tr("Active")}</span>
          </Badge>
        </div>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{tr("Custom Domain")}</p>
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => setShowConnect((v) => !v)}>
            {showConnect ? "Cancel" : "+ Connect Custom Domain"}
          </Button>
        </div>

        {showConnect && (
          <Card className="mb-3 border-brand-500/40 bg-brand-50/20 dark:bg-brand-950/20">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                addDomain.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor="hostname">{tr("Domain")}</Label>
                <Input
                  id="hostname"
                  placeholder="billing.yourcompany.co.ke"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
                <HintText>{tr("A subdomain of a domain you own works best, like wifi.yourcompany.co.ke. We detect your domain company as you type.")}</HintText>
              </div>
              {detecting && <p className="text-xs text-slate-500">{tr("Finding your domain company…")}</p>}
              {plan && <ProviderSetup plan={plan} />}
              <Button type="submit" disabled={addDomain.isPending}>
                {addDomain.isPending ? tr("Connecting...") : tr("Connect Domain")}
              </Button>
              {error && <ErrorText>{error}</ErrorText>}
            </form>
          </Card>
        )}

        {isLoading && <p className="text-sm text-slate-500">{tr("Loading domains...")}</p>}

        {domains && domains.length === 0 && !showConnect && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-obsidian-800 p-6 text-center">
            <p className="text-sm text-slate-500">{tr("No custom domain connected")}</p>
          </div>
        )}

        <div className="space-y-3">
          {domains?.map((domain) => (
            <DomainCard key={domain.id} domain={domain} />
          ))}
        </div>
      </div>
    </div>
  );
}
