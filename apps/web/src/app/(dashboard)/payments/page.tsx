"use client";

import Link from "next/link";
import {
  Alert,
  EnvironmentBadge,
  Money,
  Panel,
  PaymentsWorkspace,
  StatCard,
  StatGrid,
  TENANT_TABS,
  buttonClass,
  percentFromBps,
} from "@/components/payments-gateway/kit";
import { CollectionsChart } from "@/components/payments-gateway/collections-chart";
import { SettlementsView, TransactionsView } from "@/components/payments-gateway/lists";
import { RequestSettlementButton } from "@/components/payments-gateway/tenant-widgets";
import { useTenantOverview } from "@/components/payments-gateway/use-tenant-overview";
import { describeSchedule } from "@/components/payments-gateway/types";

export default function PaymentsOverviewPage() {
  const { data, isLoading, error } = useTenantOverview();
  const b = data?.balance;

  return (
    <PaymentsWorkspace
      tabs={TENANT_TABS}
      title="Payments"
      description="Money collected for you through the Suntech payment gateway, and what we've sent on to you."
      actions={<RequestSettlementButton balance={b} destination={data?.destination} minimumMinor={data?.settlement.minimumMinor} />}
    >
      {error && <Alert title="Couldn't load your payments">{(error as Error).message}</Alert>}

      {data && !data.gateway.connected && (
        <Alert tone="blue" title="You're not using the Suntech gateway yet">
          Your customers currently pay into your own M-Pesa account. Connect the Suntech gateway to accept payments without a
          paybill of your own — we collect, deduct the platform fee, and send the rest to you.{" "}
          <Link href="/payments/settings" className="font-semibold underline">
            Set it up
          </Link>
        </Alert>
      )}
      {data && !data.destination && data.gateway.connected && (
        <Alert tone="amber" title="Add a settlement destination">
          We&apos;re collecting for you, but have nowhere to send the money yet.{" "}
          <Link href="/payments/settings" className="font-semibold underline">
            Add one now
          </Link>
        </Alert>
      )}

      <StatGrid>
        <StatCard
          label="Available balance"
          value={<Money minor={b?.availableMinor} />}
          loading={isLoading}
          tone={b && b.availableMinor < 0 ? "red" : "green"}
          hint={b && b.availableMinor < 0 ? "Owed to Suntech after a refund — recovered from your next collections" : "Ready to be sent to you"}
        />
        <StatCard label="Pending settlement" value={<Money minor={b?.pendingSettlementMinor} />} loading={isLoading} tone="amber" hint="On its way to your destination" />
        <StatCard label="Today's collections" value={<Money minor={data?.todayCollectionsMinor} />} loading={isLoading} />
        <StatCard label="This month" value={<Money minor={data?.monthCollectionsMinor} />} loading={isLoading} hint="Collected, before fees" />
        <StatCard
          label="Platform fees this month"
          value={<Money minor={data?.monthFeesMinor} />}
          loading={isLoading}
          hint={data ? `Current rate: ${feeText(data.feeRule)}` : undefined}
        />
        <StatCard label="Settled to you" value={<Money minor={b?.settledMinor} />} loading={isLoading} hint="All time, confirmed by the provider" />
      </StatGrid>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Panel
        title="Collections, last 30 days"
        description={data ? <span className="inline-flex items-center gap-2">Gross amounts collected <EnvironmentBadge environment={data.gateway.environment} /></span> : undefined}
      >
        <CollectionsChart series={data?.series} loading={isLoading} />
      </Panel>
        <Panel
          title="Settlement"
          description={data ? describeSchedule(data.settlement) : undefined}
          actions={
            <Link href="/payments/settings" className={buttonClass("ghost", "sm")}>
              Settings
            </Link>
          }
        >
          {data?.destination ? (
            <div className="space-y-1 text-sm">
              <p className="text-slate-400">Sending to</p>
              <p className="text-base font-semibold text-white">{data.destination.label}</p>
              <p className="text-slate-400">{data.destination.accountName}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No destination set.</p>
          )}
          <p className="mt-4 text-xs text-slate-400">
            {data ? `Minimum settlement KES ${(data.settlement.minimumMinor / 100).toLocaleString("en-KE")}. ` : ""}
            Amounts are sent in whole shillings; cents roll over.
          </p>
        </Panel>
      </div>

      <Panel
        title="Recent transactions"
        padded={false}
        actions={
          <Link href="/payments/transactions" className={buttonClass("ghost", "sm")}>
            View all
          </Link>
        }
      >
        <TransactionsView endpointBase="/api/v1/tenant-payments" compact pageSize={6} />
      </Panel>

      <Panel
        title="Settlement history"
        padded={false}
        actions={
          <Link href="/payments/settlements" className={buttonClass("ghost", "sm")}>
            View all
          </Link>
        }
      >
        <SettlementsView endpointBase="/api/v1/tenant-payments" compact pageSize={5} />
      </Panel>
    </PaymentsWorkspace>
  );
}

function feeText(rule: { percentBps: number; fixedMinor: number }): string {
  const parts = [];
  if (rule.percentBps) parts.push(percentFromBps(rule.percentBps));
  if (rule.fixedMinor) parts.push(`KES ${(rule.fixedMinor / 100).toLocaleString("en-KE")}`);
  return parts.length ? parts.join(" + ") : "no fee";
}
