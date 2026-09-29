"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Logo } from "@/components/marketing/brand";
import { authPrimaryButton, authSecondaryButton, Spinner } from "@/components/marketing/auth-shell";
import { IconCheck } from "@/components/icons";

/**
 * ISP sign-up in three steps: who you are, prove the email, name the ISP. Email is the one
 * thing verified — it is also the username — so the code goes there; a phone number is
 * optional and only used for notifications later. The account is created PENDING_APPROVAL and
 * the last screen says so plainly.
 */

interface CountryOption {
  name: string;
  iso2: string;
  dial: string;
  timezone: string;
  currency: string;
}

const COUNTRIES: CountryOption[] = [
  { name: "Kenya", iso2: "KE", dial: "254", timezone: "Africa/Nairobi", currency: "KES" },
  { name: "Uganda", iso2: "UG", dial: "256", timezone: "Africa/Kampala", currency: "UGX" },
  { name: "Tanzania", iso2: "TZ", dial: "255", timezone: "Africa/Dar_es_Salaam", currency: "TZS" },
  { name: "Rwanda", iso2: "RW", dial: "250", timezone: "Africa/Kigali", currency: "RWF" },
  { name: "Ethiopia", iso2: "ET", dial: "251", timezone: "Africa/Addis_Ababa", currency: "ETB" },
  { name: "Somalia", iso2: "SO", dial: "252", timezone: "Africa/Mogadishu", currency: "SOS" },
  { name: "Nigeria", iso2: "NG", dial: "234", timezone: "Africa/Lagos", currency: "NGN" },
  { name: "Ghana", iso2: "GH", dial: "233", timezone: "Africa/Accra", currency: "GHS" },
  { name: "South Africa", iso2: "ZA", dial: "27", timezone: "Africa/Johannesburg", currency: "ZAR" },
];

const HEARD_ABOUT = ["A referral", "Google search", "Facebook or Instagram", "LinkedIn", "WISP community", "YouTube", "Other"];

/** Baked in at build time by Next; falls back to the current host's parent domain in dev. */
const PLATFORM_BASE_DOMAIN =
  process.env.NEXT_PUBLIC_PLATFORM_BASE_DOMAIN ?? (typeof window !== "undefined" ? window.location.hostname.split(".").slice(-2).join(".") : "");

const STEPS = ["Your details", "Verify email", "Your ISP"] as const;

const inputClass =
  "mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-500";
