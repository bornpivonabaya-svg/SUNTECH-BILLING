"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { tr } from "@/lib/tr";
import { TrendChart } from "@/components/charts/trend-chart";
import { ChartTable } from "@/components/charts/chart-table";
import { EmptyState, PageHeader, Panel, Pill, Segmented, TableShell, td as baseTd, th as baseTh } from "@/components/dashboard/surface";

// Ten columns: tighter cell padding than the shared table so the fleet fits a laptop screen.
const th = baseTh.replace("px-5", "px-3");
const td = baseTd.replace("px-5", "px-3");

/**
 * How each router has been doing: the latest CPU, memory and temperature, uptime over the last
 * day, and reboots this week, then one chart per measure for the chosen router. Readings are kept
 * every 5 minutes for 30 days. Staff get an alert when a router stays busy, runs hot or restarts.
 */

interface FleetHealth {
  id: string;
  name: string;
  status: string;
  siteName: string | null;
  latest: { at: string; cpuPercent: number | null; memoryPercent: number | null; temperatureC: number | null; uptimeSeconds: number | null } | null;
  /** The router's own last report (every minute); fresher than the 5-minute history. */
  live: {
    at: string | null;
    cpuPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    memoryPercent: number | null;
    temperatureC: number | null;
    voltageV: number | null;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    activeUsers: number | null;
    uptimeSeconds: number | null;
    routerOsVersion: string | null;
    boardName: string | null;
  };
  availability24h: number | null;
  reboots7d: number;
}

interface Series {
  hours: number;
  points: { at: string; cpu: number | null; memory: number | null; temperature: number | null; availability: number | null }[];
}

