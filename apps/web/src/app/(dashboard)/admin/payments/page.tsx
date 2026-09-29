"use client";

import Link from "next/link";
import {
  Alert,
  EnvironmentBadge,
  Money,
  PLATFORM_TABS,
  Panel,
  PaymentsWorkspace,
  StatCard,
  StatGrid,
  TableShell,
  buttonClass,
  td,
  th,
} from "@/components/payments-gateway/kit";
import { CollectionsChart } from "@/components/payments-gateway/collections-chart";
import { SettlementsView, TransactionsView } from "@/components/payments-gateway/lists";
import { usePlatformGateway, usePlatformOverview, usePlatformTenants } from "@/components/payments-gateway/use-platform";

export default function PlatformPaymentsOverviewPage() {
  const { data, isLoading, error } = usePlatformOverview();
  const gateway = usePlatformGateway();
  const tenants = usePlatformTenants();
  const owed = (tenants.data ?? []).filter((t) => t.balance.availableMinor !== 0 || t.balance.pendingSettlementMinor > 0);

  return (
    <PaymentsWorkspace
      tabs={PLATFORM_TABS}
      title="Payments"
      description={
        data ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            Money collected through the Suntech gateway on behalf of ISPs. <EnvironmentBadge environment={data.environment} />
          </span>
        ) : (
          "Money collected through the Suntech gateway on behalf of ISPs."
        )
      }
    >
      {error && <Alert title="Couldn't load the payments overview">{(error as Error).message}</Alert>}
      {data && !data.gatewayEnabled && (
        <Alert tone="amber" title="The gateway is switched off">
          New platform collections are refused until it is enabled in <Link href="/admin/payments/gateway" className="font-semibold underline">Payment Gateway</Link>.
        </Alert>
      )}
      {gateway.data && !gateway.data.callbackTokenConfigured && (
        <Alert tone="red" title="Callbacks are not protected">
          MPESA_CALLBACK_TOKEN is not set, so the M-Pesa callback URLs accept payment confirmations from anyone. Set it on the API server before
          handling real money.
        </Alert>
      )}

      <StatGrid>
        <StatCard label="Today's collections" value={<Money minor={data?.todayCollectionsMinor} />} loading={isLoading} hint={data ? `${data.todayCount} payment${data.todayCount === 1 ? "" : "s"}` : undefined} tone="green" />
        <StatCard
          label="Pending settlements"
          value={<Money minor={data?.pendingSettlementsMinor} />}
          loading={isLoading}
          tone="amber"
          hint={data ? `${data.pendingSettlementsCount} in progress${data.awaitingApprovalCount ? ` · ${data.awaitingApprovalCount} awaiting approval` : ""}` : undefined}
        />
        <StatCard label="Settled (30 days)" value={<Money minor={data?.settledMinor30d} />} loading={isLoading} hint="Confirmed paid out to ISPs" />
        <StatCard label="Platform revenue (30 days)" value={<Money minor={data?.platformRevenueMinor30d} />} loading={isLoading} hint="Fees, net of fees returned on refunds" />
        <StatCard label="Failed payments (30 days)" value={data?.failedPayments30d.toLocaleString() ?? "—"} loading={isLoading} tone="red" hint="STK pushes that failed at M-Pesa" />
        <StatCard label="Refunds (30 days)" value={<Money minor={data?.refundsMinor30d} />} loading={isLoading} tone="red" />
      </StatGrid>

      <Panel title="Collections, last 30 days" description={data ? <>Gross amounts collected · <Money minor={data.monthCollectionsMinor} /> this month</> : undefined}>
        <CollectionsChart series={data?.series} loading={isLoading} />
      </Panel>

      {data && data.awaitingApprovalCount > 0 && (
        <Panel title="Awaiting your approval" padded={false}>
          <SettlementsView endpointBase="/api/v1/platform/payments" admin compact initialStatus="AWAITING_APPROVAL" sandboxActions={gateway.data?.sandboxSettlements} />
        </Panel>
      )}

      <Panel
        title="Recent transactions"
        padded={false}
        actions={
          <Link href="/admin/payments/transactions" className={buttonClass("ghost", "sm")}>
            View all
          </Link>
        }
      >
        <TransactionsView endpointBase="/api/v1/platform/payments" admin compact pageSize={8} />
      </Panel>

      <Panel
        title="Owed to ISPs"
        description={data ? <>Net held for ISPs: <Money minor={data.totalOwedMinor} /></> : undefined}
        padded={false}
        actions={
          <Link href="/admin/payments/settlements" className={buttonClass("ghost", "sm")}>
            Settlements
          </Link>
        }
      >
        <TableShell minWidth={640}>
          <thead>
            <tr>
              <th className={th}>ISP</th>
              <th className={`${th} text-right`}>Available</th>
              <th className={`${th} text-right`}>Pending settlement</th>
              <th className={th}>Destination</th>
            </tr>
          </thead>
          <tbody>
            {tenants.isLoading && (
              <tr>
                <td colSpan={4} className={td}>
                  <div className="h-4 w-1/2 animate-pulse rounded bg-obsidian-800" />
                </td>
              </tr>
            )}
            {!tenants.isLoading && owed.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                  Nothing is owed to any ISP right now.
                </td>
              </tr>
            )}
            {owed.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <p className="font-medium text-slate-100">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.collectionMode === "PLATFORM" ? "On the gateway" : "Own paybill now"}</p>
                </td>
                <td className={`${td} text-right font-medium ${t.balance.availableMinor < 0 ? "text-red-300" : "text-slate-100"}`}>
                  <Money minor={t.balance.availableMinor} />
                </td>
                <td className={`${td} text-right`}>
                  <Money minor={t.balance.pendingSettlementMinor} />
                </td>
                <td className={td}>{t.destination?.label ?? <span className="text-amber-300">None set</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>
    </PaymentsWorkspace>
  );
}
