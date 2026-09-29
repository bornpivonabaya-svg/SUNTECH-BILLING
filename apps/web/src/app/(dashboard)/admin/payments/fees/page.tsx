"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  Alert,
  Dialog,
  Field,
  Money,
  PLATFORM_TABS,
  Panel,
  PaymentsWorkspace,
  TableShell,
  buttonClass,
  inputClass,
  percentFromBps,
  td,
  th,
} from "@/components/payments-gateway/kit";
import { usePlatformTenants } from "@/components/payments-gateway/use-platform";
import { WEEKDAYS, describeSchedule, type PlatformTenantRow, type SettlementSettings } from "@/components/payments-gateway/types";

/** Same integer arithmetic as the server (packages/payments/src/gateway/fees.ts), for the preview. */
function previewFee(grossMinor: number, bps: number, fixedMinor: number) {
  const fee = Math.min(grossMinor, Math.floor((grossMinor * bps + 5_000) / 10_000) + fixedMinor);
  return { fee, net: grossMinor - fee };
}

const toBps = (percent: string) => Math.round(Number(percent || "0") * 100);
const toMinor = (kes: string) => Math.round(Number((kes || "0").replace(/,/g, "")) * 100);

export default function PlatformFeesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = Boolean(user?.permissions.includes("platform_payments.manage"));
  const settings = useQuery({
    queryKey: ["platform-payments", "settings"],
    queryFn: () => apiFetch<SettlementSettings>("/api/v1/platform/payments/settings"),
  });
  const tenants = usePlatformTenants();

  const [percent, setPercent] = useState("0");
  const [fixed, setFixed] = useState("0");
  const [mode, setMode] = useState<SettlementSettings["settlementMode"]>("AUTOMATIC");
  const [frequency, setFrequency] = useState<SettlementSettings["settlementFrequency"]>("DAILY");
  const [minimum, setMinimum] = useState("100");
  const [hour, setHour] = useState(9);
  const [weekday, setWeekday] = useState(1);
  const [saved, setSaved] = useState(false);
  const [override, setOverride] = useState<PlatformTenantRow | null>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setPercent(String(s.feePercentBps / 100));
    setFixed(String(s.feeFixedMinor / 100));
    setMode(s.settlementMode);
    setFrequency(s.settlementFrequency);
    setMinimum(String(s.settlementMinimumMinor / 100));
    setHour(s.settlementHourEat);
    setWeekday(s.settlementWeekday);
  }, [settings.data]);

  const bps = toBps(percent);
  const fixedMinor = toMinor(fixed);
  const minimumMinor = toMinor(minimum);
  const invalid =
    !Number.isFinite(bps) || bps < 0 || bps > 10_000 || !Number.isFinite(fixedMinor) || fixedMinor < 0 || !Number.isFinite(minimumMinor) || minimumMinor < 100 || minimumMinor % 100 !== 0;
  const example = previewFee(100_000, bps, fixedMinor);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/platform/payments/settings", {
        method: "PUT",
        body: JSON.stringify({
          feePercentBps: bps,
          feeFixedMinor: fixedMinor,
          settlementMode: mode,
          settlementFrequency: frequency,
          settlementMinimumMinor: minimumMinor,
          settlementHourEat: hour,
          settlementWeekday: weekday,
        }),
      }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["platform-payments"] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <PaymentsWorkspace
      tabs={PLATFORM_TABS}
      title="Fees & settlement"
      description="What Suntech charges ISPs on the gateway, and how and when their money is sent. Changes apply to new payments only — every past transaction keeps the fee it was charged."
    >
      {settings.error && <Alert title="Couldn't load settings">{(settings.error as Error).message}</Alert>}
      <form onSubmit={submit} className="space-y-6" noValidate>
        <Panel title="Platform fee">
          <fieldset disabled={!canManage} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Percentage" htmlFor="fee-pct" hint="e.g. 2 for 2%. Up to two decimals.">
                <div className="relative">
                  <input id="fee-pct" inputMode="decimal" className={`${inputClass} pr-8`} value={percent} onChange={(e) => setPercent(e.target.value)} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">%</span>
                </div>
              </Field>
              <Field label="Fixed fee per payment" htmlFor="fee-fixed" hint="In KES. Added to the percentage.">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">KES</span>
                  <input id="fee-fixed" inputMode="decimal" className={`${inputClass} pl-12`} value={fixed} onChange={(e) => setFixed(e.target.value)} />
                </div>
              </Field>
            </div>
            <div className="rounded-lg border border-obsidian-800 bg-obsidian-950 p-4 text-sm">
              <p className="font-medium text-slate-100">Example</p>
              <dl className="mt-3 space-y-1.5">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Customer pays</dt>
                  <dd className="tabular-nums">KES 1,000.00</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Platform fee</dt>
                  <dd className="tabular-nums">− <Money minor={invalid ? 0 : example.fee} cents /></dd>
                </div>
                <div className="flex justify-between border-t border-obsidian-800 pt-1.5 font-semibold text-white">
                  <dt>ISP receives</dt>
                  <dd className="tabular-nums text-emerald-300">
                    <Money minor={invalid ? 100_000 : example.net} cents />
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-400">The fee never exceeds the payment itself. Refunds return the matching share of the fee.</p>
            </div>
          </fieldset>
        </Panel>

        <Panel title="Settlement policy">
          <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Mode" htmlFor="set-mode" hint={mode === "MANUAL" ? "Every settlement waits for a super admin." : "Settlements are sent without review."}>
              <select id="set-mode" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="AUTOMATIC">Automatic</option>
                <option value="MANUAL">Manual approval</option>
              </select>
            </Field>
            <Field label="Frequency" htmlFor="set-freq" hint={describeSchedule({ frequency, hourEat: hour, weekday })}>
              <select id="set-freq" className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                <option value="INSTANT">Instant</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MANUAL">Only on request</option>
              </select>
            </Field>
            {(frequency === "DAILY" || frequency === "WEEKLY") && (
              <Field label="Time (EAT)" htmlFor="set-hour">
                <select id="set-hour" className={inputClass} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {frequency === "WEEKLY" && (
              <Field label="Day" htmlFor="set-day">
                <select id="set-day" className={inputClass} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Minimum settlement" htmlFor="set-min" hint="Whole shillings. Smaller balances roll over.">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">KES</span>
                <input id="set-min" inputMode="numeric" className={`${inputClass} pl-12`} value={minimum} onChange={(e) => setMinimum(e.target.value)} />
              </div>
            </Field>
          </fieldset>
          <p className="mt-4 text-xs text-slate-400">
            “Instant” settles within minutes of each payment, batched per run so an ISP pays one M-Pesa transfer fee per run rather than one per
            customer payment. Bank settlements are always manual.
          </p>
        </Panel>

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonClass("primary")} disabled={invalid || save.isPending}>
              {save.isPending ? "Saving…" : "Save fees & settlement"}
            </button>
            {invalid && <span className="text-sm text-red-300">Check the values: percentage 0–100, minimum at least KES 1 in whole shillings.</span>}
            {saved && !save.isPending && <span className="text-sm text-emerald-300">Saved. Applies to new payments from now on.</span>}
          </div>
        )}
        {save.error && <Alert title="Couldn't save">{(save.error as ApiRequestError).message}</Alert>}
      </form>

      <Panel title="Per-ISP fees" description="Override the platform fee for a specific ISP. Blank uses the platform fee." padded={false}>
        <TableShell minWidth={560}>
          <thead>
            <tr>
              <th className={th}>ISP</th>
              <th className={th}>Fee</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.data?.map((t) => {
              const custom = t.feePercentBpsOverride !== null || t.feeFixedMinorOverride !== null;
              return (
                <tr key={t.id}>
                  <td className={`${td} font-medium text-slate-100`}>{t.name}</td>
                  <td className={td}>
                    {custom ? (
                      <span>
                        {percentFromBps(t.feePercentBpsOverride ?? settings.data?.feePercentBps ?? 0)} + <Money minor={t.feeFixedMinorOverride ?? settings.data?.feeFixedMinor ?? 0} />{" "}
                        <span className="ml-1 text-xs font-medium text-brand-300">custom</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">Platform fee</span>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {canManage && (
                      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOverride(t)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </Panel>

      {override && <OverrideDialog tenant={override} onClose={() => setOverride(null)} />}
    </PaymentsWorkspace>
  );
}

function OverrideDialog({ tenant, onClose }: { tenant: PlatformTenantRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [percent, setPercent] = useState(tenant.feePercentBpsOverride === null ? "" : String(tenant.feePercentBpsOverride / 100));
  const [fixed, setFixed] = useState(tenant.feeFixedMinorOverride === null ? "" : String(tenant.feeFixedMinorOverride / 100));
  const save = useMutation({
    mutationFn: (body: { feePercentBpsOverride: number | null; feeFixedMinorOverride: number | null }) =>
      apiFetch(`/api/v1/platform/payments/tenants/${tenant.id}/fee-override`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-payments"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Fee for ${tenant.name}`}
      footer={
        <>
          <button type="button" className={buttonClass("ghost")} onClick={() => save.mutate({ feePercentBpsOverride: null, feeFixedMinorOverride: null })}>
            Use platform fee
          </button>
          <button
            type="button"
            className={buttonClass("primary")}
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                feePercentBpsOverride: percent.trim() === "" ? null : toBps(percent),
                feeFixedMinorOverride: fixed.trim() === "" ? null : toMinor(fixed),
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <p>Leave a field blank to use the platform value for that part.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Percentage" htmlFor="ov-pct">
          <input id="ov-pct" inputMode="decimal" className={inputClass} value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Platform" />
        </Field>
        <Field label="Fixed (KES)" htmlFor="ov-fixed">
          <input id="ov-fixed" inputMode="decimal" className={inputClass} value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="Platform" />
        </Field>
      </div>
      {save.error && <Alert>{(save.error as ApiRequestError).message}</Alert>}
    </Dialog>
  );
}
