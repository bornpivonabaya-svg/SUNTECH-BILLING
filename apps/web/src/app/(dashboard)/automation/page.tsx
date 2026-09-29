"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { timeAgo } from "@/components/notifications";
import { EmptyState, Modal, Notice, PageHeader, Panel, Pill, TableShell, darkButton, td, th } from "@/components/dashboard/surface";

/**
 * What runs on its own, and whether it is: every scheduled job the worker owns, grouped by the
 * part of the business it acts on. An operator whose customers are not being reactivated after
 * paying comes here first; before this page the answer lived only in the worker's console.
 */

// Mirrors packages/shared's automation contract. Not imported from there: the shared index also
// exports the argon2-backed password helpers, which must never reach a browser bundle.
type AutomationCategory = "billing" | "collections" | "network" | "payments" | "platform";

interface AutomationRunRecord {
  job: string;
  trigger: "schedule" | "manual";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  summary: Record<string, number>;
  error: string | null;
}

const AUTOMATION_CATEGORY_LABELS: Record<AutomationCategory, string> = {
  billing: "Billing",
  collections: "Payment reminders",
  network: "Network",
  payments: "Payments",
  platform: "Platform",
};

type JobStatus = "ok" | "failed" | "late" | "never";

interface PublicRun {
  trigger: "schedule" | "manual";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
}

interface JobRow {
  name: string;
  label: string;
  description: string;
  category: AutomationCategory;
  everyMs: number;
  status: JobStatus;
  nextRunAt: string;
  /** Full record for platform admins, health-only for tenant staff. */
  lastRun: AutomationRunRecord | PublicRun | null;
  counters?: Record<string, string>;
}

interface JobsResponse {
  worker: { online: boolean; lastHeartbeatAt: string | null };
  audience: "tenant" | "platform";
  jobs: JobRow[];
}

const STATUS: Record<JobStatus, { tone: "good" | "warn" | "bad" | "neutral"; label: string }> = {
  ok: { tone: "good", label: "Healthy" },
  failed: { tone: "bad", label: "Last run failed" },
  late: { tone: "warn", label: "Behind schedule" },
  never: { tone: "neutral", label: "Not run yet" },
};

const CATEGORY_ORDER: AutomationCategory[] = ["billing", "collections", "network", "payments", "platform"];

function every(ms: number): string {
  if (ms < 60_000) return `every ${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return ms === 3_600_000 ? "hourly" : `every ${Math.round(ms / 3_600_000)} h`;
  return "daily";
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function untilShort(iso: string, now: number): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (seconds <= 5) return "any moment";
  if (seconds < 60) return `in ${seconds} s`;
  if (seconds < 3600) return `in ${Math.round(seconds / 60)} min`;
  return `in ${Math.round(seconds / 3600)} h`;
}

function isFullRun(run: JobRow["lastRun"]): run is AutomationRunRecord {
  return run !== null && "summary" in run;
}

/** "3 created · 1 failed": the counters that were non-zero, in the catalog's order. */
function summaryLine(run: AutomationRunRecord, counters: Record<string, string> | undefined): string {
  const parts = Object.entries(counters ?? {})
    .map(([key, label]) => [run.summary[key] ?? 0, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label.toLowerCase()}`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing was due";
}