function uptime(s: number | null | undefined): string {
  if (s == null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

function mb(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  return bytes >= 1024 ** 3 ? `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB` : `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
}

function tone(value: number | null | undefined, warn: number, bad: number): "good" | "warn" | "bad" | "neutral" {
  if (value == null) return "neutral";
  return value >= bad ? "bad" : value >= warn ? "warn" : "good";
}

export default function RouterHealthPage() {
  const { data: fleet } = useQuery({ queryKey: ["router-health"], queryFn: () => apiFetch<FleetHealth[]>("/api/v1/router-health"), refetchInterval: 60_000 });
  const [routerId, setRouterId] = useState("");
  const [hours, setHours] = useState<24 | 168>(24);
  useEffect(() => {
    if (!routerId && fleet?.length) setRouterId(fleet[0]!.id);
  }, [fleet, routerId]);
  const { data: series } = useQuery({
    queryKey: ["router-health-series", routerId, hours],
    queryFn: () => apiFetch<Series>(`/api/v1/router-health/${routerId}?hours=${hours}`),
    enabled: Boolean(routerId),
    refetchInterval: 5 * 60_000,
  });
  const chosen = fleet?.find((r) => r.id === routerId);
  const label = (iso: string) =>
    new Date(iso).toLocaleString([], hours === 24 ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", hour: "2-digit" });

  const charts: { key: "cpu" | "memory" | "temperature" | "availability"; title: string; unit: string }[] = [
    { key: "cpu", title: tr("CPU"), unit: "%" },
    { key: "memory", title: tr("Memory used"), unit: "%" },
    { key: "temperature", title: tr("Temperature"), unit: " °C" },
    { key: "availability", title: tr("Reachable"), unit: "%" },
  ];

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader
        title={tr("Router health")}
        description={tr("CPU, memory, temperature, voltage, storage, users and uptime for every router. Each router reports every minute, even one the platform can't connect to; history is kept every 5 minutes. You get an alert when a router stays busy, runs hot or restarts on its own.")}
      />

      <Panel title={tr("All routers")} padded={false}>
        {!fleet?.length ? (
          <EmptyState title={tr("No routers yet")} />
        ) : (
          <TableShell minWidth={960}>
            <thead>
              <tr>
                <th className={th}>{tr("Router")}</th>
                <th className={`${th} text-right`}>{tr("CPU")}</th>
                <th className={`${th} text-right`}>{tr("Memory used")}</th>
                <th className={`${th} text-right`}>{tr("Temperature")}</th>
                <th className={`${th} text-right`}>{tr("Voltage")}</th>
                <th className={`${th} text-right`}>{tr("Storage")}</th>
                <th className={`${th} text-right`}>{tr("Users")}</th>
                <th className={`${th} text-right`}>{tr("Up for")}</th>
                <th className={`${th} text-right`}>{tr("Reachable, 24 h")}</th>
                <th className={`${th} text-right`}>{tr("Restarts, 7 days")}</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((r) => {
                // The router's last report when there is one, else the last recorded sample.
                const cpu = r.live.cpuPercent ?? r.latest?.cpuPercent ?? null;
                const memory = r.live.memoryPercent ?? r.latest?.memoryPercent ?? null;
                const temperature = r.live.temperatureC ?? r.latest?.temperatureC ?? null;
                const up = r.live.uptimeSeconds ?? r.latest?.uptimeSeconds ?? null;
                const model = [r.live.boardName, r.live.routerOsVersion && `RouterOS ${r.live.routerOsVersion}`].filter(Boolean).join(" · ");
                return (
                  <tr key={r.id} className={r.id === routerId ? "bg-obsidian-800/40" : undefined}>
                    <td className={td}>
                      <button type="button" className="font-medium text-white hover:underline" onClick={() => setRouterId(r.id)} aria-pressed={r.id === routerId}>
                        {r.name}
                      </button>
                      {model && <span className="block text-xs text-slate-500">{model}</span>}
                      {r.siteName && <span className="block text-xs text-slate-500">{r.siteName}</span>}
                    </td>
                    <td className={`${td} text-right`}>{cpu != null ? <Pill tone={tone(cpu, 70, 90)}>{cpu}%</Pill> : "—"}</td>
                    <td className={`${td} text-right`}>
                      {memory != null ? <Pill tone={tone(memory, 80, 92)}>{memory}%</Pill> : "—"}
                      {r.live.memoryTotalBytes != null && (
                        <span className="block text-xs text-slate-500 tabular-nums">
                          {mb(r.live.memoryUsedBytes)} / {mb(r.live.memoryTotalBytes)}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{temperature != null ? <Pill tone={tone(temperature, 65, 75)}>{temperature} °C</Pill> : <span title={tr("This router has no temperature sensor.")}>—</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.live.voltageV != null ? `${r.live.voltageV} V` : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {r.live.diskFreeBytes != null ? (
                        <>
                          {mb(r.live.diskFreeBytes)}
                          <span className="block text-xs text-slate-500">{tr("of")} {mb(r.live.diskTotalBytes)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.live.activeUsers ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{uptime(up)}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.availability24h != null ? `${r.availability24h}%` : "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.reboots7d > 0 ? <Pill tone="warn">{r.reboots7d}</Pill> : "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </Panel>

      {chosen && (
        <Panel
          title={chosen.name}
          description={tr("Averages per interval. Hover a chart for the exact reading.")}
          actions={
            <Segmented
              label={tr("Period")}
              value={hours}
              onChange={setHours}
              options={[
                { value: 24, label: tr("24 hours") },
                { value: 168, label: tr("7 days") },
              ]}
            />
          }
        >
          {!series?.points.length ? (
            <EmptyState title={tr("No readings yet")}>{tr("The first reading appears within 5 minutes of the router coming online.")}</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {charts.map((c) => {
                const pts = series.points.filter((p) => p[c.key] !== null).map((p) => ({ date: label(p.at), value: p[c.key] as number }));
                return (
                  <div key={c.key} className="min-w-0">
                    <p className="mb-1 text-sm font-medium text-white">{c.title}</p>
                    {pts.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-400">{c.key === "temperature" ? tr("This router has no temperature sensor.") : tr("No readings yet")}</p>
                    ) : (
                      <>
                        <TrendChart points={pts} height={160} format={(v) => `${Math.round(v * 10) / 10}${c.unit}`} caption={`${c.title}, ${hours === 24 ? tr("24 hours") : tr("7 days")}`} />
                        <ChartTable columns={[tr("Time"), c.title]} rows={pts.map((p) => [p.date, `${p.value}${c.unit}`])} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
