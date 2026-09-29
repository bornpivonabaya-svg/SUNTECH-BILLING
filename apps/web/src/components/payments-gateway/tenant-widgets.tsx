"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Alert, Dialog, Field, Money, buttonClass, inputClass } from "./kit";
import type { Destination, TenantBalance } from "./types";

type DestinationType = Destination["type"];

const OPTIONS: { type: DestinationType; title: string; body: string; settles: string }[] = [
  { type: "MPESA_PHONE", title: "M-Pesa", body: "To a Safaricom phone number", settles: "Sent automatically" },
  { type: "BANK_ACCOUNT", title: "Bank account", body: "To any Kenyan bank account", settles: "Sent by our team, usually next working day" },
  { type: "TILL", title: "Till", body: "To a Buy Goods till number", settles: "Sent automatically" },
  { type: "PAYBILL", title: "Paybill", body: "To a paybill and account", settles: "Sent automatically" },
];

/**
 * "Where should we send your money?" — pick a destination type, then fill in only that type's
 * fields. Saving replaces the current destination immediately (the change is audited); anything
 * already on its way keeps going to the destination it was sent to.
 */
export function DestinationForm({ current, onDone }: { current: Destination | null; onDone?: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<DestinationType>(current?.type ?? "MPESA_PHONE");
  const [accountName, setAccountName] = useState(current?.accountName ?? "");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [tillNumber, setTillNumber] = useState("");
  const [paybillNumber, setPaybillNumber] = useState("");
  const [paybillAccountReference, setPaybillAccountReference] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body =
        type === "MPESA_PHONE"
          ? { type, accountName, phone }
          : type === "BANK_ACCOUNT"
            ? { type, accountName, bankName, bankBranch: bankBranch || undefined, bankAccountNumber }
            : type === "TILL"
              ? { type, accountName, tillNumber }
              : { type, accountName, paybillNumber, paybillAccountReference: paybillAccountReference || undefined };
      return apiFetch<Destination>("/api/v1/tenant-payments/destination", { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tenant-payments"] });
      onDone?.();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Where should we send your money?</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OPTIONS.map((o) => {
            const selected = o.type === type;
            return (
              <label
                key={o.type}
                className={`relative flex cursor-pointer flex-col rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-brand-500 ${
                  selected ? "border-brand-500 bg-brand-500/10 shadow-[0_0_0_1px_rgb(29,78,216)]" : "border-obsidian-800 bg-obsidian-900 hover:border-obsidian-700"
                }`}
              >
                <input type="radio" name="destination-type" value={o.type} checked={selected} onChange={() => setType(o.type)} className="sr-only" />
                <span className={`text-sm font-semibold ${o.type === "MPESA_PHONE" ? "text-emerald-200" : "text-slate-100"}`}>{o.title}</span>
                <span className="mt-0.5 text-xs text-slate-400">{o.body}</span>
                <span className="mt-2 text-[11px] text-slate-400">{o.settles}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={type === "MPESA_PHONE" ? "Name on the M-Pesa line" : "Account / business name"} htmlFor="dest-name">
          <input id="dest-name" className={inputClass} value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="organization" />
        </Field>
        {type === "MPESA_PHONE" && (
          <Field label="M-Pesa phone number" htmlFor="dest-phone" hint="e.g. 0712 345 678">
            <input id="dest-phone" inputMode="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
        )}
        {type === "BANK_ACCOUNT" && (
          <>
            <Field label="Bank" htmlFor="dest-bank">
              <input id="dest-bank" className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Equity Bank" />
            </Field>
            <Field label="Branch" htmlFor="dest-branch">
              <input id="dest-branch" className={inputClass} value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
            </Field>
            <Field label="Account number" htmlFor="dest-acc" hint="Stored encrypted. Only the last 4 digits are ever shown.">
              <input id="dest-acc" className={inputClass} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} autoComplete="off" />
            </Field>
          </>
        )}
        {type === "TILL" && (
          <Field label="Till number" htmlFor="dest-till">
            <input id="dest-till" inputMode="numeric" className={inputClass} value={tillNumber} onChange={(e) => setTillNumber(e.target.value)} />
          </Field>
        )}
        {type === "PAYBILL" && (
          <>
            <Field label="Paybill number" htmlFor="dest-paybill">
              <input id="dest-paybill" inputMode="numeric" className={inputClass} value={paybillNumber} onChange={(e) => setPaybillNumber(e.target.value)} />
            </Field>
            <Field label="Account number / reference" htmlFor="dest-paybill-acc" hint="What the paybill expects in the account field.">
              <input id="dest-paybill-acc" className={inputClass} value={paybillAccountReference} onChange={(e) => setPaybillAccountReference(e.target.value)} />
            </Field>
          </>
        )}
      </div>

      {type === "BANK_ACCOUNT" && (
        <Alert tone="blue">Bank settlements are made by the Suntech team and marked settled only once the transfer reference is recorded.</Alert>
      )}
      {save.error && <Alert title="Couldn't save this destination">{(save.error as ApiRequestError).message}</Alert>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass("primary")} disabled={save.isPending || accountName.trim().length < 2}>
          {save.isPending ? "Saving…" : current ? "Save new destination" : "Save destination"}
        </button>
        {onDone && (
          <button type="button" className={buttonClass("ghost")} onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** "Request settlement" with a confirmation that states exactly what will happen. */
export function RequestSettlementButton({
  balance,
  destination,
  minimumMinor,
}: {
  balance: TenantBalance | undefined;
  destination: Destination | null | undefined;
  minimumMinor: number | undefined;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const request = useMutation({
    mutationFn: () => apiFetch("/api/v1/tenant-payments/settlements", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tenant-payments"] });
      void qc.invalidateQueries({ queryKey: ["settlements"] });
      setOpen(false);
    },
  });

  if (!user?.permissions.includes("settlements.request")) return null;
  const amount = balance?.settleableMinor ?? 0;
  const belowMinimum = minimumMinor !== undefined && amount < minimumMinor;
  const disabledReason = !destination
    ? "Add a settlement destination first"
    : amount <= 0
      ? "No available balance"
      : belowMinimum
        ? `Minimum settlement is KES ${(minimumMinor! / 100).toLocaleString("en-KE")}`
        : null;

  return (
    <>
      <button type="button" className={buttonClass("primary")} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined} onClick={() => setOpen(true)}>
        Request settlement
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request a settlement"
        footer={
          <>
            <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary")} disabled={request.isPending} onClick={() => request.mutate()}>
              {request.isPending ? "Requesting…" : "Send my money"}
            </button>
          </>
        }
      >
        <p>
          We&apos;ll send <strong className="text-slate-100"><Money minor={amount} /></strong> to <strong className="text-slate-100">{destination?.label}</strong>.
        </p>
        {balance && balance.availableMinor !== amount && (
          <p className="text-xs text-slate-400">
            M-Pesa moves whole shillings, so <Money minor={balance.availableMinor - amount} cents /> stays in your balance for next time.
          </p>
        )}
        {request.error && <Alert>{(request.error as ApiRequestError).message}</Alert>}
      </Dialog>
    </>
  );
}
