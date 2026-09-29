"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  Alert,
  DESTINATION_LABEL,
  Dialog,
  EnvironmentBadge,
  Money,
  Panel,
  PaymentsWorkspace,
  StatusBadge,
  TENANT_TABS,
  buttonClass,
  formatDate,
  percentFromBps,
} from "@/components/payments-gateway/kit";
import { DestinationForm, RequestSettlementButton } from "@/components/payments-gateway/tenant-widgets";
import { useTenantOverview } from "@/components/payments-gateway/use-tenant-overview";
import { FREQUENCY_LABEL, describeSchedule, type Destination } from "@/components/payments-gateway/types";

export default function PaymentSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useTenantOverview();
  const [editing, setEditing] = useState(false);
  const [confirmConnect, setConfirmConnect] = useState(false);
  const canManage = Boolean(user?.permissions.includes("settlement_destinations.manage"));

  const destinations = useQuery({
    queryKey: ["tenant-payments", "destination"],
    queryFn: () => apiFetch<{ active: Destination | null; history: Destination[] }>("/api/v1/tenant-payments/destination"),
  });

  const connect = useMutation({
    mutationFn: () => apiFetch("/api/v1/tenant-payments/gateway/connect", { method: "POST" }),
    onSuccess: () => {
      setConfirmConnect(false);
      void qc.invalidateQueries({ queryKey: ["tenant-payments"] });
    },
  });

  const destination = data?.destination ?? null;
  const past = (destinations.data?.history ?? []).filter((d) => !d.isActive);

  return (
    <PaymentsWorkspace
      tabs={TENANT_TABS}
      title="Payment Settings"
      description="How your customers pay you, and where we send your money."
      actions={<RequestSettlementButton balance={data?.balance} destination={destination} minimumMinor={data?.settlement.minimumMinor} />}
    >
      {error && <Alert title="Couldn't load your payment settings">{(error as Error).message}</Alert>}

      {/* Gateway ---------------------------------------------------------------------------- */}
      <Panel title="Payment gateway">
        {isLoading || !data ? (
          <div className="h-24 animate-pulse rounded-md bg-obsidian-800" />
        ) : (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white" aria-hidden="true">
                M
              </span>
              <div>
                <p className="text-base font-semibold text-white">Suntech Gateway</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {data.gateway.connected ? (
                    <StatusBadge status="SETTLED" label="Connected" />
                  ) : (
                    <StatusBadge status="CANCELLED" label="Not connected" />
                  )}
                  <EnvironmentBadge environment={data.gateway.environment} />
                </div>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                  {data.gateway.connected
                    ? "Your ISP accepts customer payments through Suntech's payment gateway. You don't need a paybill of your own."
                    : "Accept M-Pesa payments through Suntech's gateway — no paybill of your own needed. We collect, deduct the platform fee and settle the rest to you."}
                </p>
                {data.gateway.connected && data.gateway.paybill && (
                  <p className="mt-2 text-sm text-slate-300">
                    Customers pay to paybill <strong className="font-semibold tabular-nums">{data.gateway.paybill}</strong> using their Suntech
                    account number (shown on each customer and invoice), or by STK push.
                  </p>
                )}
              </div>
            </div>
            {!data.gateway.connected && canManage && (
              <div className="shrink-0">
                <button
                  type="button"
                  className={buttonClass("primary")}
                  disabled={!data.gateway.enabledByPlatform || !destination}
                  onClick={() => setConfirmConnect(true)}
                >
                  Connect gateway
                </button>
                {!data.gateway.enabledByPlatform ? (
                  <p className="mt-1.5 max-w-[16rem] text-xs text-slate-400">The gateway isn&apos;t accepting new ISPs right now.</p>
                ) : !destination ? (
                  <p className="mt-1.5 max-w-[16rem] text-xs text-slate-400">Add a settlement destination below first.</p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* Destination ------------------------------------------------------------------------ */}
      <Panel
        title="Settlement destination"
        description="Where your balance is sent."
        actions={
          canManage && destination && !editing ? (
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setEditing(true)}>
              Change settlement destination
            </button>
          ) : undefined
        }
      >
        {!canManage && !destination && <p className="text-sm text-slate-400">No destination set. Ask your account owner to add one.</p>}
        {destination && !editing && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm text-slate-400">{DESTINATION_LABEL[destination.type]}</p>
              <p className="mt-0.5 text-lg font-semibold text-white">{destination.label}</p>
              <p className="text-sm text-slate-400">{destination.accountName}</p>
              {destination.bankBranch && <p className="text-sm text-slate-400">{destination.bankBranch} branch</p>}
            </div>
            <div className="space-y-1.5 sm:text-right">
              <StatusBadge status={destination.verificationStatus} />
              <p className="text-xs text-slate-400">
                {destination.verificationStatus === "VERIFIED"
                  ? `Confirmed by a successful settlement on ${formatDate(destination.verifiedAt)}`
                  : "Verified automatically after the first successful settlement"}
              </p>
              <p className="text-xs text-slate-400">
                {destination.settlementMethod === "AUTOMATIC" ? "Sent automatically" : "Sent manually by the Suntech team"}
              </p>
            </div>
          </div>
        )}
        {canManage && (editing || !destination) && (
          <DestinationForm current={destination} onDone={destination ? () => setEditing(false) : undefined} />
        )}
        {past.length > 0 && !editing && (
          <details className="mt-5 border-t border-obsidian-800 pt-4 text-sm">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-100">Previous destinations ({past.length})</summary>
            <ul className="mt-3 space-y-1.5">
              {past.map((d) => (
                <li key={d.id} className="flex justify-between gap-3 text-slate-400">
                  <span>
                    {d.label} · {d.accountName}
                  </span>
                  <span className="text-xs text-slate-500">added {formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      {/* Terms -------------------------------------------------------------------------------- */}
      <Panel title="Settlement terms" description="Set by Suntech for all ISPs on the gateway.">
        {data ? (
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Term label="Settlement mode" value={data.settlement.mode === "AUTOMATIC" ? "Automatic" : "Reviewed by Suntech"} />
            <Term label="Settlement frequency" value={`${FREQUENCY_LABEL[data.settlement.frequency]} — ${describeSchedule(data.settlement)}`} />
            <Term
              label="Platform fee"
              value={
                [data.feeRule.percentBps ? percentFromBps(data.feeRule.percentBps) : null, data.feeRule.fixedMinor ? `KES ${(data.feeRule.fixedMinor / 100).toLocaleString("en-KE")}` : null]
                  .filter(Boolean)
                  .join(" + ") || "No fee"
              }
            />
            <Term label="Minimum settlement" value={<Money minor={data.settlement.minimumMinor} />} />
            <Term label="Available balance" value={<Money minor={data.balance.availableMinor} />} />
            <Term label="Pending settlement" value={<Money minor={data.balance.pendingSettlementMinor} />} />
          </dl>
        ) : (
          <div className="h-20 animate-pulse rounded-md bg-obsidian-800" />
        )}
      </Panel>

      <Dialog
        open={confirmConnect}
        onClose={() => setConfirmConnect(false)}
        title="Connect the Suntech gateway?"
        footer={
          <>
            <button type="button" className={buttonClass("ghost")} onClick={() => setConfirmConnect(false)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary")} disabled={connect.isPending} onClick={() => connect.mutate()}>
              {connect.isPending ? "Connecting…" : "Connect"}
            </button>
          </>
        }
      >
        <p>From now on, customer M-Pesa payments are collected by Suntech and credited to your balance after the platform fee.</p>
        <p>Payments your customers already made to your own paybill are not affected. To switch back later, contact Suntech support.</p>
        {connect.error && <Alert>{(connect.error as ApiRequestError).message}</Alert>}
      </Dialog>
    </PaymentsWorkspace>
  );
}

function Term({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-100">{value}</dd>
    </div>
  );
}
