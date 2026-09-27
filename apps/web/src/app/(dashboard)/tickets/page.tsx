"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { Card, Badge } from "@/components/ui";
import { IconLifeBuoy } from "@/components/icons";
import { tr } from "@/lib/tr";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

interface TicketRow {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  source: string;
  contactName: string | null;
  contactPhone: string | null;
  customer: { id: string; fullName: string; phone: string } | null;
  assignedToUser: { id: string; email: string } | null;
  updatedAt: string;
  responseDueAt?: string;
  firstRepliedAt?: string | null;
  responseOverdue?: boolean;
}

const STATUS_TABS: { value: TicketStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

function statusVariant(status: TicketStatus): "success" | "warning" | "neutral" | "info" {
  if (status === "OPEN") return "warning";
  if (status === "IN_PROGRESS") return "info";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

function priorityVariant(priority: TicketRow["priority"]): "danger" | "warning" | "neutral" {
  if (priority === "URGENT" || priority === "HIGH") return priority === "URGENT" ? "danger" : "warning";
  return "neutral";
}

export default function TicketsPage() {
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "ALL">("ALL");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["tickets", statusFilter],
    queryFn: () =>
      apiFetch<TicketRow[]>(`/api/v1/tickets${statusFilter === "ALL" ? "" : `?status=${statusFilter}`}`),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {tr("Support tickets")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tr("Requests from subscribers, hotspot walk-ins, and staff — reply, assign, and track to resolution.")}
        </p>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-200 [scrollbar-width:none] dark:border-obsidian-800">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              statusFilter === tab.value
                ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">{tr("Loading tickets...")}</p>}

      {tickets && tickets.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-obsidian-800">
          <IconLifeBuoy size={32} className="mx-auto text-slate-400 mb-2" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">{tr("No tickets here")}</h3>
          <p className="text-xs text-slate-500 mt-1">{tr("Nothing matches this filter right now.")}</p>
        </div>
      )}

      {tickets && tickets.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-obsidian-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-obsidian-900 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5">{tr("Subject")}</th>
                <th className="px-4 py-2.5">{tr("From")}</th>
                <th className="px-4 py-2.5">{tr("Source")}</th>
                <th className="px-4 py-2.5">{tr("Priority")}</th>
                <th className="px-4 py-2.5">{tr("Status")}</th>
                <th className="px-4 py-2.5">{tr("Response")}</th>
                <th className="px-4 py-2.5">{tr("Assigned")}</th>
                <th className="px-4 py-2.5">{tr("Updated")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-obsidian-800">
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50 dark:hover:bg-obsidian-900">
                  <td className="px-4 py-2.5">
                    <Link href={`/tickets/${ticket.id}`} className="font-medium text-brand-700 dark:text-brand-400 hover:underline">
                      {ticket.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {ticket.customer?.fullName ?? ticket.contactName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{ticket.source.replace("_", " ")}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={priorityVariant(ticket.priority)}>{ticket.priority}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={statusVariant(ticket.status)}>{ticket.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {ticket.firstRepliedAt ? (
                      <span className="text-slate-500">{tr("Replied")}</span>
                    ) : ticket.status === "OPEN" || ticket.status === "IN_PROGRESS" ? (
                      ticket.responseOverdue ? (
                        <Badge variant="danger">{tr("Overdue")}</Badge>
                      ) : ticket.responseDueAt ? (
                        <span className="text-slate-500">by {new Date(ticket.responseDueAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      ) : null
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{ticket.assignedToUser?.email ?? "Unassigned"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">
                    {new Date(ticket.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
