"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Button, Card, ErrorText, HintText, Input, Label } from "@/components/ui";
import { CodeBlock, Notice, PageHeader, Pill } from "@/components/dashboard/surface";
import { IconCheck, IconChevronRight } from "@/components/icons";

type Step = 1 | 2 | 3;
/** What the router is for, in the words an ISP uses. */
type Use = "hotspot" | "pppoe" | "both";

interface RouterRecord {
  id: string;
  name: string;
  host: string | null;
  status: "UNKNOWN" | "ONLINE" | "WARNING" | "DOWN";
  lastError: string | null;
}

// Linking a router is three plain steps: name it and say what it's for, paste one command, and
// it links itself. The one setup script (buildMikrotikProvisioningScript) does everything else —
// API user, RADIUS, hotspot and its sign-in page, DNS, NAT, walled garden, PPPoE server — so
// nothing here asks for an IP, port or password. Port roles, RouterOS version and the rest have
// safe defaults under "Advanced": the defaults are right for a normal hAP / RB setup.
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Name it" },
  { n: 2, label: "Paste the command" },
  { n: 3, label: "Done" },
];

const LAN_PORTS = ["ether2", "ether3", "ether4", "ether5"] as const;

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
            <span className={`text-xs font-medium ${s.n <= current ? "text-slate-900 dark:text-white" : "text-slate-400"}`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`mx-3 mb-5 h-0.5 w-12 sm:w-16 ${s.n < current ? "bg-brand-600" : "bg-slate-200 dark:bg-obsidian-800"}`} />}
        </div>
      ))}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  title,
  body,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex-1 rounded-xl border p-3.5 text-left transition-colors ${
        selected
          ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-950/40"
          : "border-slate-200 bg-white hover:border-slate-300 dark:border-obsidian-700 dark:bg-obsidian-900"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <span
          className={`flex h-4 w-4 items-center justify-center rounded-full border ${
            selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 dark:border-obsidian-600"
          }`}
        >
          {selected && <IconCheck size={10} />}
        </span>
        {title}
      </span>
      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{body}</span>
    </button>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
        selected
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-obsidian-700 dark:bg-obsidian-900 dark:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function LinkRouterWizardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [use, setUse] = useState<Use>("hotspot");
  const [pppoePort, setPppoePort] = useState("ether5");

  // Advanced — safe defaults for a normal setup.
  const [routerOsMajor, setRouterOsMajor] = useState<6 | 7 | null>(null);
  const [lanPort, setLanPort] = useState<string>("none");
  const [blockTethering, setBlockTethering] = useState(false);
  const [pppoeGatewayIp, setPppoeGatewayIp] = useState("10.10.0.1");
  const [pppoePoolRange, setPppoePoolRange] = useState("10.10.0.2-10.10.255.254");

  const [created, setCreated] = useState<RouterRecord | null>(null);
  const [provisionToken, setProvisionToken] = useState<string | null>(null);
  const [provisioningScript, setProvisioningScript] = useState<string | null>(null);
  const [oneLiner, setOneLiner] = useState<string>("");
  const [waitedSeconds, setWaitedSeconds] = useState(0);

  const hasPppoe = use !== "hotspot";
  const hasHotspot = use !== "pppoe";
  // Every LAN port that isn't PPPoE's or the office port serves the hotspot, plus the Wi-Fi.
  const hotspotPorts = hasHotspot
    ? [...LAN_PORTS.filter((p) => !(hasPppoe && p === pppoePort) && p !== lanPort), "wlan1"]
    : [];

  /** The port picture: what each socket on the router does, in words. */
  const portRole = (p: string): { label: string; tone: string } => {
    if (hasPppoe && p === pppoePort) return { label: "Home customers (PPPoE)", tone: "bg-purple-600 text-white" };
    if (p === lanPort) return { label: "Office (no sign-in)", tone: "bg-emerald-600 text-white" };
    if (hasHotspot) return { label: "Hotspot", tone: "bg-blue-600 text-white" };
    return { label: "Not used", tone: "bg-slate-100 text-slate-500 dark:bg-obsidian-800 dark:text-slate-400" };
  };

  const createPending = useMutation({
    mutationFn: () =>
      apiFetch<RouterRecord & { provisionToken: string }>("/api/v1/routers/pending", {
        method: "POST",
        body: JSON.stringify({
          name,
          routerOsMajor,
          hotspotPorts,
          lanPort: lanPort !== "none" ? lanPort : null,
          ...(hasPppoe
            ? { pppoeInterface: pppoePort, pppoeGatewayIp: pppoeGatewayIp.trim(), pppoePoolRange: pppoePoolRange.trim() }
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
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Could not add the router. Please try again."),
  });

  const loadProvisioningScript = useMutation({
    mutationFn: () =>
      apiFetch<{ script: string; fetchCommand?: string; oneLiner?: string }>(
        `/api/v1/routers/${created!.id}/provisioning-script?provisionToken=${encodeURIComponent(provisionToken!)}`
      ),
    onSuccess: (result) => {
      setProvisioningScript(result.script);
      // Only ever the API's command: it carries this deployment's public URL.
      setOneLiner(result.oneLiner || result.fetchCommand || "");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Could not make the setup command. Please reload the page."),
  });

  useEffect(() => {
    if (step === 2 && created && provisionToken && !provisioningScript) loadProvisioningScript.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, created?.id]);

  // Wait for the router to check in (its setup command calls back and fills in `host`), then move
  // on by itself — nobody has to find a Continue button.
  useEffect(() => {
    if (step !== 2 || !created) return;
    let cancelled = false;
    const started = Date.now();
    const poll = async () => {
      if (cancelled) return;
      setWaitedSeconds(Math.round((Date.now() - started) / 1000));
      try {
        const result = await apiFetch<RouterRecord>(`/api/v1/routers/${created.id}`);
        if (result.host) {
          await apiFetch(`/api/v1/routers/${result.id}/test-connection`, { method: "POST" }).catch(() => {});
          const fresh = await apiFetch<RouterRecord>(`/api/v1/routers/${result.id}`).catch(() => result);
          if (cancelled) return;
          setCreated(fresh);
          queryClient.invalidateQueries({ queryKey: ["routers"] });
          setStep(3);
          return;
        }
      } catch {
        // Keep waiting through a network blip.
      }
      if (!cancelled) setTimeout(poll, 3000);
    };
    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, created?.id]);

  const downloadScript = () => {
    if (!provisioningScript) return;
    const url = URL.createObjectURL(new Blob([provisioningScript.replace(/\r?\n/g, "\r\n")], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "setup.rsc";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/routers" className="text-sm text-slate-400 hover:text-white">
          ← Routers
        </Link>
        <div className="mt-2">
          <PageHeader title="Add a MikroTik router" description="Give it a name, paste one command into the router, and it sets itself up. No IP address, port or password to type." />
        </div>
      </div>

      <StepDots current={step} />

      {step === 1 && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              createPending.mutate();
            }}
          >
            <Label htmlFor="name">1. Router name</Label>
            <Input id="name" placeholder="e.g. Kahawa Shop, Main Office" value={name} onChange={(e) => setName(e.target.value)} required />
            <HintText>Any name you&apos;ll recognise. Only you see it.</HintText>

            <div className="mt-5">
              <Label>2. What is this router for?</Label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="What is this router for?">
                <Choice
                  selected={use === "hotspot"}
                  onClick={() => setUse("hotspot")}
                  title="Hotspot"
                  body="Walk-in customers buy a voucher or pay by M-Pesa on the sign-in page."
                />
                <Choice
                  selected={use === "pppoe"}
                  onClick={() => setUse("pppoe")}
                  title="PPPoE"
                  body="Home or office customers on a monthly plan, with their own router."
                />
                <Choice selected={use === "both"} onClick={() => setUse("both")} title="Both" body="Hotspot on the Wi-Fi, and PPPoE on one port." />
              </div>
            </div>

            {hasPppoe && (
              <div className="mt-5">
                <Label>3. Which port does the cable to your PPPoE customers go into?</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {LAN_PORTS.map((p) => (
                    <Chip
                      key={p}
                      selected={pppoePort === p}
                      onClick={() => {
                        setPppoePort(p);
                        if (lanPort === p) setLanPort("none");
                      }}
                    >
                      {p}
                    </Chip>
                  ))}
                </div>
                <HintText>Usually the last port (ether5), to your switch or access points. Never port 1: that&apos;s your internet.</HintText>
              </div>
            )}

            {/* The ports, as the ISP will cable them. */}
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-obsidian-800 dark:bg-obsidian-900/50">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">How to plug it in</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <div className="rounded-md bg-amber-100 px-2 py-1.5 text-xs dark:bg-amber-950/70">
                  <span className="font-semibold text-amber-900 dark:text-amber-200">ether1</span>
                  <span className="block text-amber-800 dark:text-amber-300">Internet in (from your modem)</span>
                </div>
                {LAN_PORTS.map((p) => {
                  const role = portRole(p);
                  return (
                    <div key={p} className={`rounded-md px-2 py-1.5 text-xs ${role.tone}`}>
                      <span className="font-semibold">{p}</span>
                      <span className="block opacity-90">{role.label}</span>
                    </div>
                  );
                })}
                {hasHotspot && (
                  <div className="rounded-md bg-blue-600 px-2 py-1.5 text-xs text-white">
                    <span className="font-semibold">Wi-Fi</span>
                    <span className="block opacity-90">Hotspot</span>
                  </div>
                )}
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-slate-200 p-3.5 dark:border-obsidian-800">
              <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 dark:text-slate-300">
                Advanced (optional — the defaults work for most routers)
              </summary>
              <div className="mt-4 space-y-5">
                <div>
                  <Label>RouterOS version</Label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {([
                      { v: null, label: "Detect automatically" },
                      { v: 6, label: "v6" },
                      { v: 7, label: "v7" },
                    ] as const).map((o) => (
                      <Chip key={String(o.v)} selected={routerOsMajor === o.v} onClick={() => setRouterOsMajor(o.v)}>
                        {o.label}
                      </Chip>
                    ))}
                  </div>
                  <HintText>Leave on &ldquo;Detect automatically&rdquo; unless you know it.</HintText>
                </div>

                <div>
                  <Label>Office port (internet with no sign-in)</Label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Chip selected={lanPort === "none"} onClick={() => setLanPort("none")}>
                      None
                    </Chip>
                    {LAN_PORTS.filter((p) => !(hasPppoe && p === pppoePort)).map((p) => (
                      <Chip key={p} selected={lanPort === p} onClick={() => setLanPort(p)}>
                        {p}
                      </Chip>
                    ))}
                  </div>
                  <HintText>For your own PC, CCTV or a technician laptop. Devices there get internet without the sign-in page.</HintText>
                </div>

                {hasHotspot && (
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={blockTethering}
                      onChange={(e) => setBlockTethering(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-obsidian-700"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900 dark:text-white">Block voucher sharing</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        Stops one customer sharing their paid Wi-Fi from their phone&apos;s hotspot. Can block some travel routers; leave off unless sharing costs you.
                      </span>
                    </span>
                  </label>
                )}

                {hasPppoe && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="pppoeGatewayIp">PPPoE gateway address</Label>
                      <Input id="pppoeGatewayIp" value={pppoeGatewayIp} onChange={(e) => setPppoeGatewayIp(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="pppoePoolRange">PPPoE customer addresses</Label>
                      <Input id="pppoePoolRange" value={pppoePoolRange} onChange={(e) => setPppoePoolRange(e.target.value)} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
                      Only change these if 10.10.x.x is already used on your network.
                    </p>
                  </div>
                )}
              </div>
            </details>

            {error && <ErrorText>{error}</ErrorText>}
            <div className="mt-5 flex justify-end">
              <Button type="submit" disabled={createPending.isPending || !name.trim()} className="gap-1.5">
                {createPending.isPending ? "Adding…" : "Next: get the command"} <IconChevronRight size={14} />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 2 && created && (
        <Card>
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900 dark:text-white">Paste this into {created.name}</h2>
          <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>
              Plug your internet cable into <b>port 1 (ether1)</b> of the router.
            </li>
            <li>
              Open <b>WinBox</b>, connect to the router, and click <b>New Terminal</b>.
            </li>
            <li>
              Click <b>Copy</b> below, paste it into the terminal and press <b>Enter</b>.
            </li>
          </ol>

          <CodeBlock code={oneLiner || null} label="Setup command — use it once, for this router only" maxHeight="8rem" />

          <div className="my-4">
            <Notice tone="warn">
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300/60 border-t-transparent" aria-hidden="true" />
                Waiting for the router… this page moves on by itself when it&apos;s linked (usually under a minute).
              </span>
            </Notice>
          </div>

          {waitedSeconds >= 90 && (
            <div className="mb-4 rounded-lg border border-slate-200 p-3.5 text-sm text-slate-600 dark:border-obsidian-800 dark:text-slate-300">
              <p className="font-medium text-slate-900 dark:text-white">Taking a while? Check these:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>The terminal showed no red error. If it said &ldquo;Network unreachable&rdquo; or &ldquo;resolving error&rdquo;, the router has no internet: check the cable is in port 1 and its light is on.</li>
                <li>You pasted the whole command and pressed Enter.</li>
                <li>
                  Still stuck? Use the setup file instead: download it, drag <span className="font-mono">setup.rsc</span> into WinBox → Files, then run{" "}
                  <span className="font-mono">/import setup.rsc</span> in New Terminal.{" "}
                  <button type="button" onClick={downloadScript} disabled={!provisioningScript} className="font-medium text-brand-600 underline dark:text-brand-400">
                    Download setup.rsc
                  </button>
                </li>
              </ul>
            </div>
          )}

          {provisioningScript && (
            <details>
              <summary className="cursor-pointer select-none text-xs text-slate-400 hover:text-slate-200">Show everything the command sets up</summary>
              <div className="mt-2">
                <CodeBlock code={provisioningScript} label="setup.rsc" maxHeight="16rem" />
              </div>
            </details>
          )}

          {error && <ErrorText>{error}</ErrorText>}
        </Card>
      )}

      {step === 3 && created && (
        <Card>
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <IconCheck size={22} />
            </div>
            <h2 className="mb-1 flex items-center justify-center gap-2 font-semibold text-slate-900 dark:text-white">
              {created.name} is linked <Pill tone="good">Online</Pill>
            </h2>
            <p className="mx-auto mb-6 max-w-md text-sm text-slate-500 dark:text-slate-400">
              It updates and repairs itself from now on. What&apos;s next:
            </p>
            <div className="mx-auto max-w-md space-y-2 text-left text-sm">
              {hasHotspot && (
                <button
                  type="button"
                  onClick={() => router.push("/vouchers")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 hover:border-slate-300 dark:border-obsidian-700"
                >
                  <span>
                    <span className="block font-medium text-slate-900 dark:text-white">Hotspot: set your prices</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">Add packages like &ldquo;1 hour – KSh 10&rdquo;. Then connect a phone to the Wi-Fi to test.</span>
                  </span>
                  <IconChevronRight size={14} />
                </button>
              )}
              {hasPppoe && (
                <button
                  type="button"
                  onClick={() => router.push("/packages")}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 hover:border-slate-300 dark:border-obsidian-700"
                >
                  <span>
                    <span className="block font-medium text-slate-900 dark:text-white">PPPoE: add a monthly plan, then a customer</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Each customer gets a username and password to type into their own router (WAN → PPPoE).
                    </span>
                  </span>
                  <IconChevronRight size={14} />
                </button>
              )}
            </div>
            <div className="mt-6">
              <Button variant="secondary" onClick={() => router.push("/routers")}>
                Go to Routers
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
