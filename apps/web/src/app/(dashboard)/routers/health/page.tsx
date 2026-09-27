"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { tr } from "@/lib/tr";
import { TrendChart } from "@/components/charts/trend-chart";
import { ChartTable } from "@/components/charts/chart-table";
import { EmptyState, PageHeader, Panel, Pill, Segmented, TableShell, td, th } from "@/components/dashboard/surface";

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
        description={tr("CPU, memory, temperature and uptime for every router, recorded every 5 minutes. You get an alert when a router stays busy, runs hot or restarts on its own.")}
      />

      <Panel title={tr("All routers")} padded={false}>
        {!fleet?.length ? (
          <EmptyState title={tr("No routers yet")} />
        ) : (
          <TableShell minWidth={780}>
            <thead>
              <tr>
                <th className={th}>{tr("Router")}</th>
                <th className={`${th} text-right`}>{tr("CPU")}</th>
                <th className={`${th} text-right`}>{tr("Memory used")}</th>
                <th className={`${th} text-right`}>{tr("Temperature")}</th>
                <th className={`${th} text-right`}>{tr("Up for")}</th>
                <th className={`${th} text-right`}>{tr("Reachable, 24 h")}</th>
                <th className={`${th} text-right`}>{tr("Restarts, 7 days")}</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((r) => (
                <tr key={r.id} className={r.id === routerId ? "bg-obsidian-800/40" : undefined}>
                  <td className={td}>
                    <button type="button" className="font-medium text-white hover:underline" onClick={() => setRouterId(r.id)} aria-pressed={r.id === routerId}>
                      {r.name}
                    </button>
                    {r.siteName && <span className="block text-xs text-slate-500">{r.siteName}</span>}
                  </td>
                  <td className={`${td} text-right`}>{r.latest?.cpuPercent != null ? <Pill tone={tone(r.latest.cpuPercent, 70, 90)}>{r.latest.cpuPercent}%</Pill> : "—"}</td>
                  <td className={`${td} text-right`}>{r.latest?.memoryPercent != null ? <Pill tone={tone(r.latest.memoryPercent, 80, 92)}>{r.latest.memoryPercent}%</Pill> : "—"}</td>
                  <td className={`${td} text-right`}>{r.latest?.temperatureC != null ? <Pill tone={tone(r.latest.temperatureC, 65, 75)}>{r.latest.temperatureC} °C</Pill> : "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{uptime(r.latest?.uptimeSeconds)}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.availability24h != null ? `${r.availability24h}%` : "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.reboots7d > 0 ? <Pill tone="warn">{r.reboots7d}</Pill> : "0"}</td>
                </tr>
              ))}
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
