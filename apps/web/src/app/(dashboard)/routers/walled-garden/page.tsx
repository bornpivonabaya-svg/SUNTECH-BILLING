"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { tr } from "@/lib/tr";
import { useAuth } from "@/lib/auth-context";
import { Notice, PageHeader, Panel, darkButton } from "@/components/dashboard/surface";

/**
 * The ISP's walled garden: sites its hotspot customers can open before they pay, such as the
 * ISP's own website or a payment page. The platform's list (M-Pesa, the portal, what the super
 * admin added) always applies too and is shown for reference.
 */

export default function WalledGardenPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.permissions.includes("routers.manage") ?? false;
  const { data } = useQuery({ queryKey: ["walled-garden"], queryFn: () => apiFetch<{ hosts: string[]; platformHosts: string[] }>("/api/v1/walled-garden") });
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  useEffect(() => {
    if (data && text === null) setText(data.hosts.join("\n"));
  }, [data, text]);

  const save = useMutation({
    mutationFn: () => apiFetch<{ hosts: string[] }>("/api/v1/walled-garden", { method: "PUT", body: JSON.stringify({ hosts: (text ?? "").split(/[\s,]+/).filter(Boolean) }) }),
    onSuccess: (r) => {
      setText(r.hosts.join("\n"));
      setNotice({ tone: "good", text: tr("Saved. Online routers pick this up within a few minutes; new routers get it in their setup script.") });
      void qc.invalidateQueries({ queryKey: ["walled-garden"] });
    },
    onError: (err) => setNotice({ tone: "bad", text: err instanceof ApiRequestError ? err.message : tr("Something went wrong.") }),
  });

  return (
    <div className="w-full min-w-0 max-w-4xl space-y-6">
      <PageHeader
        title={tr("Walled garden")}
        description={tr("Sites your hotspot customers can open before they pay: your website, a payment or support page. Everything else stays behind the login page.")}
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Panel title={tr("Your sites")} description={tr("One per line: a host (pay.example.co.ke), a wildcard under your own domain (*.example.co.ke), or one IP address. Never a whole domain like *.com: that would give away free internet.")}>
        <div className="space-y-3">
          <textarea
            aria-label={tr("Your sites")}
            rows={8}
            disabled={!canManage || text === null}
            className="w-full rounded-lg border border-obsidian-700 bg-obsidian-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-brand-500"
            placeholder={"www.example.co.ke\n*.example.co.ke"}
            value={text ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
          {canManage && (
            <button type="button" className={darkButton("primary")} disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? tr("Saving…") : tr("Save")}
            </button>
          )}
        </div>
      </Panel>

      <Panel title={tr("Always allowed")} description={tr("The login page, payments (M-Pesa, cards) and the sites the platform allows for every ISP.")}>
        {data?.platformHosts.length ? (
          <ul className="grid gap-1 font-mono text-sm text-slate-300 sm:grid-cols-2">
            {data.platformHosts.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">{tr("Only the built-in login and payment sites.")}</p>
        )}
      </Panel>
    </div>
  );
}