const labelClass = "block text-sm font-medium text-slate-700";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function IspRegistrationWizard() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<CountryOption>(COUNTRIES[0]!);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Step 3
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugCheck, setSlugCheck] = useState<{ state: "idle" | "checking" | "ok" | "taken"; reason?: string; suggestions?: string[] }>({ state: "idle" });
  const [heardAboutUs, setHeardAboutUs] = useState("");
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ name: string } | null>(null);

  const passwordOk = password.length >= 10 && /[a-zA-Z]/.test(password) && /[\d\W]/.test(password);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === 1) codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(company));
  }, [company, slugTouched]);

  // Availability, debounced, against the same rules the server enforces on submit.
  useEffect(() => {
    if (slug.length < 3) {
      setSlugCheck({ state: "idle" });
      return;
    }
    setSlugCheck({ state: "checking" });
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ available: boolean; reason?: string; suggestions?: string[] }>(
          `/api/v1/auth/isp-registration/check-slug?slug=${encodeURIComponent(slug)}`,
          { skipAuth: true }
        );
        setSlugCheck(res.available ? { state: "ok" } : { state: "taken", reason: res.reason, suggestions: res.suggestions });
      } catch {
        setSlugCheck({ state: "idle" }); // the server decides again on submit
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  const fullPhone = useMemo(() => {
    const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
    return digits ? `+${country.dial}${digits}` : "";
  }, [phone, country]);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiRequestError ? err.message : fallback);

  const sendCode = async () => {
    await apiFetch("/api/v1/auth/isp-registration/email-otp/send", { method: "POST", skipAuth: true, body: JSON.stringify({ email: email.trim().toLowerCase() }) });
    setResendIn(60);
  };

  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passwordOk) {
      setError("Use at least 10 characters with a letter and a number or symbol.");
      return;
    }
    setBusy(true);
    try {
      await sendCode();
      setStep(1);
    } catch (err) {
      fail(err, "We couldn't send the code. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ ticket: string }>("/api/v1/auth/isp-registration/email-otp/verify", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      });
      setTicket(res.ticket);
      setStep(2);
    } catch (err) {
      fail(err, "That code didn't match. Check the email and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitIsp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!ticket) {
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ tenant: { name: string } }>("/api/v1/auth/isp-registration", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          name: fullName.trim(),
          company: company.trim(),
          slug,
          email: email.trim().toLowerCase(),
          phone: fullPhone || undefined,
          phoneVerificationTicket: ticket,
          verificationType: "email",
          country: country.iso2,
          timezone: country.timezone,
          currency: country.currency,
          password,
          heardAboutUs: heardAboutUs || undefined,
        }),
      });
      setDone({ name: res.tenant?.name ?? company.trim() });
    } catch (err) {
      fail(err, "We couldn't create the account. Check the details and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="force-light flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Suntech home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <Logo />
        </Link>
        <p className="text-sm text-slate-600">
          <span className="hidden sm:inline">Already have an account? </span>
          <Link href="/login" className="font-semibold text-blue-700 hover:text-blue-800">
            Sign in
          </Link>
        </p>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-14">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.18)] sm:p-8">
          {done ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                <IconCheck size={24} />
              </span>
              <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-slate-950">Application received</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                <span className="font-medium text-slate-900">{done.name}</span> is registered and waiting for approval. We review new ISPs, usually within a
                business day, and will email <span className="font-medium text-slate-900">{email.trim()}</span> with your sign-in link the moment it&rsquo;s
                approved.
              </p>
              <dl className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-left text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Your address</dt>
                  <dd className="font-mono text-slate-900">
                    {slug}.{PLATFORM_BASE_DOMAIN || "suntechke.com"}
                  </dd>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Username</dt>
                  <dd className="text-slate-900">{email.trim().toLowerCase()}</dd>
                </div>
              </dl>
              <Link href="/" className={`${authSecondaryButton} mt-6`}>
                Back to the homepage
              </Link>
            </div>
          ) : (
            <>
              <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
                {STEPS.map((label, i) => (
                  <li key={label} className="flex flex-1 items-center gap-2">
                    <span className={`h-1 flex-1 rounded-full ${i <= step ? "bg-blue-700" : "bg-slate-200"}`} aria-hidden="true" />
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs font-medium text-slate-500">
                Step {step + 1} of {STEPS.length} · {STEPS[step]}
              </p>

              {error && (
                <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </p>
              )}

              {step === 0 && (
                <form onSubmit={submitDetails} className="mt-5 space-y-4" noValidate>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">Create your ISP account</h1>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">Free for 14 days. We&rsquo;ll send a code to your email to confirm it&rsquo;s yours.</p>
                  </div>
                  <Field label="Full name" htmlFor="name">
                    <input id="name" className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required autoFocus placeholder="e.g. Amina Otieno" />
                  </Field>
                  <Field label="Work email" htmlFor="email" hint="This is your username. The verification code goes here.">
                    <input id="email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@yourisp.co.ke" />
                  </Field>
                  <Field label="Phone (optional)" htmlFor="phone" hint="For M-Pesa and WhatsApp notifications later. Not used to verify your account.">
                    <div className="mt-1.5 flex gap-2">
                      <select
                        aria-label="Country code"
                        className="rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-600"
                        value={country.iso2}
                        onChange={(e) => setCountry(COUNTRIES.find((c) => c.iso2 === e.target.value) ?? COUNTRIES[0]!)}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.iso2} value={c.iso2}>
                            {c.name} +{c.dial}
                          </option>
                        ))}
                      </select>
                      <input id="phone" type="tel" inputMode="tel" className={`${inputClass} mt-0`} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel-national" placeholder="0712 345 678" />
                    </div>
                  </Field>
                  <Field label="Password" htmlFor="password" hint="At least 10 characters, with a letter and a number or symbol.">
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        className={`${inputClass} pr-16`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                        minLength={10}
                      />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 mt-[3px] -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-800">
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </Field>
                  <button type="submit" className={authPrimaryButton} disabled={busy || !fullName.trim() || !emailOk || !passwordOk}>
                    {busy ? <Spinner /> : null}
                    {busy ? "Sending code…" : "Continue"}
                  </button>
                </form>
              )}

              {step === 1 && (
                <form onSubmit={submitCode} className="mt-5 space-y-4" noValidate>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">Check your email</h1>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">
                      We sent a 6-digit code to <span className="font-medium text-slate-900">{email.trim()}</span>. It expires in 10 minutes.
                    </p>
                  </div>
                  <Field label="Verification code" htmlFor="code">
                    <input
                      ref={codeRef}
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      className={`${inputClass} text-center font-mono text-xl tracking-[0.4em]`}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                    />
                  </Field>
                  <button type="submit" className={authPrimaryButton} disabled={busy || code.length !== 6}>
                    {busy ? <Spinner /> : null}
                    {busy ? "Checking…" : "Verify email"}
                  </button>
                  <div className="flex items-center justify-between text-sm">
                    <button type="button" className="text-slate-600 hover:text-slate-950" onClick={() => { setStep(0); setError(null); }}>
                      Change email
                    </button>
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:text-blue-800 disabled:text-slate-400"
                      disabled={resendIn > 0 || busy}
                      onClick={() => sendCode().catch((err) => fail(err, "Couldn't resend the code."))}
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  </div>
                </form>
              )}

              {step === 2 && (
                <form onSubmit={submitIsp} className="mt-5 space-y-4" noValidate>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">Name your ISP</h1>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">The address is where you and your staff sign in, and where your customers see your brand.</p>
                  </div>
                  <Field label="ISP or company name" htmlFor="company">
                    <input id="company" className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" required autoFocus placeholder="e.g. Acme Fibre" />
                  </Field>
                  <Field label="Address" htmlFor="slug" hint="Letters, numbers and dashes. This cannot be changed later.">
                    <div className="mt-1.5 flex items-stretch rounded-md border border-slate-300 bg-white shadow-sm focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20">
                      <input
                        id="slug"
                        className="min-w-0 flex-1 rounded-l-md bg-transparent px-3 py-2.5 font-mono text-sm text-slate-950 outline-none"
                        value={slug}
                        onChange={(e) => {
                          setSlugTouched(true);
                          setSlug(slugify(e.target.value));
                        }}
                        required
                        minLength={3}
                        spellCheck={false}
                      />
                      <span className="flex items-center rounded-r-md border-l border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">.{PLATFORM_BASE_DOMAIN || "suntechke.com"}</span>
                    </div>
                    <p className={`mt-1.5 text-xs ${slugCheck.state === "ok" ? "text-emerald-700" : slugCheck.state === "taken" ? "text-rose-700" : "text-slate-500"}`} aria-live="polite">
                      {slugCheck.state === "checking" && "Checking…"}
                      {slugCheck.state === "ok" && "Available"}
                      {slugCheck.state === "taken" && (slugCheck.reason ?? "Not available")}
                    </p>
                    {slugCheck.state === "taken" && slugCheck.suggestions?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {slugCheck.suggestions.map((s) => (
                          <button key={s} type="button" onClick={() => { setSlugTouched(true); setSlug(s); }} className="rounded-full border border-slate-300 px-2.5 py-0.5 font-mono text-xs text-slate-700 hover:border-slate-400">
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </Field>
                  <Field label="How did you hear about us? (optional)" htmlFor="heard">
                    <select id="heard" className={inputClass} value={heardAboutUs} onChange={(e) => setHeardAboutUs(e.target.value)}>
                      <option value="">Choose one</option>
                      {HEARD_ABOUT.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-start gap-2.5 text-sm text-slate-700">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 rounded border-slate-300 text-blue-700 focus:ring-blue-600" />
                    <span>
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" className="font-medium text-blue-700 hover:underline">
                        terms of service
                      </Link>{" "}
                      and understand my ISP is reviewed before it goes live.
                    </span>
                  </label>
                  <button type="submit" className={authPrimaryButton} disabled={busy || !agree || !company.trim() || slug.length < 3 || slugCheck.state === "taken" || slugCheck.state === "checking"}>
                    {busy ? <Spinner /> : null}
                    {busy ? "Creating account…" : "Create account"}
                  </button>
                  <p className="text-center text-xs text-slate-500">
                    Country: {country.name} · Currency: {country.currency} · Timezone: {country.timezone}
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-6 text-xs text-slate-500">
        <span>© {new Date().getFullYear()} Suntech</span>
        <Link href="/terms" className="hover:text-slate-800">
          Terms
        </Link>
      </footer>
    </div>
  );
}
