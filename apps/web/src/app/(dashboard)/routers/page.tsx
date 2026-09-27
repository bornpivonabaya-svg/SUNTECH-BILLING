"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconCloudDownload } from "@/components/icons";
import { tr } from "@/lib/tr";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useBranches } from "@/lib/use-branches";
import { useLanguage } from "@/lib/language-context";
import { pageStrings } from "@/lib/page-strings";
import {
  CodeBlock,
  EmptyState,
  Modal,
  Notice,
  PageHeader,
  Pill,
  TableShell,
  darkButton,
  td,
  th,
} from "@/components/dashboard/surface";
import { IconRouter } from "@/components/icons";

interface RouterRow {
  id: string;
  name: string;
  branchId?: string | null;
  vendor: string;
  host: string | null;
  apiPort: number;
  useTls: boolean;
  status: "UNKNOWN" | "ONLINE" | "WARNING" | "DOWN";
  lastSeenAt: string | null;
  lastError: string | null;
  cpuLoadPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  uptimeSeconds: number | null;
  temperatureC: number | null;
  voltageV: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  activeUsers: number | null;
  boardName: string | null;
  vpnStatus: "none" | "no-peer" | "waiting" | "connected" | null;
  hotspotCheckAt?: string | null;
  hotspotProblems?: { code: string; message: string }[];
  updatedAt: string;
  vpnIp: string | null;
  routerOsVersion: string | null;
  routerOsMajor: 6 | 7 | null;
  blockTethering?: boolean;
}

/** The chosen RouterOS major version disagrees with the one the router last reported. */
function versionMismatch(r: RouterRow): boolean {
  const seen = r.routerOsVersion?.match(/^(\d+)\./)?.[1];
  return r.routerOsMajor != null && seen !== undefined && Number(seen) !== r.routerOsMajor;
}

interface DeviceSession {
  username: string;
  address?: string;
  uptime?: string;
  callerId?: string;
}

interface ConnectedAccessPoint {
  identity: string;
  ipAddress?: string;
  macAddress: string;
  interface: string;
  board?: string;
  platform?: string;
  version?: string;
  uptime?: string;
  signal?: string;
  detectionSource: "NEIGHBOR" | "WIRELESS" | "DHCP";
}

interface WinboxAccessData {
  routerId: string;
  routerName: string;
  host: string | null;
  vpnIp: string | null;
  winboxPort: number;
  status: string;
  script: string;
  connectionTargets: {
    direct: string | null;
    vpn: string | null;
    cloudHost: string | null;
  };
  relay?: { enabled: boolean; vpnConnected: boolean; address: string | null };
}

interface FirmwareData {
  currentVersion: string;
  latestVersion: string;
  status: string;
  upgradeAvailable: boolean;
}

const STATUS: Record<RouterRow["status"], { tone: "good" | "warn" | "bad" | "neutral"; label: string }> = {
  ONLINE: { tone: "good", label: "Online" },
  WARNING: { tone: "warn", label: "Degraded" },
  DOWN: { tone: "bad", label: "Offline" },
  UNKNOWN: { tone: "neutral", label: "Not checked yet" },
};
const STATUS_LABEL = (t: ReturnType<typeof pageStrings>["routers"]): Record<RouterRow["status"], string> => ({
  ONLINE: t.online,
  WARNING: t.degraded,
  DOWN: t.offline,
  UNKNOWN: t.notChecked,
});

const DETECTED_BY: Record<ConnectedAccessPoint["detectionSource"], string> = {
  NEIGHBOR: "Neighbour discovery",
  WIRELESS: "Wireless table",
  DHCP: "DHCP lease",
};

