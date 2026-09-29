"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import {
  CHANNEL_LABEL,
  DESTINATION_LABEL,
  EmptyRow,
  ErrorRow,
  LoadingRows,
  Money,
  PROVIDER_LABEL,
  Pagination,
  StatusBadge,
  TableShell,
  formatDateTime,
  inputClass,
  qs,
  td,
  th,
} from "./kit";
import { TransactionDrawer } from "./transaction-drawer";
import { SettlementDrawer } from "./settlement-drawer";
import type { GatewayTransaction, Page, Settlement } from "./types";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const selectClass = `${inputClass} sm:w-auto`;

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export function TransactionsView({
  endpointBase,
  admin = false,
  tenants,
  compact = false,
  pageSize = 25,
}: {
  endpointBase: string;
  admin?: boolean;
  tenants?: { id: string; name: string }[];
  /** Overview widgets: no filters, no pagination. */
  compact?: boolean;
  pageSize?: number;
}) {
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState("");
  const [settlementStatus, setSettlementStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);
  const debouncedCustomer = useDebounced(customer);

  useEffect(() => setPage(1), [debouncedSearch, debouncedCustomer, status, settlementStatus, channel, tenantId, from, to]);

  const query = qs({
    search: debouncedSearch,
    customer: debouncedCustomer,
    status,
    settlementStatus,
    channel,
    tenantId,
    from: from || undefined,
    to: to ? `${to}T23:59:59+03:00` : undefined,
    page,
    pageSize,
  });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["gateway-transactions", endpointBase, query],
    queryFn: () => apiFetch<Page<GatewayTransaction>>(`${endpointBase}/transactions${query}`),
    placeholderData: (prev) => prev,
  });

  const cols = admin ? 9 : 8;
  return (
    <>
      {!compact && (
        <div className="grid gap-2 border-b border-obsidian-800 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input className={inputClass} placeholder="Transaction ID, M-Pesa receipt or reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search transactions" />
          <input className={inputClass} placeholder="Customer name or number" value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" />
          {admin && tenants && (
            <select className={selectClass} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Tenant">
              <option value="">All ISPs</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIALLY_REFUNDED">Partly refunded</option>
            <option value="REFUNDED">Refunded</option>
            <option value="REVERSED">Reversed</option>
          </select>
          <select className={selectClass} value={settlementStatus} onChange={(e) => setSettlementStatus(e.target.value)} aria-label="Settlement status">
            <option value="">Any settlement status</option>
            <option value="UNSETTLED">Unsettled</option>
            <option value="SETTLEMENT_PENDING">Settlement pending</option>
            <option value="SETTLED">Settled</option>
          </select>
          <select className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Payment method">
            <option value="">Any method</option>
            <option value="MPESA_STK">M-Pesa STK</option>
            <option value="MPESA_C2B">M-Pesa Paybill</option>
          </select>
          <div className="flex items-center gap-2">
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-slate-500">–</span>
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
        </div>
      )}
      <TableShell minWidth={admin ? 980 : 860}>
        <thead>
          <tr>
            <th className={th}>Transaction</th>
            {admin && <th className={th}>ISP</th>}
            <th className={th}>Customer</th>
            <th className={`${th} text-right`}>Amount</th>
            <th className={`${th} text-right`}>Fee</th>
            <th className={`${th} text-right`}>Net</th>
            <th className={th}>Method</th>
            <th className={th}>Status</th>
            <th className={th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <LoadingRows cols={cols + 1} rows={compact ? 4 : 8} />}
          {error && <ErrorRow cols={cols + 1} error={error} onRetry={() => void refetch()} />}
          {data && data.items.length === 0 && (
            <EmptyRow cols={cols + 1} title="No transactions yet">
              {compact ? "Payments collected through the Suntech gateway appear here." : "Nothing matches these filters."}
            </EmptyRow>
          )}
          {data?.items.map((t) => (
            <tr
              key={t.id}
              className="cursor-pointer transition-colors hover:bg-obsidian-950 focus-within:bg-obsidian-950"
              onClick={() => setOpenId(t.id)}
            >
              <td className={td}>
                <button type="button" className="font-mono text-xs font-medium text-brand-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={(e) => { e.stopPropagation(); setOpenId(t.id); }}>
                  {t.txnNumber}
                </button>
                <p className="font-mono text-[11px] text-slate-500">{t.providerReference}</p>
              </td>
              {admin && <td className={td}>{t.tenant?.name ?? "—"}</td>}
              <td className={td}>
                {t.customer ? (
                  <>
                    <p className="text-slate-100">{t.customer.fullName}</p>
                    <p className="text-xs text-slate-400">{t.customer.customerNumber}</p>
                  </>
                ) : (
                  <span className="text-slate-400">Hotspot · {t.payerPhone ?? "walk-in"}</span>
                )}
              </td>
              <td className={`${td} text-right font-medium text-slate-100`}>
                <Money minor={t.grossMinor} />
              </td>
              <td className={`${td} text-right text-slate-400`}>
                <Money minor={t.feeMinor} />
              </td>
              <td className={`${td} text-right font-medium text-slate-100`}>
                <Money minor={t.netMinor} />
              </td>
              <td className={td}>{CHANNEL_LABEL[t.channel] ?? t.channel}</td>
              <td className={td}>
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge status={t.status} />
                  <StatusBadge status={t.settlementStatus} />
                </div>
              </td>
              <td className={`${td} text-slate-400`}>{formatDateTime(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {!compact && data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <TransactionDrawer id={openId} onClose={() => setOpenId(null)} endpointBase={endpointBase} admin={admin} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------------------------

export function SettlementsView({
  endpointBase,
  admin = false,
  tenants,
  compact = false,
  sandboxActions = false,
  initialStatus = "",
  pageSize = 25,
}: {
  endpointBase: string;
  admin?: boolean;
  tenants?: { id: string; name: string }[];
  compact?: boolean;
  sandboxActions?: boolean;
  initialStatus?: string;
  pageSize?: number;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [provider, setProvider] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);
  useEffect(() => setPage(1), [status, provider, tenantId, debouncedSearch]);

  const query = qs({ status, provider, tenantId, search: debouncedSearch, page, pageSize });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["settlements", endpointBase, query],
    queryFn: () => apiFetch<Page<Settlement>>(`${endpointBase}/settlements${query}`),
    placeholderData: (prev) => prev,
  });
  const cols = admin ? 8 : 7;

  return (
    <>
      {!compact && (
        <div className="grid gap-2 border-b border-obsidian-800 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input className={inputClass} placeholder="Settlement ID or provider reference" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search settlements" />
          {admin && tenants && (
            <select className={selectClass} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Tenant">
              <option value="">All ISPs</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="AWAITING_APPROVAL">Awaiting approval</option>
            <option value="REQUESTED">Requested</option>
            <option value="PROCESSING">Processing</option>
            <option value="SETTLED">Settled</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          {admin && (
            <select className={selectClass} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Settlement type">
              <option value="">Any type</option>
              <option value="MPESA_B2B">M-Pesa B2B (till/paybill)</option>
              <option value="MPESA_B2C">M-Pesa B2C (phone)</option>
              <option value="MANUAL">Manual transfer</option>
              <option value="SANDBOX">Sandbox</option>
            </select>
          )}
        </div>
      )}
      <TableShell minWidth={admin ? 980 : 820}>
        <thead>
          <tr>
            <th className={th}>Settlement</th>
            {admin && <th className={th}>ISP</th>}
            <th className={`${th} text-right`}>Amount</th>
            <th className={th}>Destination</th>
            <th className={th}>Type</th>
            <th className={th}>Status</th>
            <th className={th}>Requested</th>
            <th className={th}>Processed</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <LoadingRows cols={cols} rows={compact ? 4 : 8} />}
          {error && <ErrorRow cols={cols} error={error} onRetry={() => void refetch()} />}
          {data && data.items.length === 0 && (
            <EmptyRow cols={cols} title="No settlements yet">
              {compact ? "When money is sent out to an ISP, it is listed here." : "Nothing matches these filters."}
            </EmptyRow>
          )}
          {data?.items.map((s) => (
            <tr key={s.id} className="cursor-pointer transition-colors hover:bg-obsidian-950" onClick={() => setOpenId(s.id)}>
              <td className={td}>
                <button type="button" className="font-mono text-xs font-medium text-brand-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={(e) => { e.stopPropagation(); setOpenId(s.id); }}>
                  {s.settlementNumber}
                </button>
                {s.transactionId && <p className="font-mono text-[11px] text-slate-500">{s.transactionId}</p>}
              </td>
              {admin && <td className={td}>{s.tenant?.name ?? "—"}</td>}
              <td className={`${td} text-right font-medium text-slate-100`}>
                <Money minor={s.amountMinor} />
              </td>
              <td className={td}>{s.destinationSnapshot?.label ?? DESTINATION_LABEL[s.destinationType] ?? s.destinationType}</td>
              <td className={td}>{PROVIDER_LABEL[s.provider] ?? s.provider}</td>
              <td className={td}>
                <StatusBadge status={s.status} />
                {(s.timedOutAt || (s.status === "PROCESSING" && s.failureReason)) && <p className="mt-1 text-[11px] font-medium text-amber-300">Needs review</p>}
              </td>
              <td className={`${td} text-slate-400`}>{formatDateTime(s.createdAt)}</td>
              <td className={`${td} text-slate-400`}>{formatDateTime(s.completedAt ?? s.failedAt ?? s.cancelledAt)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {!compact && data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <SettlementDrawer id={openId} onClose={() => setOpenId(null)} endpointBase={endpointBase} admin={admin} sandboxActions={sandboxActions} />
    </>
  );
}
