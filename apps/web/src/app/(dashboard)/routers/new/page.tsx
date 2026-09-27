"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { tr } from "@/lib/tr";
import { Button, Card, ErrorText, HintText, Input, Label } from "@/components/ui";
import { CodeBlock, Notice, PageHeader, Pill } from "@/components/dashboard/surface";
import { IconCheck, IconChevronRight, IconRouter } from "@/components/icons";

type Step = 1 | 2 | 3;

interface RouterRecord {
  id: string;
  name: string;
  host: string | null;
  status: "UNKNOWN" | "ONLINE" | "WARNING" | "DOWN";
  lastError: string | null;
}

// One script does the whole job -- API user, RADIUS, hotspot server, walled garden and portal
// page all come from the single provisioning script in step 2 (buildMikrotikProvisioningScript).
// There is deliberately no separate "RADIUS" step: it used to ask for a FreeRADIUS host and hand
// out a clients.conf snippet, neither of which this platform uses -- RADIUS is the worker's own
// embedded server and the NAS row registers itself from the router's heartbeat.
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Provision" },
  { n: 3, label: "Done" },
];

function StepDots({ current }: { current: Step }) {
  return (
    <div className="mb-8 flex items-center">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                s.n < current
                  ? "border-brand-600 bg-brand-600 text-white"
                  : s.n === current
                  ? "border-brand-600 text-brand-600 dark:text-brand-400"
                  : "border-slate-300 text-slate-400 dark:border-obsidian-700"
              }`}
            >
              {s.n < current ? <IconCheck size={14} /> : s.n}
            </div>
            <span
              className={`text-xs font-medium ${
                s.n <= current ? "text-slate-900 dark:text-white" : "text-slate-400"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`mx-3 mb-5 h-0.5 w-16 ${s.n < current ? "bg-brand-600" : "bg-slate-200 dark:bg-obsidian-800"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function LinkRouterWizardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [routerOsMajor, setRouterOsMajor] = useState<6 | 7 | null>(null);
  const [created, setCreated] = useState<RouterRecord | null>(null);
  const [provisionToken, setProvisionToken] = useState<string | null>(null);
  const [provisioningScript, setProvisioningScript] = useState<string | null>(null);
  const [waitingForCallback, setWaitingForCallback] = useState(true);
  const [showManualFallback, setShowManualFallback] = useState(false);

  // Manual-entry fallback fields — only used if the router can't reach this platform to call
  // home (e.g. no outbound internet, or a private test router with no public/forwarded address).
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8728");
  const [manualUseTls, setManualUseTls] = useState(false);
  const [manualUsername, setManualUsername] = useState("");
  const [manualPassword, setManualPassword] = useState("");

  // Port selection state — click to select, no typing needed!
  const [hotspotPorts, setHotspotPorts] = useState<string[]>(["ether2", "ether3"]);
  const [lanPort, setLanPort] = useState<string>("ether4");

  const [pppoeEnabled, setPppoeEnabled] = useState(false);
  const [pppoeInterface, setPppoeInterface] = useState("ether5");
  const [pppoeGatewayIp, setPppoeGatewayIp] = useState("10.10.0.1");
  const [pppoePoolRange, setPppoePoolRange] = useState("10.10.0.2-10.10.255.254");
  const [blockTethering, setBlockTethering] = useState(false);
  const [oneLiner, setOneLiner] = useState<string>("");

  const toggleHotspotPort = (port: string) => {
    setHotspotPorts((prev) => {
      const exists = prev.includes(port);
      if (exists) {
        return prev.filter((p) => p !== port);
      } else {
        if (lanPort === port) setLanPort("none");
        if (pppoeInterface === port) setPppoeInterface("");
        return [...prev, port];
      }
    });
  };

  const selectLanPort = (port: string) => {
    setLanPort(port);
    if (port !== "none") {
      setHotspotPorts((prev) => prev.filter((p) => p !== port));
      if (pppoeInterface === port) setPppoeInterface("");
    }
  };

  const selectPppoePort = (port: string) => {
    setPppoeInterface(port);
    if (port) {
      setHotspotPorts((prev) => prev.filter((p) => p !== port));
      if (lanPort === port) setLanPort("none");
    }
  };

  const createPending = useMutation({
    mutationFn: () =>
      apiFetch<RouterRecord & { provisionToken: string }>("/api/v1/routers/pending", {
        method: "POST",
        body: JSON.stringify({
          name,
          routerOsMajor,
          hotspotPorts,
          lanPort: lanPort && lanPort !== "none" ? lanPort : null,
          ...(pppoeEnabled && pppoeInterface.trim()
            ? {
                pppoeInterface: pppoeInterface.trim(),
                pppoeGatewayIp: pppoeGatewayIp.trim(),
                pppoePoolRange: pppoePoolRange.trim(),
              }
            : {}),
          blockTethering,
        }),
      }),
    onSuccess: (result) => {
      const { provisionToken: token, ...routerRecord } = result;
      setCreated(routerRecord);
      setProvisionToken(token);
      setStep(2);
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to register router"),
  });

  const loadProvisioningScript = useMutation({
    mutationFn: () =>
      apiFetch<{ script: string; fetchCommand?: string; oneLiner?: string }>(
        `/api/v1/routers/${created!.id}/provisioning-script?provisionToken=${encodeURIComponent(provisionToken!)}`
      ),
    onSuccess: (result) => {
      setProvisioningScript(result.script);
      // Only ever the API's command: it carries this deployment's public URL. A hard-coded host here
      // would send the router to the wrong server on any other deployment.
      setOneLiner(result.oneLiner || result.fetchCommand || "");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to generate provisioning script"),
  });

  useEffect(() => {
    if (step === 2 && created && provisionToken && !provisioningScript) {
      loadProvisioningScript.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, created?.id]);

  const checkLinked = useMutation({
    mutationFn: () => apiFetch<RouterRecord>(`/api/v1/routers/${created!.id}`),
    onSuccess: async (result) => {
      if (result.host) {
        // Host just appeared — the router's callback landed. Kick a real connectivity check so
        // the status badge reflects reality immediately instead of waiting for the next
        // background poll (apps/worker's poll-router-health runs on a 60s cadence).
        await apiFetch(`/api/v1/routers/${result.id}/test-connection`, { method: "POST" }).catch(() => {});
        const fresh = await apiFetch<RouterRecord>(`/api/v1/routers/${result.id}`);
        setCreated(fresh);
        setWaitingForCallback(false);
        queryClient.invalidateQueries({ queryKey: ["routers"] });
      } else {
        setCreated(result);
      }
    },
  });

  // Poll for the router's callback rather than a fixed connectivity check — until `host` is
  // populated there's nothing to dial yet (see completeRouterProvisioning in @mashupkgrid/network).
  useEffect(() => {
    if (step !== 2 || !created || created.host) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await checkLinked.mutateAsync().catch(() => {});
      if (!cancelled && waitingForCallback) setTimeout(poll, 3000);
    };
    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, created?.id, waitingForCallback]);

  const linkManually = useMutation({
    mutationFn: () =>
      apiFetch<RouterRecord>(`/api/v1/routers/${created!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          host: manualHost,
          apiPort: Number(manualPort),
          useTls: manualUseTls,
          username: manualUsername,
          password: manualPassword,
        }),
      }),
    onSuccess: (result) => {
      setCreated(result);
      setWaitingForCallback(false);
      queryClient.invalidateQueries({ queryKey: ["routers"] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to link router manually"),
  });

  const statusPill = created ? (
    <Pill tone={created.status === "ONLINE" ? "good" : created.status === "DOWN" ? "bad" : created.status === "WARNING" ? "warn" : "neutral"}>
      {created.status === "ONLINE" ? "Online" : created.status === "DOWN" ? "Offline" : created.status === "WARNING" ? "Degraded" : "Not checked yet"}
    </Pill>
  ) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/routers" className="text-sm text-slate-400 hover:text-white">
          ← Routers
        </Link>
        <div className="mt-2">
          <PageHeader title="Link a MikroTik" description="Name it and paste one command into the router. It links itself, with no IP, port or password to type." />
        </div>
      </div>

      <StepDots current={step} />

      {step === 1 && (
        <Card>
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900 dark:text-white">Router details</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              createPending.mutate();
            }}
          >
            <Label htmlFor="name">Router name</Label>
            <Input
              id="name"
              placeholder="e.g. Core-CCR2004-Nairobi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <HintText>How this router is shown across the dashboard.</HintText>
            <div className="mt-4">
              <Label>{tr("RouterOS version")}</Label>
              <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={tr("RouterOS version")}>
                {([
                  { v: null, label: tr("Not sure (detect)") },
                  { v: 6, label: "RouterOS v6" },
                  { v: 7, label: "RouterOS v7" },
                ] as const).map((o) => (
                  <button
                    key={String(o.v)}
                    type="button"
                    role="radio"
                    aria-checked={routerOsMajor === o.v}
                    onClick={() => setRouterOsMajor(o.v)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      routerOsMajor === o.v
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-obsidian-700 dark:bg-obsidian-950 dark:text-slate-200"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <HintText>
                {tr("In WinBox: System > Resources > Version. v6 routers get no WireGuard remote access; v7 gets it and the newer Wi-Fi settings. If the router runs a different version, the script says so on screen and in the router's log.")}
              </HintText>
            </div>
            {/* Interactive Port Selection */}
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-obsidian-800 dark:bg-obsidian-900/50">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-400">
                  <IconRouter size={14} />
                </span>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Port & Interface Roles (Click to Select)
                </h3>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Easily designate port roles by clicking — no command line typing required.
              </p>

              {/* Visual Router Port Status Bar */}
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white p-2.5 dark:border-obsidian-800 dark:bg-obsidian-950">
                <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                  ether1 (WAN Uplink)
                </span>
                {["ether2", "ether3", "ether4", "ether5", "sfp1", "wlan1"].map((p) => {
                  const isHotspot = hotspotPorts.includes(p);
                  const isLan = lanPort === p;
                  const isPpp = pppoeEnabled && pppoeInterface === p;
                  return (
                    <span
                      key={p}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-all ${
                        isHotspot
                          ? "bg-blue-600 text-white shadow-xs"
                          : isLan
                          ? "bg-emerald-600 text-white shadow-xs"
                          : isPpp
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-slate-100 text-slate-500 dark:bg-obsidian-800 dark:text-slate-400"
                      }`}
                    >
                      {p}
                      {isHotspot ? " (Hotspot)" : isLan ? " (Direct LAN)" : isPpp ? " (PPPoE)" : ""}
                    </span>
                  );
                })}
              </div>

              {/* 1. Hotspot Ports Selection */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <Label className="mb-0 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Hotspot Ports (Captive Portal & Wi-Fi APs)
                  </Label>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                    Click to toggle ports
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Only devices plugged into these ports will see the voucher login portal.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["ether2", "ether3", "ether4", "ether5", "sfp1", "wlan1"].map((p) => {
                    const selected = hotspotPorts.includes(p);
                    const disabled = lanPort === p || (pppoeEnabled && pppoeInterface === p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleHotspotPort(p)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          selected
                            ? "border-blue-600 bg-blue-50 text-blue-700 shadow-xs dark:border-blue-500 dark:bg-blue-950/70 dark:text-blue-300 font-semibold ring-1 ring-blue-500"
                            : disabled
                            ? "border-slate-200 bg-slate-100 text-slate-400 opacity-50 dark:border-obsidian-800 dark:bg-obsidian-800 cursor-not-allowed"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-300"
                        }`}
                      >
                        {selected ? <IconCheck size={13} className="text-blue-600 dark:text-blue-400" /> : null}
                        {p}
                        {p === "wlan1" ? " (Built-in Wi-Fi)" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Direct LAN / Non-Hotspot Port Selection */}
              <div className="mt-4 pt-3.5 border-t border-slate-200/80 dark:border-obsidian-800">
                <div className="flex items-center justify-between">
                  <Label className="mb-0 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Direct LAN Port (No Hotspot / No Voucher)
                  </Label>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    Bypasses captive portal
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Dedicated port for Office PC, CCTV cameras, or technician laptop (Subnet 192.168.99.1/24 with direct internet).
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[
                    { id: "none", label: "None (All on Hotspot)" },
                    { id: "ether4", label: "ether4 (Recommended)" },
                    { id: "ether5", label: "ether5" },
                    { id: "ether3", label: "ether3" },
                    { id: "ether2", label: "ether2" },
                    { id: "sfp1", label: "sfp1" },
                  ].map((item) => {
                    const isSelected = lanPort === item.id || (!lanPort && item.id === "none");
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectLanPort(item.id)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-50 text-emerald-800 shadow-xs dark:border-emerald-500 dark:bg-emerald-950/70 dark:text-emerald-300 font-semibold ring-1 ring-emerald-500"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-300"
                        }`}
                      >
                        {isSelected && item.id !== "none" ? <IconCheck size={13} className="text-emerald-600 dark:text-emerald-400" /> : null}
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-obsidian-800">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={blockTethering}
                  onChange={(e) => setBlockTethering(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-obsidian-700"
                />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  Block voucher sharing over a phone hotspot
                </span>
              </label>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Stops one customer re-sharing their paid session to a whole room. Detection is by
                TTL, so it can also block a customer whose own device legitimately sits behind a
                travel router — leave it off unless sharing is actually costing you.
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-obsidian-800">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={pppoeEnabled}
                  onChange={(e) => setPppoeEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-obsidian-700"
                />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">
                  This router serves PPPoE subscribers
                </span>
              </label>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Leave off for a hotspot-only router. RADIUS authentication is configured either
                way — this adds the PPPoE server that actually listens for subscribers.
              </p>

              {pppoeEnabled && (
                <div className="mt-4 space-y-3">
                  <div>
                    <Label htmlFor="pppoeInterface">Click to select PPPoE port or VLAN</Label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {["ether5", "ether4", "ether2", "sfp1", "vlan10", "vlan20", "vlan100"].map((iface) => {
                        const isSelected = pppoeInterface === iface;
                        return (
                          <button
                            key={iface}
                            type="button"
                            onClick={() => selectPppoePort(iface)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              isSelected
                                ? "border-purple-600 bg-purple-50 text-purple-800 shadow-xs dark:border-purple-500 dark:bg-purple-950/70 dark:text-purple-300 font-semibold ring-1 ring-purple-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-300"
                            }`}
                          >
                            {isSelected ? <IconCheck size={13} className="text-purple-600 dark:text-purple-400" /> : null}
                            {iface}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2">
                      <Input
                        id="pppoeInterface"
                        placeholder="Selected interface (e.g. ether5 or vlan20)"
                        value={pppoeInterface}
                        onChange={(e) => selectPppoePort(e.target.value)}
                        required
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      The port or VLAN facing your subscribers — not your uplink.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="pppoeGatewayIp">Gateway address</Label>
                      <Input
                        id="pppoeGatewayIp"
                        placeholder="10.10.0.1"
                        value={pppoeGatewayIp}
                        onChange={(e) => setPppoeGatewayIp(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pppoePoolRange">Subscriber address range</Label>
                      <Input
                        id="pppoePoolRange"
                        placeholder="10.10.0.2-10.10.255.254"
                        value={pppoePoolRange}
                        onChange={(e) => setPppoePoolRange(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Pick a range that does not overlap anything already on this network — the
                    gateway must sit outside the range.
                  </p>
                </div>
              )}
            </div>

            {error && <ErrorText>{error}</ErrorText>}
            <div className="mt-5 flex justify-end">
              <Button type="submit" disabled={createPending.isPending} className="gap-1.5">
                {createPending.isPending ? "Registering..." : "Continue"} <IconChevronRight size={14} />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 2 && created && (
        <Card>
          <h2 className="mb-1 text-[15px] font-semibold text-slate-900 dark:text-white">Run the setup command</h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            In WinBox, open <span className="text-slate-300">New Terminal</span> on <span className="font-medium text-slate-200">{created.name}</span>, paste
            this command and press Enter. It sets up the API user, RADIUS, the hotspot and its login page, DNS and NAT, and the walled garden for M-Pesa,
            Paystack and Pesapal, then links the router. It&apos;s the only script you need.
          </p>

          <CodeBlock code={oneLiner || null} label="Setup command (single use)" maxHeight="8rem" />

          {provisioningScript && (
            <details className="mt-3 rounded-lg border border-obsidian-800 p-3">
              <summary className="cursor-pointer select-none text-sm text-slate-300 hover:text-white">
                Command fails with &ldquo;Network unreachable&rdquo; or &ldquo;resolving error&rdquo;?
              </summary>
              <div className="mt-3 space-y-3 text-sm text-slate-400">
                <p>
                  The router can&apos;t reach MashupHost yet. First check the cable from your modem or main router goes into the hAP&apos;s{" "}
                  <span className="text-slate-200">port 1 (ether1)</span> and that port&apos;s light is on. Then set it up from a file instead. The file
                  also fixes the internet port, and the router links itself once it&apos;s online.
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Download the setup file.</li>
                  <li>
                    In WinBox, open <span className="text-slate-200">Files</span> and drag <span className="font-mono text-slate-300">setup.rsc</span> into
                    it.
                  </li>
                  <li>
                    In <span className="text-slate-200">New Terminal</span>, run <span className="font-mono text-slate-300">/import setup.rsc</span>.
                  </li>
                </ol>
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg border border-obsidian-700 bg-obsidian-900 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-obsidian-800"
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([provisioningScript.replace(/\r?\n/g, "\r\n")], { type: "text/plain" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "setup.rsc";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download setup.rsc
                </button>
              </div>
            </details>
          )}

          {provisioningScript && (
            <details className="mt-3">
              <summary className="cursor-pointer select-none text-sm text-slate-400 hover:text-white">Show the full script it runs</summary>
              <div className="mt-2">
                <CodeBlock code={provisioningScript} label="setup.rsc" maxHeight="16rem" />
              </div>
            </details>
          )}

          <div className="my-4">
            {created.host ? (
              <Notice tone="good">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    Linked from <span className="font-mono">{created.host}</span>.
                  </span>
                  {statusPill}
                </div>
              </Notice>
            ) : (
              <Notice tone="warn">
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300/60 border-t-transparent" aria-hidden="true" />
                  Waiting for the router to check in…
                </span>
              </Notice>
            )}
          </div>

          {!created.host && (
            <button
              type="button"
              className="mb-4 text-xs font-medium text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
              onClick={() => setShowManualFallback((v) => !v)}
            >
              {showManualFallback ? "Hide manual entry" : "This router can't reach the platform — link it manually instead"}
            </button>
          )}

          {showManualFallback && !created.host && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                linkManually.mutate();
              }}
              className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-obsidian-800 sm:grid-cols-2"
            >
              <div>
                <Label htmlFor="manualHost">Host / Public IP</Label>
                <Input id="manualHost" placeholder="192.168.88.1" value={manualHost} onChange={(e) => setManualHost(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="manualPort">API port</Label>
                <Input id="manualPort" type="number" value={manualPort} onChange={(e) => setManualPort(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="manualUsername">API username</Label>
                <Input id="manualUsername" value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="manualPassword">API password</Label>
                <Input id="manualPassword" type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} required />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="manualUseTls"
                  type="checkbox"
                  checked={manualUseTls}
                  onChange={(e) => setManualUseTls(e.target.checked)}
                  className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 dark:border-obsidian-700"
                />
                <Label htmlFor="manualUseTls" className="!mb-0 cursor-pointer">Use TLS (port 8729)</Label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={linkManually.isPending} className="text-sm">
                  {linkManually.isPending ? "Linking..." : "Link manually"}
                </Button>
              </div>
            </form>
          )}

          {error && <ErrorText>{error}</ErrorText>}

          <div className="flex justify-end">
            <Button onClick={() => setStep(3)} disabled={!created.host} className="gap-1.5">
              Continue <IconChevronRight size={14} />
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && created && (
        <Card>
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <IconCheck size={22} />
            </div>
            <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">{created.name} is linked</h2>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              Next, set up your hotspot packages, or add PPPoE customers.
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={() => router.push("/vouchers")}>
                Set up Hotspot
              </Button>
              <Button onClick={() => router.push("/routers")}>Go to Routers</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