function formatUptime(seconds: number | null): string | null {
  if (seconds === null) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `up ${days}d ${hours}h` : `up ${hours}h`;
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The router's own figures, as it last reported them: one chip each, coloured when worrying. */
function HealthStrip({ router }: { router: RouterRow }) {
  const memPct = router.memoryUsedBytes != null && router.memoryTotalBytes ? Math.round((router.memoryUsedBytes * 100) / router.memoryTotalBytes) : null;
  const diskPct = router.diskFreeBytes != null && router.diskTotalBytes ? Math.round((router.diskFreeBytes * 100) / router.diskTotalBytes) : null;
  const chips: { label: string; value: string; bad?: boolean; warn?: boolean }[] = [];
  if (router.cpuLoadPercent != null) chips.push({ label: "CPU", value: `${router.cpuLoadPercent}%`, bad: router.cpuLoadPercent >= 90, warn: router.cpuLoadPercent >= 70 });
  if (router.memoryTotalBytes != null)
    chips.push({
      label: tr("Memory"),
      value: memPct != null ? `${memPct}% · ${mb(router.memoryUsedBytes!)} / ${mb(router.memoryTotalBytes)}` : mb(router.memoryTotalBytes),
      bad: (memPct ?? 0) >= 92,
      warn: (memPct ?? 0) >= 80,
    });
  if (router.temperatureC != null) chips.push({ label: tr("Temperature"), value: `${router.temperatureC} °C`, bad: router.temperatureC >= 75, warn: router.temperatureC >= 65 });
  if (router.voltageV != null) chips.push({ label: tr("Voltage"), value: `${router.voltageV} V` });
  if (router.diskFreeBytes != null && router.diskTotalBytes) chips.push({ label: tr("Storage free"), value: `${mb(router.diskFreeBytes)} / ${mb(router.diskTotalBytes)}`, warn: (diskPct ?? 100) < 10 });
  if (router.activeUsers != null) chips.push({ label: tr("Users online"), value: String(router.activeUsers) });
  if (router.uptimeSeconds != null) chips.push({ label: tr("Up for"), value: formatUptime(router.uptimeSeconds)!.replace(/^up /, "") });
  // The management VPN, as the router reports it. Without it, remote WinBox and live tools can't
  // reach a router behind CGNAT (its health still arrives through the heartbeat).
  if (router.vpnStatus)
    chips.push(
      router.vpnStatus === "connected"
        ? { label: "VPN", value: tr("connected") }
        : { label: "VPN", value: router.vpnStatus === "waiting" ? tr("not connecting") : tr("not set up"), warn: true }
    );
  if (chips.length === 0) {
    // Online but no figures: the router checks in with the older script, which sends none.
    return router.status === "ONLINE" ? (
      <p className="mt-2 text-xs text-slate-400">
        {tr("No health readings yet: this router runs an older setup. Get its setup command below and run it once more to turn on CPU, memory, temperature and uptime reports.")}
      </p>
    ) : null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={tr("Router health")}>
      {chips.map((c) => (
        <li
          key={c.label}
          className={`rounded-md border px-2 py-0.5 text-xs tabular-nums ${
            c.bad
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : c.warn
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-obsidian-700 bg-obsidian-950 text-slate-300"
          }`}
        >
          <span className="text-slate-500">{c.label}</span> {c.value}
        </li>
      ))}
    </ul>
  );
}

/** What the router's own once-a-minute hotspot check found: the reasons customers would get
 *  "Connected, no internet", in plain words, or a short all-clear. */
function HotspotCheckResult({ router }: { router: RouterRow }) {
  if (!router.hotspotCheckAt) return null;
  const problems = router.hotspotProblems ?? [];
  if (problems.length === 0) {
    return <p className="mt-2 text-xs text-emerald-400">{tr("Hotspot check passed: internet, DNS, sign-in page and Wi-Fi are all in place.")}</p>;
  }
  return (
    <div className="mt-2 max-w-2xl rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
      <p className="text-xs font-semibold text-red-300">{tr("Hotspot problems the router found")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-200">
        {problems.map((p) => (
          <li key={p.code}>{tr(p.message)}</li>
        ))}
      </ul>
    </div>
  );
}

/** A fresh setup command for this router, on request: to re-run setup after an update or on a
 *  router reset to factory settings. The router keeps working on its current one until then. */
function SetupCommand({ routerId }: { routerId: string }) {
  const [command, setCommand] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const issue = useMutation({
    mutationFn: () => apiFetch<{ fetchCommand: string }>(`/api/v1/routers/${routerId}/setup-command`, { method: "POST" }),
    onSuccess: (data) => setCommand(data.fetchCommand),
  });
  if (!open) {
    return (
      <button
        type="button"
        className="mt-2 text-xs font-medium text-brand-400 hover:text-brand-300 hover:underline"
        onClick={() => {
          setOpen(true);
          if (!command) issue.mutate();
        }}
      >
        {tr("Get setup command")}
      </button>
    );
  }
  return (
    <div className="mt-3 max-w-2xl space-y-2">
      <p className="text-xs text-slate-400">
        {tr("Paste this into WinBox → New Terminal on this router. It keeps its settings and customers, and stays online while it updates.")}
      </p>
      {issue.isError ? (
        <p className="text-xs text-red-300">{issue.error instanceof Error ? issue.error.message : String(issue.error)}</p>
      ) : (
        <CodeBlock code={command} label={tr("Setup command")} maxHeight="8rem" />
      )}
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
        {tr("Hide")}
      </button>
    </div>
  );
}

function formatLastChecked(iso: string | null): string {
  if (!iso) return "never checked";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "checked just now";
  if (seconds < 60) return `checked ${seconds}s ago`;
  if (seconds < 3600) return `checked ${Math.floor(seconds / 60)}m ago`;
  return `checked ${Math.floor(seconds / 3600)}h ago`;
}

function vendorOf(ap: ConnectedAccessPoint): string {
  const name = (ap.identity || "").toLowerCase();
  const board = (ap.board || ap.platform || "").toLowerCase();
  if (["ubnt", "nanostation", "litebeam", "unifi", "rocket", "airmax"].some((k) => name.includes(k)) || board.includes("ubnt")) return "Ubiquiti";
  if (name.includes("tp-link") || name.includes("eap") || board.includes("eap") || board.includes("omada") || name.includes("cpe")) return "TP-Link";
  if (name.includes("ruijie") || name.includes("reyee") || board.includes("rg-") || board.includes("reyee")) return "Ruijie";
  if (name.includes("mikrotik") || board.includes("routerboard") || board.includes("cap") || board.includes("wap")) return "MikroTik";
  return ap.board || ap.platform || "Access point";
}

export default function RoutersPage() {
  const { lang } = useLanguage();
  const { branches } = useBranches();
  const t = pageStrings(lang).routers;
  const c = pageStrings(lang).common;
  const queryClient = useQueryClient();
  // Re-render every second so "checked 12s ago" stays true between polls.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openSessionsFor, setOpenSessionsFor] = useState<string | null>(null);
  const [openAccessPointsFor, setOpenAccessPointsFor] = useState<string | null>(null);
  const [winboxModalFor, setWinboxModalFor] = useState<RouterRow | null>(null);
  const [toolsModalFor, setToolsModalFor] = useState<RouterRow | null>(null);
  const [toolLoading, setToolLoading] = useState<string | null>(null);

  const flashSuccess = (message: string) => {
    setActionSuccess(message);
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const { data: routers, isLoading } = useQuery({
    queryKey: ["routers"],
    queryFn: () => apiFetch<RouterRow[]>("/api/v1/routers"),
    refetchInterval: 5000,
  });

  const testConnection = useMutation({
    mutationFn: (routerId: string) => {
      setTestingId(routerId);
      return apiFetch(`/api/v1/routers/${routerId}/test-connection`, { method: "POST" });
    },
    onSettled: () => {
      setTestingId(null);
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    },
  });

  const deleteRouter = useMutation({
    mutationFn: (routerId: string) => {
      setDeletingId(routerId);
      return apiFetch(`/api/v1/routers/${routerId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      flashSuccess("Router removed.");
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : t.couldNotRemove),
    onSettled: () => setDeletingId(null),
  });

  const updateRouterHost = useMutation({
    mutationFn: ({ routerId, host }: { routerId: string; host: string }) =>
      apiFetch(`/api/v1/routers/${routerId}`, { method: "PATCH", body: JSON.stringify({ host }) }),
    onSuccess: () => {
      flashSuccess("Router address updated.");
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : t.couldNotUpdateAddress),
  });

  const { data: liveSessions, isFetching: sessionsLoading, error: sessionsError } = useQuery({
    queryKey: ["router-sessions", openSessionsFor],
    queryFn: () => apiFetch<DeviceSession[]>(`/api/v1/routers/${openSessionsFor}/sessions`),
    enabled: openSessionsFor !== null,
    refetchInterval: openSessionsFor !== null ? 10_000 : false,
    retry: false,
  });

  const {
    data: connectedAps,
    isFetching: apsLoading,
    error: apsError,
    refetch: refetchAps,
  } = useQuery({
    queryKey: ["router-access-points", openAccessPointsFor],
    queryFn: () => apiFetch<ConnectedAccessPoint[]>(`/api/v1/routers/${openAccessPointsFor}/access-points`),
    enabled: openAccessPointsFor !== null,
    refetchInterval: openAccessPointsFor !== null ? 15_000 : false,
    retry: false,
  });

  const { data: winboxAccessData, isLoading: winboxLoading } = useQuery({
    queryKey: ["router-winbox-access", winboxModalFor?.id],
    queryFn: () => apiFetch<WinboxAccessData>(`/api/v1/routers/${winboxModalFor?.id}/winbox-access`),
    enabled: winboxModalFor !== null,
  });

  const { data: firmwareData, isFetching: firmwareLoading, refetch: refetchFirmware } = useQuery({
    queryKey: ["router-firmware", toolsModalFor?.id],
    queryFn: () => apiFetch<FirmwareData>(`/api/v1/routers/${toolsModalFor?.id}/firmware`),
    enabled: toolsModalFor !== null && Boolean(toolsModalFor.host),
  });

  const runTool = async (routerId: string, endpoint: string, body: unknown, key: string) => {
    setToolLoading(key);
    setError(null);
    try {
      const res = await apiFetch<{ message?: string }>(`/api/v1/routers/${routerId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      flashSuccess(res?.message || "Applied to the router.");
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.notAccepted);
    } finally {
      setToolLoading(null);
    }
  };

  // "Block tunnelling apps": the router applies it in the background (a minute or more on a small
  // router), so this starts it and then follows the router's own progress until it's done.
  const [antiTunnelNote, setAntiTunnelNote] = useState<string | null>(null);
  const setAntiTunnel = async (routerId: string, enabled: boolean) => {
    const key = enabled ? "anti-vpn" : "anti-vpn-off";
    setToolLoading(key);
    setError(null);
    setAntiTunnelNote(null);
    try {
      const { started } = await apiFetch<{ started: boolean }>(`/api/v1/routers/${routerId}/${enabled ? "enable" : "disable"}-anti-vpn-shield`, {
        method: "POST",
        body: "{}",
      });
      if (!started) {
        flashSuccess("Tunnel blocking is already on.");
        return;
      }
      setAntiTunnelNote(enabled ? t.applyingNote : t.removingNote);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const status = await apiFetch<{ state: "applying" | "on" | "off" | "failed" | "unknown"; rules: number | null; expected: number }>(
          `/api/v1/routers/${routerId}/anti-vpn-shield/status`
        ).catch(() => null);
        if (!status || status.state === "applying" || status.state === "unknown") continue;
        if (status.state === "failed") {
          setError("The router rejected one of the rules, so nothing was changed. Its log has the details.");
          return;
        }
        if (enabled && status.state === "on") {
          flashSuccess(`Tunnel blocking is on: ${status.rules} of ${status.expected} rules in place. Phones that have logged in aren't affected.`);
          return;
        }
        if (!enabled && status.state === "off") {
          flashSuccess("Tunnel blocking is off.");
          return;
        }
      }
      setError("The router hasn't confirmed the change after five minutes. Check it's online, then look at this again.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.notAccepted);
    } finally {
      setAntiTunnelNote(null);
      setToolLoading(null);
    }
  };

  // Remote WinBox goes through the MashupHost server's relay, over the router's VPN.
  const relay = winboxAccessData?.relay;
  const remoteWinbox = relay?.address ?? null;
  const remoteWinboxProblem = !winboxAccessData
    ? null
    : !relay?.enabled
    ? t.relayOff
    : !relay.vpnConnected
    ? t.vpnNotConnected
    : t.portAssigning;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/routers/updates" className={darkButton("secondary")}>
              <IconCloudDownload size={16} /> {tr("Router updates")}
            </Link>
            <Link href="/routers/new" className={darkButton("primary")}>
              {t.linkRouter}
            </Link>
          </div>
        }
      />

      {error && (
        <Notice tone="bad">
          <div className="flex items-start justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={c.dismiss} className="text-rose-200/70 hover:text-white">
              ✕
            </button>
          </div>
        </Notice>
      )}
      {actionSuccess && <Notice tone="good">{actionSuccess}</Notice>}

      {isLoading && <p className="py-8 text-center text-sm text-slate-400">{t.loadingRouters}</p>}

      {routers && routers.length === 0 && (
        <div className="rounded-xl border border-dashed border-obsidian-700">
          <EmptyState
            title={t.noRouters}
            action={
              <Link href="/routers/new" className={darkButton("primary")}>
                {t.linkFirst}
              </Link>
            }
          >
            {t.linkingExplain}
          </EmptyState>
        </div>
      )}

      <div className="space-y-4">
        {routers?.map((router) => {
          const status = { tone: STATUS[router.status].tone, label: STATUS_LABEL(t)[router.status] };
          const sessionsOpen = openSessionsFor === router.id;
          const apsOpen = openAccessPointsFor === router.id;
          return (
            <section key={router.id} className="rounded-xl border border-obsidian-800 bg-obsidian-900">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-obsidian-800 text-slate-300">
                    <IconRouter size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-white">{router.name}</h2>
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {branches.length > 0 && (
                        <select
                          aria-label="Branch"
                          value={router.branchId ?? ""}
                          onChange={(e) =>
                            apiFetch(`/api/v1/routers/${router.id}`, { method: "PATCH", body: JSON.stringify({ branchId: e.target.value || null }) })
                              .then(() => queryClient.invalidateQueries({ queryKey: ["routers"] }))
                              .catch((err) => setError(err instanceof ApiRequestError ? err.message : String(err)))
                          }
                          className="rounded-md border border-obsidian-700 bg-obsidian-950 px-1.5 py-0.5 text-xs text-slate-300"
                        >
                          <option value="">No branch</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        aria-label={tr("RouterOS version")}
                        title={tr("RouterOS version the setup script is made for")}
                        value={router.routerOsMajor ?? ""}
                        onChange={(e) =>
                          apiFetch(`/api/v1/routers/${router.id}`, { method: "PATCH", body: JSON.stringify({ routerOsMajor: e.target.value ? Number(e.target.value) : null }) })
                            .then(() => queryClient.invalidateQueries({ queryKey: ["routers"] }))
                            .catch((err) => setError(err instanceof ApiRequestError ? err.message : String(err)))
                        }
                        className="rounded-md border border-obsidian-700 bg-obsidian-950 px-1.5 py-0.5 text-xs text-slate-300"
                      >
                        <option value="">{tr("RouterOS: detect")}</option>
                        <option value="6">RouterOS v6</option>
                        <option value="7">RouterOS v7</option>
                      </select>
                      <label
                        className="flex items-center gap-1.5 rounded-md border border-obsidian-700 bg-obsidian-950 px-1.5 py-0.5 text-xs text-slate-300"
                        title={tr("Blocks sharing a paid connection through a phone hotspot. The paying phone is never blocked.")}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(router.blockTethering)}
                          onChange={(e) =>
                            apiFetch(`/api/v1/routers/${router.id}`, { method: "PATCH", body: JSON.stringify({ blockTethering: e.target.checked }) })
                              .then(() => queryClient.invalidateQueries({ queryKey: ["routers"] }))
                              .catch((err) => setError(err instanceof ApiRequestError ? err.message : String(err)))
                          }
                        />
                        {tr("Block hotspot sharing")}
                      </label>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-400">
                      {router.host ? (
                        <>
                          <span className="font-mono text-[13px]">
                            {router.host}:{router.apiPort}
                          </span>
                          {router.useTls && <span>TLS</span>}
                          <button
                            type="button"
                            onClick={() => {
                              const newHost = window.prompt(t.addressPrompt, router.host || "");
                              if (newHost && newHost.trim() !== router.host) {
                                updateRouterHost.mutate({ routerId: router.id, host: newHost.trim() });
                              }
                            }}
                            className="text-brand-400 hover:text-brand-300 hover:underline"
                          >
                            {t.change}
                          </button>
                        </>
                      ) : (
                        <span className="text-amber-300">{t.waitingCheckIn}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[
                        router.boardName ?? router.vendor,
                        router.routerOsVersion ? `RouterOS ${router.routerOsVersion}` : null,
                        formatLastChecked(router.updatedAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <HealthStrip router={router} />
                    <HotspotCheckResult router={router} />
                    {router.host && <SetupCommand routerId={router.id} />}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button
                    type="button"
                    className={darkButton("secondary", "sm")}
                    onClick={() => testConnection.mutate(router.id)}
                    disabled={testingId === router.id || !router.host}
                  >
                    {testingId === router.id ? t.testing : t.testConnection}
                  </button>
                  <button
                    type="button"
                    className={darkButton("secondary", "sm")}
                    aria-expanded={sessionsOpen}
                    onClick={() => {
                      setOpenAccessPointsFor(null);
                      setOpenSessionsFor(sessionsOpen ? null : router.id);
                    }}
                    disabled={!router.host}
                  >
                    {t.sessions}
                  </button>
                  <button
                    type="button"
                    className={darkButton("secondary", "sm")}
                    aria-expanded={apsOpen}
                    onClick={() => {
                      setOpenSessionsFor(null);
                      setOpenAccessPointsFor(apsOpen ? null : router.id);
                    }}
                    disabled={!router.host}
                  >
                    {t.accessPoints}
                  </button>
                  <button type="button" className={darkButton("secondary", "sm")} onClick={() => setWinboxModalFor(router)}>
                    {t.winboxAccess}
                  </button>
                  <button type="button" className={darkButton("secondary", "sm")} onClick={() => setToolsModalFor(router)} disabled={!router.host}>
                    {t.tools}
                  </button>
                  <button
                    type="button"
                    className={`${darkButton("ghost", "sm")} text-rose-300 hover:bg-rose-500/10 hover:text-rose-200`}
                    onClick={() => {
                      if (confirm(t.confirmRemove(router.name))) deleteRouter.mutate(router.id);
                    }}
                    disabled={deletingId === router.id}
                  >
                    {deletingId === router.id ? t.removing : t.remove}
                  </button>
                </div>
              </div>

              {versionMismatch(router) && (
                <div className="px-5 pb-4">
                  <Notice tone="warn">
                    {tr("This router was added as RouterOS v{chosen} but reports {seen}. Pick the right version above, then run its setup script again so WireGuard, NTP and Wi-Fi match.")
                      .replace("{chosen}", String(router.routerOsMajor))
                      .replace("{seen}", router.routerOsVersion ?? "")}
                  </Notice>
                </div>
              )}

              {router.lastError && router.status !== "ONLINE" && (
                <div className="px-5 pb-4">
                  <Notice tone="bad">
                    <span className="font-medium">{t.lastError}</span> <span className="break-words font-mono text-xs">{router.lastError}</span>
                  </Notice>
                </div>
              )}

              {/* Access points */}
              {apsOpen && (
                <div className="border-t border-obsidian-800 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-white">
                      {t.accessPoints}
                      {connectedAps && <span className="ml-2 font-normal text-slate-400">{t.found(connectedAps.length)}</span>}
                    </h3>
                    <button type="button" className={darkButton("ghost", "sm")} onClick={() => refetchAps()} disabled={apsLoading}>
                      {apsLoading ? t.scanning : t.rescan}
                    </button>
                  </div>

                  {apsError ? (
                    <Notice tone="warn">
                      <p className="font-medium">{t.apiUnreachable}</p>
                      <p className="mt-1 break-words font-mono text-xs opacity-90">
                        {apsError instanceof ApiRequestError ? apsError.message : t.apListFailed}
                      </p>
                      <p className="mt-2 text-amber-200/90">
                        {t.apiCheck}
                      </p>
                    </Notice>
                  ) : connectedAps && connectedAps.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {connectedAps.map((ap, idx) => (
                        <div key={`${ap.macAddress}-${idx}`} className="rounded-lg border border-obsidian-800 bg-obsidian-950 p-3.5 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white" title={ap.identity}>
                                {ap.identity || t.unnamedAp}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {vendorOf(ap)}
                                {ap.version ? ` · ${ap.version}` : ""}
                              </p>
                            </div>
                            <span className="shrink-0 rounded border border-obsidian-700 px-1.5 py-0.5 font-mono text-xs text-slate-300">{ap.interface || "LAN"}</span>
                          </div>
                          <dl className="mt-3 space-y-1 text-xs">
                            {ap.ipAddress && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500">IP</dt>
                                <dd className="font-mono text-slate-300">{ap.ipAddress}</dd>
                              </div>
                            )}
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-500">MAC</dt>
                              <dd className="truncate font-mono text-slate-300">{ap.macAddress}</dd>
                            </div>
                            {ap.uptime && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500">{c.uptime}</dt>
                                <dd className="text-slate-300">{ap.uptime}</dd>
                              </div>
                            )}
                            {ap.signal && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500">{t.signal}</dt>
                                <dd className="text-slate-300">{ap.signal}</dd>
                              </div>
                            )}
                          </dl>
                          <div className="mt-3 flex items-center justify-between border-t border-obsidian-800 pt-2.5 text-xs">
                            <span className="text-slate-500">{DETECTED_BY[ap.detectionSource]}</span>
                            {ap.ipAddress && (
                              <a href={`http://${ap.ipAddress}`} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                                {t.openAdmin}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-slate-400">
                      {apsLoading
                        ? t.scanning
                        : t.noAps}
                    </p>
                  )}
                </div>
              )}

              {/* Sessions */}
              {sessionsOpen && (
                <div className="border-t border-obsidian-800">
                  <div className="flex items-center justify-between px-5 py-3">
                    <h3 className="text-sm font-medium text-white">{t.activeSessions}</h3>
                    {sessionsLoading && <span className="text-xs text-slate-500">{t.refreshing}</span>}
                  </div>
                  {sessionsError ? (
                    <div className="px-5 pb-4">
                      <Notice tone="bad">{sessionsError instanceof ApiRequestError ? sessionsError.message : t.sessionsFailed}</Notice>
                    </div>
                  ) : liveSessions && liveSessions.length > 0 ? (
                    <TableShell minWidth={520}>
                      <thead>
                        <tr>
                          <th className={th}>{c.username}</th>
                          <th className={th}>{c.ipAddress}</th>
                          <th className={th}>{c.uptime}</th>
                          <th className={th}>{t.callerId}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveSessions.map((session, i) => (
                          <tr key={`${session.username}-${i}`}>
                            <td className={`${td} text-white`}>{session.username}</td>
                            <td className={`${td} font-mono text-[13px]`}>{session.address ?? "—"}</td>
                            <td className={td}>{session.uptime ?? "—"}</td>
                            <td className={`${td} font-mono text-[13px]`}>{session.callerId ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </TableShell>
                  ) : (
                    <p className="px-5 pb-4 text-sm text-slate-400">{sessionsLoading ? c.loading : t.noSessions}</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* WinBox access */}
      <Modal
        open={winboxModalFor !== null}
        onClose={() => setWinboxModalFor(null)}
        title={t.winboxAccess}
        description={winboxModalFor ? t.connectWith(winboxModalFor.name) : undefined}
        footer={
          <button type="button" className={darkButton("secondary")} onClick={() => setWinboxModalFor(null)}>
            {c.close}
          </button>
        }
      >
        {winboxModalFor && (
          <>
            <div className="rounded-lg border border-obsidian-800 bg-obsidian-950 p-4">
              <p className="text-xs text-slate-400">{t.remoteAddress}</p>
              {winboxLoading ? (
                <p className="mt-1 text-sm text-slate-400">{c.loading}</p>
              ) : remoteWinbox ? (
                <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-mono text-base text-white">{remoteWinbox}</p>
                  <div className="flex gap-2">
                    <button type="button" className={darkButton("secondary", "sm")} onClick={() => void navigator.clipboard.writeText(remoteWinbox)}>
                      {c.copy}
                    </button>
                    <a href={`winbox://${remoteWinbox}`} className={darkButton("primary", "sm")}>
                      {t.openInWinbox}
                    </a>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-amber-300">{remoteWinboxProblem}</p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {t.relayExplain}
              </p>
            </div>

            <div className="text-sm text-slate-400">
              <p className="font-medium text-slate-200">{t.sameNetwork}</p>
              <p className="mt-1">
                {t.sameNetworkHint}
              </p>
            </div>

            <details>
              <summary className="cursor-pointer select-none text-sm text-slate-400 hover:text-white">{t.ifNoConnect}</summary>
              <div className="mt-2 space-y-2">
                <p className="text-sm text-slate-400">
                  {t.pasteScript}
                </p>
                <CodeBlock code={winboxLoading ? null : winboxAccessData?.script ?? null} label={t.winboxAccess} maxHeight="10rem" />
              </div>
            </details>

            <p className="text-sm text-slate-400">
              WinBox:{" "}
              <a href="https://mt.lv/winbox64" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                Windows 64-bit
              </a>
              {" · "}
              <a href="https://mt.lv/winbox" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                32-bit
              </a>
              {" · "}
              <a href="https://mikrotik.com/download" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                all downloads
              </a>
            </p>
          </>
        )}
      </Modal>

      {/* Router tools */}
      <Modal
        open={toolsModalFor !== null}
        onClose={() => setToolsModalFor(null)}
        title={t.routerTools}
        description={toolsModalFor ? t.appliedTo(toolsModalFor.name) : undefined}
        footer={
          <button type="button" className={darkButton("secondary")} onClick={() => setToolsModalFor(null)}>
            {c.close}
          </button>
        }
      >
        {toolsModalFor && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Tool
                title={t.pcqTitle}
                description={t.pcqDesc}
              >
                <button
                  type="button"
                  className={darkButton("secondary", "sm")}
                  onClick={() => runTool(toolsModalFor.id, "enable-pcq-shaper", {}, "pcq")}
                  disabled={toolLoading === "pcq" || !toolsModalFor.host}
                >
                  {toolLoading === "pcq" ? t.applying : t.enable}
                </button>
              </Tool>
              <Tool
                title={t.dnsTitle}
                description={t.dnsDesc}
              >
                <button
                  type="button"
                  className={darkButton("secondary", "sm")}
                  onClick={() => runTool(toolsModalFor.id, "apply-family-dns", { familyMode: true }, "dns-family")}
                  disabled={toolLoading === "dns-family" || !toolsModalFor.host}
                >
                  {toolLoading === "dns-family" ? t.applying : t.enable}
                </button>
                <button
                  type="button"
                  className={darkButton("ghost", "sm")}
                  onClick={() => runTool(toolsModalFor.id, "apply-family-dns", { familyMode: false }, "dns-standard")}
                  disabled={toolLoading === "dns-standard" || !toolsModalFor.host}
                >
                  {t.standard}
                </button>
              </Tool>
              <Tool
                title={t.tunnelTitle}
                note={antiTunnelNote}
                description={t.tunnelDesc}
              >
                <button
                  type="button"
                  className={darkButton("secondary", "sm")}
                  onClick={() => void setAntiTunnel(toolsModalFor.id, true)}
                  disabled={toolLoading === "anti-vpn" || toolLoading === "anti-vpn-off" || !toolsModalFor.host}
                >
                  {toolLoading === "anti-vpn" ? t.applying : t.turnOn}
                </button>
                <button
                  type="button"
                  className={darkButton("ghost", "sm")}
                  onClick={() => void setAntiTunnel(toolsModalFor.id, false)}
                  disabled={toolLoading === "anti-vpn" || toolLoading === "anti-vpn-off" || !toolsModalFor.host}
                >
                  {toolLoading === "anti-vpn-off" ? t.removing : t.turnOff}
                </button>
              </Tool>
              <Tool
                title={t.speedTitle}
                description={t.speedDesc}
              >
                <button
                  type="button"
                  className={darkButton("secondary", "sm")}
                  onClick={() => runTool(toolsModalFor.id, "apply-speedtest-boost", {}, "speedtest")}
                  disabled={toolLoading === "speedtest" || !toolsModalFor.host}
                >
                  {toolLoading === "speedtest" ? t.applying : t.enable}
                </button>
              </Tool>
            </div>

            <div className="rounded-lg border border-obsidian-800 bg-obsidian-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">{t.routerOsVersion}</p>
                <button type="button" className={darkButton("ghost", "sm")} onClick={() => refetchFirmware()} disabled={firmwareLoading}>
                  {firmwareLoading ? t.checking : t.checkUpdates}
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-slate-500">{t.installed}</dt>
                  <dd className="text-slate-200">{firmwareData?.currentVersion || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t.latest}</dt>
                  <dd className="text-slate-200">{firmwareData?.latestVersion || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{c.status}</dt>
                  <dd className="text-slate-200">{firmwareData?.status || "—"}</dd>
                </div>
              </dl>
              {firmwareData?.upgradeAvailable ? (
                <button
                  type="button"
                  className={`${darkButton("primary")} mt-4 w-full`}
                  onClick={() => {
                    if (confirm(t.confirmUpgrade)) {
                      runTool(toolsModalFor.id, "upgrade-firmware", {}, "firmware");
                    }
                  }}
                  disabled={toolLoading === "firmware" || !toolsModalFor.host}
                >
                  {toolLoading === "firmware" ? t.upgrading : t.upgradeTo(firmwareData.latestVersion)}
                </button>
              ) : (
                firmwareData && <p className="mt-3 text-xs text-slate-500">{t.noNewer}</p>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function Tool({ title, description, note, children }: { title: string; description: string; note?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-obsidian-800 bg-obsidian-950 p-4">
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
      </div>
      <div className="flex gap-2">{children}</div>
      {note && (
        <p role="status" className="text-xs text-slate-400">
          {note}
        </p>
      )}
    </div>
  );
}
