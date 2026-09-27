"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label, Badge, StatusDot } from "@/components/ui";
import { tr } from "@/lib/tr";

interface LiveChatConfig {
  isActive: boolean;
  widgetId: string | null;
  showOnHotspotPortal: boolean;
  showOnDashboard: boolean;
}

export default function LiveChatSettingsPage() {
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(false);
  const [widgetId, setWidgetId] = useState("");
  const [showOnHotspotPortal, setShowOnHotspotPortal] = useState(true);
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ["live-chat-config"],
    queryFn: () => apiFetch<LiveChatConfig>("/api/v1/settings/live-chat"),
  });

  useEffect(() => {
    if (!config) return;
    setIsActive(config.isActive);
    setWidgetId(config.widgetId ?? "");
    setShowOnHotspotPortal(config.showOnHotspotPortal);
    setShowOnDashboard(config.showOnDashboard);
  }, [config]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/settings/live-chat", {
        method: "PUT",
        body: JSON.stringify({
          isActive,
          widgetId: widgetId.trim() || null,
          showOnHotspotPortal,
          showOnDashboard,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["live-chat-config"] }),
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to save configuration"),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {tr("Live chat")}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tr("Embed a Tawk.to chat widget for staff and/or hotspot customers.")}
          </p>
        </div>
        {config && (
          <Badge variant={config.isActive && config.widgetId ? "success" : "neutral"}>
            <StatusDot status={config.isActive && config.widgetId ? "ONLINE" : "UNKNOWN"} />
            <span>{config.isActive && config.widgetId ? "Active" : "Disabled"}</span>
          </Badge>
        )}
      </div>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-900 dark:text-white">{tr("Tawk.to widget ID")}</h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          From your Tawk.to dashboard → Administration → Chat Widget → the embed code has a line like{" "}
          <span className="break-all font-mono">src=&apos;https://embed.tawk.to/&lt;PROPERTY_ID&gt;/&lt;WIDGET_ID&gt;&apos;</span> —
          paste just the <span className="font-mono">PROPERTY_ID/WIDGET_ID</span> part below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="widgetId">{tr("Widget ID")}</Label>
            <Input
              id="widgetId"
              placeholder="60f1a2b3c4d5e6f7a8b9c0d1/1abcdefgh"
              value={widgetId}
              onChange={(e) => setWidgetId(e.target.value)}
            />
            <HintText>{tr("Not a secret — this is meant to be visible in the page, same as on any website.")}</HintText>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {tr("Enabled")}
          </label>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-obsidian-800 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{tr("Where it shows")}</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showOnHotspotPortal}
                onChange={(e) => setShowOnHotspotPortal(e.target.checked)}
              />
              {tr("Hotspot captive portal (customer-facing)")}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showOnDashboard}
                onChange={(e) => setShowOnDashboard(e.target.checked)}
              />
              {tr("Staff dashboard")}
            </label>
          </div>

          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </Card>
    </div>
  );
}
