"use client";

import { useState } from "react";
import Link from "next/link";
import { tr } from "@/lib/tr";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label, Badge, StatCard } from "@/components/ui";
import { IconLayers, IconRouter } from "@/components/icons";

type VlanType =
  | "CUSTOMER_INTERNET"
  | "BUSINESS_INTERNET"
  | "IPTV"
  | "VOIP"
  | "HOTSPOT"
  | "MANAGEMENT"
  | "GUEST"
  | "CUSTOM";

const VLAN_TYPES: VlanType[] = [
  "CUSTOMER_INTERNET",
  "BUSINESS_INTERNET",
  "IPTV",
  "VOIP",
  "HOTSPOT",
  "MANAGEMENT",
  "GUEST",
  "CUSTOM",
];

const TYPE_LABELS: Record<VlanType, string> = {
  CUSTOMER_INTERNET: "Customer Internet",
  BUSINESS_INTERNET: "Business Internet",
  IPTV: "IPTV",
  VOIP: "VoIP",
  HOTSPOT: "Hotspot",
  MANAGEMENT: "Management",
  GUEST: "Guest Network",
  CUSTOM: "Custom",
};

interface Vlan {
  id: string;
  vlanTag: number;
  name: string;
  description: string | null;
  type: VlanType;
  customTypeLabel: string | null;
  routerId: string | null;
  router: { id: string; name: string } | null;
  subnetCidr: string | null;
  gateway: string | null;
  isEnabled: boolean;
  provisioningStatus: "NOT_PROVISIONED" | "PENDING" | "ACTIVE" | "FAILED";
  lastProvisioningError: string | null;
  packageCount: number;
}

interface Overview {
  total: number;
  enabled: number;
  disabled: number;
  byType: Record<string, number>;
  provisioningFailed: number;
}

interface RouterOption {
  id: string;
  name: string;
}

/**
 * The two status columns are deliberately separate and never merged.
 *
 * "Enabled" is what an administrator switched on in this system. "On device" is whether a router
 * has actually confirmed the configuration. They diverge constantly — a VLAN can be enabled here
 * and absent from the box — and a single combined badge would let the dashboard imply live
 * network state it has no evidence for.
 */
function DeviceStatusBadge({ vlan }: { vlan: Vlan }) {
  switch (vlan.provisioningStatus) {
    case "ACTIVE":
      return <Badge variant="success">On device</Badge>;
    case "FAILED":
      return <Badge variant="danger">Failed</Badge>;
    case "PENDING":
      return <Badge variant="warning">Pending</Badge>;
    default:
      return <Badge variant="neutral">Not on device</Badge>;
  }
}