export default function AutomationPage() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [historyFor, setHistoryFor] = useState<JobRow | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["automation-jobs"],
    queryFn: () => apiFetch<JobsResponse>("/api/v1/automation/jobs"),
    // Matches the fastest schedule (router changes every 20 s), so a "Run now" shows its result
    // without a reload, and "next run" counts down honestly.
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const runNow = useMutation({
    mutationFn: (name: string) => apiFetch<{ message: string; workerOnline: boolean }>(`/api/v1/automation/jobs/${name}/run`, { method: "POST" }),
    onSuccess: (res) => {
      setFlash({ ok: res.workerOnline, text: res.message });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["automation-jobs"] }), 3000);
    },
    onError: (err) => setFlash({ ok: false, text: err instanceof Error ? err.message : String(err) }),
  });

  const isPlatform = data?.audience === "platform";
  const worker = data?.worker;
  const failing = data?.jobs.filter((j) => j.status === "failed" || j.status === "late") ?? [];

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader
        title="Automation"
        description={
          isPlatform
            ? "Every job the worker runs on a schedule, across all ISPs. Run one ahead of time when something needs to happen now."
            : "What happens on its own for your customers: invoicing, reminders, suspensions and reactivations, router checks and payment recovery."
        }
        actions={
          worker && (
            <Pill tone={worker.online ? "good" : "bad"}>
              <span className={`h-1.5 w-1.5 rounded-full ${worker.online ? "bg-emerald-400" : "bg-rose-400"}`} aria-hidden="true" />
              {worker.online ? "Worker online" : worker.lastHeartbeatAt ? `Worker offline · last seen ${timeAgo(worker.lastHeartbeatAt)}` : "Worker has never reported in"}
            </Pill>
          )
        }
      />

      {flash && <Notice tone={flash.ok ? "good" : "warn"}>{flash.text}</Notice>}

      {error && <Notice tone="bad">Couldn&rsquo;t load automation status: {error instanceof Error ? error.message : String(error)}</Notice>}

      {worker && !worker.online && (
        <Notice tone="bad">
          The background worker is not running, so nothing on this page is happening: no invoices, no reminders, no suspensions or
          reactivations, and router status is frozen.{" "}
          {isPlatform ? "Check the worker container and its Redis connection." : "Suntech has been alerted; customers already online are unaffected."}
        </Notice>
      )}

      {worker?.online && failing.length > 0 && (
        <Notice tone="warn">
          {failing.length === 1 ? "One job needs attention" : `${failing.length} jobs need attention`}:{" "}
          {failing.map((j) => j.label).join(", ")}.
          {isPlatform ? " Open a job's history for the error." : " The platform team can see the details; you can keep working as normal."}
        </Notice>
      )}

      {isLoading && !data && (
        <Panel>
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        </Panel>
      )}

      {data &&
        CATEGORY_ORDER.map((category) => {
          const jobs = data.jobs.filter((j) => j.category === category);
          if (jobs.length === 0) return null;
          return (
            <Panel key={category} title={AUTOMATION_CATEGORY_LABELS[category]} padded={false}>
              <TableShell minWidth={isPlatform ? 900 : 720}>
                <thead>
                  <tr>
                    <th className={th}>Job</th>
                    <th className={th}>Schedule</th>
                    <th className={th}>Status</th>
                    <th className={th}>Last run</th>
                    {isPlatform && <th className={th}>Result</th>}
                    <th className={th}>Next run</th>
                    {isPlatform && (
                      <th className={`${th} text-right`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const status = STATUS[job.status];
                    const run = job.lastRun;
                    return (
                      <tr key={job.name}>
                        <td className={`${td} whitespace-normal`}>
                          <p className="font-medium text-white">{job.label}</p>
                          <p className="mt-0.5 max-w-md text-xs leading-5 text-slate-400">{job.description}</p>
                        </td>
                        <td className={`${td} text-slate-400`}>{every(job.everyMs)}</td>
                        <td className={td}>
                          <Pill tone={status.tone}>{status.label}</Pill>
                        </td>
                        <td className={`${td} text-slate-400`}>
                          {run ? (
                            <>
                              <span className="text-slate-200" title={new Date(run.finishedAt).toLocaleString()}>
                                {timeAgo(run.finishedAt)}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {duration(run.durationMs)}
                                {run.trigger === "manual" && " · run by hand"}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        {isPlatform && (
                          <td className={`${td} whitespace-normal text-slate-300`}>
                            {isFullRun(run) ? (
                              run.ok ? (
                                summaryLine(run, job.counters)
                              ) : (
                                <span className="text-rose-300">{run.error ?? "Failed"}</span>
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className={`${td} text-slate-400`}>{worker?.online ? untilShort(job.nextRunAt, now) : "—"}</td>
                        {isPlatform && (
                          <td className={`${td} text-right`}>
                            <div className="flex justify-end gap-1.5">
                              <button type="button" onClick={() => setHistoryFor(job)} className={darkButton("ghost", "sm")}>
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() => runNow.mutate(job.name)}
                                disabled={runNow.isPending}
                                className={darkButton("secondary", "sm")}
                              >
                                Run now
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            </Panel>
          );
        })}

      {data && data.jobs.length === 0 && (
        <Panel>
          <EmptyState title="No scheduled jobs to show" />
        </Panel>
      )}

      {historyFor && <RunHistory job={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function RunHistory({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["automation-runs", job.name],
    queryFn: () => apiFetch<{ runs: AutomationRunRecord[] }>(`/api/v1/automation/jobs/${job.name}/runs`),
  });
  const runs = data?.runs ?? [];
  const okCount = runs.filter((r) => r.ok).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={job.label}
      description={runs.length > 0 ? `Last ${runs.length} runs · ${okCount} succeeded` : job.description}
      width="max-w-3xl"
    >
      {isLoading ? (
        <p className="py-4 text-center text-sm text-slate-400">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs recorded yet">Runs are recorded from the moment the worker picks the job up.</EmptyState>
      ) : (
        <div className="-mx-5 -my-5">
          <TableShell minWidth={560}>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Took</th>
                <th className={th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.startedAt}>
                  <td className={`${td} text-slate-300`}>
                    {new Date(run.startedAt).toLocaleString()}
                    {run.trigger === "manual" && <span className="ml-1.5 text-xs text-slate-500">by hand</span>}
                  </td>
                  <td className={`${td} text-slate-400`}>{duration(run.durationMs)}</td>
                  <td className={`${td} whitespace-normal`}>
                    {run.ok ? (
                      <span className="text-slate-300">{summaryLine(run, job.counters)}</span>
                    ) : (
                      <span className="text-rose-300">{run.error ?? "Failed"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </Modal>
  );
}
