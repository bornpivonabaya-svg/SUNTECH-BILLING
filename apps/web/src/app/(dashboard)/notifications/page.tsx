"use client";

import { useState } from "react";
import { EmptyState, PageHeader, Panel, Segmented, darkButton } from "@/components/dashboard/surface";
import { NotificationRow, useNotifications } from "@/components/notifications";

export default function NotificationsPage() {
  const { inbox, markRead, markAllRead } = useNotifications(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const items = (inbox.data?.items ?? []).filter((i) => filter === "all" || !i.readAt);
  const unread = inbox.data?.unreadCount ?? 0;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Notifications"
        description="Messages from the Suntech team: maintenance, new features and anything that needs your attention."
        actions={
          unread > 0 && (
            <button type="button" className={darkButton("secondary", "sm")} onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
              Mark all as read
            </button>
          )
        }
      />

      <Panel padded={false}>
        <div className="border-b border-obsidian-800 px-5 py-3">
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: unread ? `Unread (${unread})` : "Unread" },
            ]}
          />
        </div>
        {inbox.isLoading ? (
          <p className="px-5 py-8 text-sm text-slate-400">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState title={filter === "unread" ? "You're all caught up" : "No notifications yet"}>
            {filter === "unread" ? "There's nothing new to read." : "Messages from the Suntech team will appear here."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-obsidian-800">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onRead={(id) => markRead.mutate(id)} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
