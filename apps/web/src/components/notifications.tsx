"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { IconBell } from "@/components/icons";

export type NotificationLevel = "INFO" | "WARNING" | "CRITICAL";

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  severity: NotificationLevel;
  createdAt: string;
  readAt: string | null;
  tenantId: string | null;
}

interface Inbox {
  items: NotificationItem[];
  unreadCount: number;
}

export const LEVEL_META: Record<NotificationLevel, { label: string; dot: string; text: string }> = {
  INFO: { label: "Info", dot: "bg-brand-400", text: "text-brand-300" },
  WARNING: { label: "Warning", dot: "bg-amber-400", text: "text-amber-300" },
  CRITICAL: { label: "Critical", dot: "bg-rose-500", text: "text-rose-300" },
};

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The signed-in staff member's notifications from the Suntech team. Polled gently: these
 *  are announcements, not chat. */
export function useNotifications(enabled: boolean) {
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<Inbox>("/api/v1/announcements/inbox"),
    enabled,
    refetchInterval: 60_000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["announcements-mine"] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/announcements/${id}/dismiss`, { method: "POST" }),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => apiFetch("/api/v1/announcements/read-all", { method: "POST" }),
    onSuccess: refresh,
  });
  return { inbox, markRead, markAllRead };
}

export function NotificationRow({ item, onRead, compact = false }: { item: NotificationItem; onRead: (id: string) => void; compact?: boolean }) {
  const meta = LEVEL_META[item.severity];
  const unread = !item.readAt;
  return (
    <li className={`flex gap-3 px-4 ${compact ? "py-3" : "py-4"} ${unread ? "bg-obsidian-900" : ""}`}>
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? meta.dot : "bg-obsidian-700"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className={`text-sm ${unread ? "font-semibold text-white" : "font-medium text-slate-300"}`}>{item.title}</p>
          <span className="shrink-0 text-xs text-slate-500">{timeAgo(item.createdAt)}</span>
        </div>
        <p className={`mt-0.5 whitespace-pre-line text-sm leading-6 text-slate-400 ${compact ? "line-clamp-2" : ""}`}>{item.body}</p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          {item.severity !== "INFO" && <span className={meta.text}>{meta.label}</span>}
          {unread && (
            <button type="button" onClick={() => onRead(item.id)} className="text-slate-400 hover:text-white">
              Mark as read
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Bell in the top bar: unread count, and the latest few in a dropdown. */
export function NotificationBell() {
  const { inbox, markRead, markAllRead } = useNotifications(true);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = inbox.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-obsidian-800 hover:text-white"
      >
        <IconBell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-obsidian-800 bg-obsidian-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-obsidian-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                Mark all as read
              </button>
            )}
          </div>
          {inbox.isLoading ? (
            <p className="px-4 py-6 text-sm text-slate-400">Loading…</p>
          ) : !inbox.data?.items.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications yet.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-obsidian-800 overflow-y-auto">
              {inbox.data.items.slice(0, 8).map((item) => (
                <NotificationRow key={item.id} item={item} onRead={(id) => markRead.mutate(id)} compact />
              ))}
            </ul>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-obsidian-800 px-4 py-2.5 text-center text-sm text-brand-400 hover:bg-obsidian-900"
          >
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
