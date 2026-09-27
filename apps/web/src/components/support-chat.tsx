"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useLanguage } from "@/lib/language-context";
import { Notice, Panel, darkButton } from "@/components/dashboard/surface";

/**
 * The customer's chat with the support assistant, in the app's Help tab. It answers from their
 * own account in English or Swahili and hands over to the ISP's staff (as a ticket, with the
 * conversation) when it can't help or they ask for a person. Renders nothing when the ISP hasn't
 * set the assistant up, so the ticket form below it is all the customer sees.
 */

interface ChatState {
  enabled: boolean;
  status: "OPEN" | "HANDED_OVER" | "CLOSED" | null;
  ticketRef: string | null;
  messages: { id: string; role: string; content: string; createdAt: string }[];
}

const S = {
  en: {
    title: "Ask us anything",
    lead: "Our assistant can check your plan, bills and payments, and explain what's going on. It passes you to a person whenever you need one.",
    placeholder: "Type your question… (English or Kiswahili)",
    send: "Send",
    thinking: "Checking…",
    human: "Talk to a person",
    fresh: "New chat",
    handedOver: (ref: string | null) => `A person from the team has your conversation${ref ? ` (ticket ${ref})` : ""}. They'll reply here and under Support tickets; anything you add goes to them.`,
    you: "You",
    assistant: "Assistant",
    staff: "Team",
    hello: "Hi! Ask about your internet, a bill, or a payment.",
    error: "Couldn't send that. Please try again.",
  },
  sw: {
    title: "Tuulize chochote",
    lead: "Msaidizi wetu anaweza kuangalia mpango wako, bili na malipo, na kueleza kinachoendelea. Anakuunganisha na mtu wakati wowote unapohitaji.",
    placeholder: "Andika swali lako… (Kiswahili au Kiingereza)",
    send: "Tuma",
    thinking: "Inaangalia…",
    human: "Ongea na mtu",
    fresh: "Mazungumzo mapya",
    handedOver: (ref: string | null) => `Mtu wa timu ana mazungumzo yako${ref ? ` (tiketi ${ref})` : ""}. Watajibu hapa na chini ya Tiketi za msaada; chochote unachoongeza kinaenda kwao.`,
    you: "Wewe",
    assistant: "Msaidizi",
    staff: "Timu",
    hello: "Habari! Uliza kuhusu intaneti yako, bili, au malipo.",
    error: "Imeshindikana kutuma. Tafadhali jaribu tena.",
  },
};

export function SupportChat() {
  const { lang } = useLanguage();
  const t = S[lang];
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["support-chat"], queryFn: () => apiFetch<ChatState>("/api/v1/me/support-chat"), refetchInterval: (q) => (q.state.data?.status === "HANDED_OVER" ? 30_000 : false) });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["support-chat"] });

  const send = useMutation({
    mutationFn: (message: string) => apiFetch("/api/v1/me/support-chat", { method: "POST", body: JSON.stringify({ message }) }),
    onSuccess: () => {
      setPending(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ["me-tickets"] });
    },
    onError: (err) => {
      setPending(null);
      setError(err instanceof ApiRequestError ? err.message : t.error);
    },
  });
  const human = useMutation({
    mutationFn: () => apiFetch("/api/v1/me/support-chat/human", { method: "POST", body: "{}" }),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ["me-tickets"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : t.error),
  });
  const fresh = useMutation({ mutationFn: () => apiFetch("/api/v1/me/support-chat/new", { method: "POST", body: "{}" }), onSuccess: refresh });

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length, pending]);

  if (!data?.enabled) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || send.isPending) return;
    setError(null);
    setText("");
    setPending(message);
    send.mutate(message);
  }

  const bubble = (role: string) =>
    role === "user" ? "ml-auto bg-brand-600 text-white" : role === "staff" ? "bg-emerald-900/60 text-emerald-50" : "bg-obsidian-800 text-slate-100";
  const who = (role: string) => (role === "user" ? t.you : role === "staff" ? t.staff : t.assistant);

  return (
    <Panel
      title={t.title}
      description={t.lead}
      actions={
        <div className="flex gap-2">
          {data.status !== "HANDED_OVER" && (
            <button type="button" className={darkButton("secondary", "sm")} disabled={human.isPending} onClick={() => human.mutate()}>
              {t.human}
            </button>
          )}
          {data.messages.length > 0 && (
            <button type="button" className={darkButton("ghost", "sm")} disabled={fresh.isPending} onClick={() => fresh.mutate()}>
              {t.fresh}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {data.messages.length === 0 && !pending && <p className="w-fit max-w-[85%] rounded-2xl bg-obsidian-800 px-3 py-2 text-sm text-slate-100">{t.hello}</p>}
          {data.messages.map((m) => (
            <div key={m.id} className={`w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${bubble(m.role)}`}>
              <span className="sr-only">{who(m.role)}: </span>
              {m.content}
            </div>
          ))}
          {pending && (
            <>
              <div className={`w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${bubble("user")}`}>{pending}</div>
              {data.status !== "HANDED_OVER" && <p className="text-xs text-slate-400">{t.thinking}</p>}
            </>
          )}
          <div ref={end} />
        </div>
        {data.status === "HANDED_OVER" && <Notice tone="neutral">{t.handedOver(data.ticketRef)}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        <form onSubmit={submit} className="flex gap-2">
          <input
            aria-label={t.placeholder}
            className="min-w-0 flex-1 rounded-lg border border-obsidian-700 bg-obsidian-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500"
            placeholder={t.placeholder}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className={darkButton("primary")} disabled={send.isPending || !text.trim()}>
            {send.isPending ? t.thinking : t.send}
          </button>
        </form>
      </div>
    </Panel>
  );
}
