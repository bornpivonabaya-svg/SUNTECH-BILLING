"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  Alert,
  Dialog,
  EnvironmentBadge,
  Field,
  Money,
  PLATFORM_TABS,
  Panel,
  PaymentsWorkspace,
  StatusBadge,
  TableShell,
  buttonClass,
  inputClass,
  td,
  th,
} from "@/components/payments-gateway/kit";
import { usePlatformGateway, usePlatformTenants } from "@/components/payments-gateway/use-platform";
import type { PlatformTenantRow } from "@/components/payments-gateway/types";

/** Write-only secret input: shows whether a value is stored, never the value. */
const CREDENTIAL_HINT =
  "Not the password: generate it on the Daraja portal from the API operator's password with the Production certificate (a long string of about 344 characters).";

function SecretField({ id, label, saved, value, onChange, hint }: { id: string; label: string; saved: boolean; value: string; onChange: (v: string) => void; hint?: string }) {
  // Browsers' password managers fill any password-type input they see, which put a saved login
  // into these boxes. They never fill a read-only field, so it only becomes editable on focus.
  const [editable, setEditable] = useState(false);
  return (
    <Field label={label} htmlFor={id} hint={saved ? `Saved — leave blank to keep the current value.${hint ? ` ${hint}` : ""}` : hint}>
      <input
        id={id}
        name={`secret-${id}`}
        type="password"
        autoComplete="new-password"
        data-lpignore="true"
        data-1p-ignore=""
        data-bwignore=""
        readOnly={!editable}
        onFocus={() => setEditable(true)}
        className={inputClass}
        placeholder={saved ? "•••••••• (saved)" : "Not set"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

type SectionKey = "collection" | "b2b" | "b2c";
type SectionState = { pending: boolean; saved: boolean; error: string | null };

/** One section's own save button and outcome, so a problem in one section never blocks another. */
function SectionActions({ state, onClear }: { state: SectionState; onClear: () => void }) {
  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass("primary")} disabled={state.pending}>
          {state.pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onClear} disabled={state.pending}>
          Clear
        </button>
        {state.saved && !state.pending && <span className="text-sm text-emerald-300">Saved. Secrets were encrypted and cleared from this form.</span>}
      </div>
      {state.error && <Alert title="Couldn't save">{state.error}</Alert>}
    </div>
  );
}

const SECRETS = {
  collection: ["consumerKey", "consumerSecret", "passkey"],
  b2b: ["initiatorCredential"],
  b2c: ["b2cInitiatorCredential"],
} as const;

export default function PlatformGatewayPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const gateway = usePlatformGateway();
  const tenants = usePlatformTenants();
  const canManage = Boolean(user?.permissions.includes("platform_payments.manage"));
  const g = gateway.data;

  const [form, setForm] = useState({
    shortcode: "",
    environment: "sandbox",
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    initiatorName: "",
    initiatorCredential: "",
    b2cShortcode: "",
    b2cInitiatorName: "",
    b2cInitiatorCredential: "",
  });
  const [toggle, setToggle] = useState<null | boolean>(null);
  const [modeChange, setModeChange] = useState<PlatformTenantRow | null>(null);

  useEffect(() => {
    if (!g) return;
    setForm((f) => ({
      ...f,
      shortcode: g.collection.shortcode ?? "",
      environment: g.collection.environment === "production" ? "production" : "sandbox",
      initiatorName: g.b2b.initiatorName ?? "",
      b2cShortcode: g.b2c.shortcode ?? "",
      b2cInitiatorName: g.b2c.initiatorName ?? "",
    }));
  }, [g]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/api/v1/platform/payments/gateway", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["platform-payments"] });
    },
  });

  const setMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "OWN" | "PLATFORM" }) =>
      apiFetch(`/api/v1/platform/payments/tenants/${id}/collection-mode`, { method: "PUT", body: JSON.stringify({ collectionMode: mode }) }),
    onSuccess: () => {
      setModeChange(null);
      void qc.invalidateQueries({ queryKey: ["platform-payments"] });
    },
  });

  const idle: SectionState = { pending: false, saved: false, error: null };
  const [sections, setSections] = useState<Record<SectionKey, SectionState>>({ collection: idle, b2b: idle, b2c: idle });

  /** Sends ONLY this section's fields — a stray value in another section is never submitted. */
  const saveSection = (key: SectionKey, fields: Record<string, unknown>) => async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { ...fields };
    for (const k of SECRETS[key]) if (form[k].trim()) body[k] = form[k].trim();
    setSections((prev) => ({ ...prev, [key]: { pending: true, saved: false, error: null } }));
    try {
      await apiFetch("/api/v1/platform/payments/gateway", { method: "PUT", body: JSON.stringify(body) });
      setForm((f) => ({ ...f, ...Object.fromEntries(SECRETS[key].map((k) => [k, ""])) }));
      setSections((prev) => ({ ...prev, [key]: { pending: false, saved: true, error: null } }));
      void qc.invalidateQueries({ queryKey: ["platform-payments"] });
    } catch (err) {
      setSections((prev) => ({ ...prev, [key]: { pending: false, saved: false, error: (err as ApiRequestError).message } }));
    }
  };
  const clearSecrets = (key: SectionKey) => () => setForm((f) => ({ ...f, ...Object.fromEntries(SECRETS[key].map((k) => [k, ""])) }));

  return (
    <PaymentsWorkspace
      tabs={PLATFORM_TABS}
      title="Payment Gateway"
      description="The Suntech paybill that collects for ISPs without a gateway of their own, and the credentials that pay them out. Secrets are stored encrypted and are never shown again after saving."
    >
      {gateway.error && <Alert title="Couldn't load the gateway">{(gateway.error as Error).message}</Alert>}

      <Panel title="Gateway status">
        {!g ? (
          <div className="h-16 animate-pulse rounded-md bg-obsidian-800" />
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {g.gatewayEnabled ? <StatusBadge status="SETTLED" label="Active" /> : <StatusBadge status="CANCELLED" label="Disabled" />}
                <EnvironmentBadge environment={g.collection.environment === "production" ? "PRODUCTION" : "SANDBOX"} />
              </div>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                {g.gatewayEnabled
                  ? "ISPs connected to the gateway can take payments through the Suntech paybill."
                  : "New platform collections are refused. Payments already made are still recorded and settled."}
              </p>
            </div>
            {canManage && (
              <button type="button" className={buttonClass(g.gatewayEnabled ? "secondary" : "primary")} onClick={() => setToggle(!g.gatewayEnabled)}>
                {g.gatewayEnabled ? "Disable gateway" : "Enable gateway"}
              </button>
            )}
          </div>
        )}
        {g && (
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Check ok={g.collection.configured} label="Collection credentials" />
            <Check ok={g.b2b.configured} label="B2B payouts (till / paybill)" />
            <Check ok={g.b2c.configured} label="B2C payouts (M-Pesa phone)" />
            <Check ok={g.callbackTokenConfigured} label="Callback token set" />
          </ul>
        )}
        {g?.sandboxSettlements && (
          <div className="mt-4">
            <Alert tone="amber" title="Sandbox settlements are on">
              PAYMENTS_SANDBOX_SETTLEMENTS=true — settlements are simulated, not sent to M-Pesa. This cannot be enabled in production.
            </Alert>
          </div>
        )}
      </Panel>

      <Panel title="Collection" description="Provider: M-Pesa (Safaricom Daraja). Used for STK push and the platform paybill.">
        <form onSubmit={saveSection("collection", { shortcode: form.shortcode || undefined, environment: form.environment })} autoComplete="off" noValidate>
          <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
            <Field label="Paybill / business shortcode" htmlFor="gw-shortcode">
              <input id="gw-shortcode" inputMode="numeric" autoComplete="off" className={inputClass} value={form.shortcode} onChange={(e) => set("shortcode")(e.target.value)} />
            </Field>
            <Field label="Environment" htmlFor="gw-env" hint="Production moves real money.">
              <select id="gw-env" className={inputClass} value={form.environment} onChange={(e) => set("environment")(e.target.value)}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </Field>
            <SecretField id="gw-ck" label="Consumer key" saved={Boolean(g?.collection.configured)} value={form.consumerKey} onChange={set("consumerKey")} />
            <SecretField id="gw-cs" label="Consumer secret" saved={Boolean(g?.collection.configured)} value={form.consumerSecret} onChange={set("consumerSecret")} />
            <SecretField id="gw-pk" label="Passkey (Lipa na M-Pesa Online)" saved={Boolean(g?.collection.configured)} value={form.passkey} onChange={set("passkey")} />
          </fieldset>
          {canManage && <SectionActions state={sections.collection} onClear={clearSecrets("collection")} />}
        </form>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="B2C payouts — to an M-Pesa phone" description="Used to settle ISPs whose destination is an M-Pesa number.">
          <form onSubmit={saveSection("b2c", { b2cShortcode: form.b2cShortcode, b2cInitiatorName: form.b2cInitiatorName })} autoComplete="off" noValidate>
            <fieldset disabled={!canManage} className="space-y-4">
              <Field label="B2C shortcode" htmlFor="gw-b2c-sc">
                <input id="gw-b2c-sc" inputMode="numeric" autoComplete="off" className={inputClass} value={form.b2cShortcode} onChange={(e) => set("b2cShortcode")(e.target.value)} />
              </Field>
              <Field label="Initiator name" htmlFor="gw-b2c-init" hint="The API operator's username in the M-Pesa business portal.">
                <input id="gw-b2c-init" autoComplete="off" className={inputClass} value={form.b2cInitiatorName} onChange={(e) => set("b2cInitiatorName")(e.target.value)} />
              </Field>
              <SecretField
                id="gw-b2c-cred"
                label="Security credential"
                saved={Boolean(g?.b2c.configured)}
                value={form.b2cInitiatorCredential}
                onChange={set("b2cInitiatorCredential")}
                hint={CREDENTIAL_HINT}
              />
            </fieldset>
            {canManage && <SectionActions state={sections.b2c} onClear={clearSecrets("b2c")} />}
          </form>
        </Panel>

        <Panel title="B2B payouts — to a till or paybill" description="Only needed if ISPs settle to a till or paybill. Safaricom approves B2B separately from B2C.">
          <form onSubmit={saveSection("b2b", { initiatorName: form.initiatorName })} autoComplete="off" noValidate>
            <fieldset disabled={!canManage} className="space-y-4">
              <Field label="Initiator name" htmlFor="gw-b2b-init">
                <input id="gw-b2b-init" autoComplete="off" className={inputClass} value={form.initiatorName} onChange={(e) => set("initiatorName")(e.target.value)} />
              </Field>
              <SecretField
                id="gw-b2b-cred"
                label="Security credential"
                saved={Boolean(g?.b2b.configured)}
                value={form.initiatorCredential}
                onChange={set("initiatorCredential")}
                hint={CREDENTIAL_HINT}
              />
            </fieldset>
            {canManage && <SectionActions state={sections.b2b} onClear={clearSecrets("b2b")} />}
          </form>
        </Panel>
      </div>

      {g && (
        <Panel title="Callback URLs" description="Register these with Safaricom. The token is masked here; use the MPESA_CALLBACK_TOKEN value configured on the server.">
          <dl className="space-y-3 text-sm">
            {[
              ["STK push callback", g.callbackUrls.stk],
              ["Paybill validation (C2B)", g.callbackUrls.c2bValidation],
              ["Paybill confirmation (C2B)", g.callbackUrls.c2bConfirmation],
              ["Settlement result (B2B / B2C)", g.callbackUrls.settlementResult],
              ["Settlement queue timeout", g.callbackUrls.settlementTimeout],
            ].map(([label, url]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[220px_1fr]">
                <dt className="text-slate-400">{label}</dt>
                <dd className="break-all font-mono text-xs text-slate-200">{url}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      <Panel title="ISPs on the gateway" description="Connecting an ISP routes its customers' M-Pesa payments through the Suntech paybill." padded={false}>
        <TableShell minWidth={680}>
          <thead>
            <tr>
              <th className={th}>ISP</th>
              <th className={th}>Collection</th>
              <th className={th}>Destination</th>
              <th className={`${th} text-right`}>Balance</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.data?.map((t) => (
              <tr key={t.id}>
                <td className={`${td} font-medium text-slate-100`}>{t.name}</td>
                <td className={td}>{t.collectionMode === "PLATFORM" ? <StatusBadge status="SETTLED" label="Suntech gateway" /> : <StatusBadge status="CANCELLED" label="Own paybill" />}</td>
                <td className={td}>{t.destination?.label ?? <span className="text-slate-500">—</span>}</td>
                <td className={`${td} text-right`}>
                  <Money minor={t.balance.availableMinor} />
                </td>
                <td className={`${td} text-right`}>
                  {canManage && (
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModeChange(t)}>
                      {t.collectionMode === "PLATFORM" ? "Disconnect" : "Connect"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>

      {toggle !== null && (
        <Dialog
          open
          onClose={() => setToggle(null)}
          title={toggle ? "Enable the gateway?" : "Disable the gateway?"}
          footer={
            <>
              <button type="button" className={buttonClass("ghost")} onClick={() => setToggle(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass(toggle ? "primary" : "danger")}
                disabled={save.isPending}
                onClick={() => save.mutateAsync({ gatewayEnabled: toggle }).then(() => setToggle(null))}
              >
                {toggle ? "Enable" : "Disable"}
              </button>
            </>
          }
        >
          <p>
            {toggle
              ? "Connected ISPs can take payments through the Suntech paybill again."
              : "Customers of connected ISPs will be told online payment is unavailable until you enable it again. Payments already in flight are still recorded."}
          </p>
        </Dialog>
      )}
      {modeChange && (
        <Dialog
          open
          onClose={() => setModeChange(null)}
          title={modeChange.collectionMode === "PLATFORM" ? `Disconnect ${modeChange.name}?` : `Connect ${modeChange.name}?`}
          footer={
            <>
              <button type="button" className={buttonClass("ghost")} onClick={() => setModeChange(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass("primary")}
                disabled={setMode.isPending}
                onClick={() => setMode.mutate({ id: modeChange.id, mode: modeChange.collectionMode === "PLATFORM" ? "OWN" : "PLATFORM" })}
              >
                Confirm
              </button>
            </>
          }
        >
          <p>
            {modeChange.collectionMode === "PLATFORM"
              ? "New payments will go to the ISP's own M-Pesa account. Anything the platform already holds for them stays on their balance and is still settled."
              : "New M-Pesa payments for this ISP will be collected by the Suntech paybill and credited to their balance, less the platform fee."}
          </p>
          {setMode.error && <Alert>{(setMode.error as ApiRequestError).message}</Alert>}
        </Dialog>
      )}
    </PaymentsWorkspace>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${ok ? "bg-emerald-500/15 text-emerald-200" : "bg-obsidian-800 text-slate-400"}`}>
        {ok ? "✓" : "–"}
      </span>
      <span className={ok ? "text-slate-200" : "text-slate-400"}>
        {label}
        <span className="sr-only">{ok ? ": configured" : ": not configured"}</span>
      </span>
    </li>
  );
}