export default function VlansPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | VlanType>("");
  const [routerFilter, setRouterFilter] = useState("");

  const [vlanTag, setVlanTag] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<VlanType>("CUSTOMER_INTERNET");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [routerId, setRouterId] = useState("");
  const [subnetCidr, setSubnetCidr] = useState("");
  const [gateway, setGateway] = useState("");

  const filterQuery = new URLSearchParams();
  if (search.trim()) filterQuery.set("search", search.trim());
  if (typeFilter) filterQuery.set("type", typeFilter);
  if (routerFilter) filterQuery.set("routerId", routerFilter);
  const qs = filterQuery.toString();

  const { data: vlans, isLoading } = useQuery({
    queryKey: ["vlans", qs],
    queryFn: () => apiFetch<Vlan[]>(`/api/v1/vlans${qs ? `?${qs}` : ""}`),
  });
  const { data: overview } = useQuery({
    queryKey: ["vlans-overview"],
    queryFn: () => apiFetch<Overview>("/api/v1/vlans/overview"),
  });
  const { data: routers } = useQuery({
    queryKey: ["routers-for-vlans"],
    queryFn: () => apiFetch<RouterOption[]>("/api/v1/routers"),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["vlans"] });
    queryClient.invalidateQueries({ queryKey: ["vlans-overview"] });
  };

  const createVlan = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/vlans", {
        method: "POST",
        body: JSON.stringify({
          vlanTag: Number(vlanTag),
          name,
          type,
          customTypeLabel: type === "CUSTOM" ? customTypeLabel : undefined,
          routerId: routerId || undefined,
          subnetCidr: subnetCidr || undefined,
          gateway: gateway || undefined,
        }),
      }),
    onSuccess: () => {
      setVlanTag("");
      setName("");
      setSubnetCidr("");
      setGateway("");
      setCustomTypeLabel("");
      setShowForm(false);
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to create VLAN"),
  });

  const toggleEnabled = useMutation({
    mutationFn: (v: Vlan) =>
      apiFetch(`/api/v1/vlans/${v.id}/enabled`, {
        method: "POST",
        body: JSON.stringify({ isEnabled: !v.isEnabled }),
      }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to update VLAN"),
  });

  const deleteVlan = useMutation({
    mutationFn: (v: Vlan) => apiFetch(`/api/v1/vlans/${v.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    // The API refuses to delete a VLAN packages still use and says which ones. Surfacing that
    // message verbatim is the whole value — a generic "failed" would leave the admin guessing.
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to delete VLAN"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">VLANs</h1>
          <HintText>
            Network segments customers are placed on through their package.
          </HintText>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vlans/guide" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-obsidian-700 dark:text-slate-200 dark:hover:bg-obsidian-800">
            {tr("VLAN manual")}
          </Link>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Create VLAN"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Total" value={overview?.total ?? "—"} icon={<IconLayers size={18} />} />
        <StatCard title="Enabled" value={overview?.enabled ?? "—"} />
        <StatCard title="Disabled" value={overview?.disabled ?? "—"} />
        <StatCard
          title="Provisioning errors"
          value={overview?.provisioningFailed ?? "—"}
          subtitle={overview?.provisioningFailed ? "Needs attention" : undefined}
        />
      </div>

      {error && (
        <Card>
          <ErrorText>{error}</ErrorText>
        </Card>
      )}

      {showForm && (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              createVlan.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="vlanTag">VLAN ID</Label>
                <Input
                  id="vlanTag"
                  type="number"
                  min={1}
                  max={4094}
                  value={vlanTag}
                  onChange={(e) => setVlanTag(e.target.value)}
                  placeholder="20"
                  required
                />
                <HintText>1–4094. Must be unique on the router it is assigned to.</HintText>
              </div>
              <div>
                <Label htmlFor="vlanName">Name</Label>
                <Input
                  id="vlanName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Home Internet"
                  required
                />
              </div>
              <div>
                <Label htmlFor="vlanType">Type</Label>
                <select
                  id="vlanType"
                  value={type}
                  onChange={(e) => setType(e.target.value as VlanType)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-100"
                >
                  {VLAN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              {type === "CUSTOM" && (
                <div>
                  <Label htmlFor="customLabel">Custom type name</Label>
                  <Input
                    id="customLabel"
                    value={customTypeLabel}
                    onChange={(e) => setCustomTypeLabel(e.target.value)}
                    placeholder="CCTV Backhaul"
                    required
                  />
                </div>
              )}
              <div>
                <Label htmlFor="vlanRouter">Router</Label>
                <select
                  id="vlanRouter"
                  value={routerId}
                  onChange={(e) => setRouterId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-100"
                >
                  <option value="">Not assigned yet</option>
                  {(routers ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <HintText>A VLAN can be planned before its router is linked.</HintText>
              </div>
              <div>
                <Label htmlFor="subnet">Subnet (optional)</Label>
                <Input
                  id="subnet"
                  value={subnetCidr}
                  onChange={(e) => setSubnetCidr(e.target.value)}
                  placeholder="10.20.0.0/24"
                />
              </div>
              <div>
                <Label htmlFor="gw">Gateway (optional)</Label>
                <Input id="gw" value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="10.20.0.1" />
              </div>
            </div>
            <Button type="submit" disabled={createVlan.isPending}>
              {createVlan.isPending ? "Creating…" : "Create VLAN"}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or VLAN ID…"
            aria-label="Search VLANs"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "" | VlanType)}
            aria-label="Filter by type"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-100"
          >
            <option value="">All types</option>
            {VLAN_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={routerFilter}
            onChange={(e) => setRouterFilter(e.target.value)}
            aria-label="Filter by router"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-100"
          >
            <option value="">All routers</option>
            {(routers ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading VLANs…</p>
        ) : !vlans || vlans.length === 0 ? (
          <div className="py-10 text-center">
            <IconLayers size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              {qs ? "No VLANs match those filters." : "No VLANs yet."}
            </p>
            <HintText>
              {qs ? "Try clearing the search or filters." : "Create one, then attach it to a package."}
            </HintText>
          </div>
        ) : (
          // Scrolls inside its own container so a wide table never drags the whole page sideways
          // on a phone.
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 dark:border-obsidian-800 dark:text-slate-400">
                  <th className="pb-2 pr-3 font-semibold">VLAN</th>
                  <th className="pb-2 pr-3 font-semibold">Name</th>
                  <th className="pb-2 pr-3 font-semibold">Type</th>
                  <th className="pb-2 pr-3 font-semibold">Router</th>
                  <th className="pb-2 pr-3 font-semibold">Packages</th>
                  <th className="pb-2 pr-3 font-semibold">Enabled</th>
                  <th className="pb-2 pr-3 font-semibold">On device</th>
                  <th className="pb-2 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-obsidian-800">
                {vlans.map((v) => (
                  <tr key={v.id}>
                    <td className="py-3 pr-3 font-mono font-semibold text-slate-900 dark:text-white">{v.vlanTag}</td>
                    <td className="py-3 pr-3 text-slate-700 dark:text-slate-300">{v.name}</td>
                    <td className="py-3 pr-3">
                      <Badge variant="info">
                        {v.type === "CUSTOM" ? v.customTypeLabel || "Custom" : TYPE_LABELS[v.type]}
                      </Badge>
                    </td>
                    <td className="py-3 pr-3 text-slate-600 dark:text-slate-400">
                      {v.router ? (
                        <span className="inline-flex items-center gap-1.5">
                          <IconRouter size={14} />
                          {v.router.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-mono text-slate-600 dark:text-slate-400">{v.packageCount}</td>
                    <td className="py-3 pr-3">
                      {v.isEnabled ? (
                        <Badge variant="success">Enabled</Badge>
                      ) : (
                        <Badge variant="neutral">Disabled</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <DeviceStatusBadge vlan={v} />
                      {v.provisioningStatus === "FAILED" && v.lastProvisioningError && (
                        <p className="mt-1 max-w-xs text-xs text-rose-600 dark:text-rose-400">
                          {v.lastProvisioningError}
                        </p>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => toggleEnabled.mutate(v)}
                          disabled={toggleEnabled.isPending}
                        >
                          {v.isEnabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            // Deleting a VLAN can cut service for everyone on it, so this asks
                            // first — spec section 21 requires confirmation before destructive
                            // operations. The API refuses anyway while packages reference it.
                            if (
                              window.confirm(
                                `Delete VLAN ${v.vlanTag} (${v.name})? Customers on packages using it would lose their network configuration.`
                              )
                            ) {
                              deleteVlan.mutate(v);
                            }
                          }}
                          disabled={deleteVlan.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
