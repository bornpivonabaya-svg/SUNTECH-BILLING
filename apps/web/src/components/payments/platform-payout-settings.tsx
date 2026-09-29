"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { Card } from "@/components/ui";
import type { TenantOverview } from "@/components/payments-gateway/types";
import { formatKes } from "@/components/payments-gateway/kit";

/**
 * "Till / Paybill" option on Getting paid: the Suntech payment gateway. Its settings — where
 * money is sent, requesting a settlement — now live in Payments → Payment Settings, which also
 * supports M-Pesa numbers and bank accounts and keeps an audit trail. This card summarises it.
 */
export function PlatformPayoutSettings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-payments", "overview"],
    queryFn: () => apiFetch<TenantOverview>("/api/v1/tenant-payments/overview"),
  });

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Suntech payment gateway</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          No keys or paybill of your own: Suntech collects your customers&apos; M-Pesa payments, deducts the platform fee and sends the rest
          to your M-Pesa number, till, paybill or bank account.
        </p>
      </div>
      {isLoading && <div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-obsidian-800" />}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{(error as Error).message}</p>}
      {data && (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd className="font-medium text-slate-900 dark:text-white">{data.gateway.connected ? "Connected" : "Not connected"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Sending to</dt>
            <dd className="font-medium text-slate-900 dark:text-white">{data.destination?.label ?? "No destination yet"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Available balance</dt>
            <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{formatKes(data.balance.availableMinor)}</dd>
          </div>
        </dl>
      )}
      <Link
        href="/payments/settings"
        className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Open payment settings
      </Link>
    </Card>
  );
}
