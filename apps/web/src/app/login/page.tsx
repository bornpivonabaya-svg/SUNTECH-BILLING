"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import { ErrorText, Input, Label } from "@/components/ui";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { TwoStepSignIn } from "@/components/auth/two-step";
import type { SecondStep } from "@/lib/auth-context";
import { IconArrowRight, IconCheck, IconEye, IconEyeOff } from "@/components/icons";
import { Logo } from "@/components/marketing/brand";

const loginSchema = z.object({
  tenantSlug: z.string().optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Please enter your email address")
    .email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// Reads the tenant from `useSearchParams()` rather than a `searchParams` page prop. Next 15
// makes that prop a Promise, which a client component can only unwrap with React 19's `use()` —
// and this app is on React 18. The hook is the idiomatic client-component route regardless, and
// it is already what register/, verify-email/ and reset-password/ do, so this also stops /login
// being the odd one out. `useSearchParams()` opts the route into client-side rendering, hence
// the Suspense boundary in the default export below.
function LoginContent() {
  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const detectedTenant = searchParams.get("tenant");
  // Where to go after signing in, e.g. the customer app. Only a path on this site, never "//evil".
  const nextParam = searchParams.get("next");
  const nextPath = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\") ? nextParam : "/dashboard";
  const [serverError, setServerError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { tenantSlug: detectedTenant ?? "" },
  });

  const tenantSlug = watch("tenantSlug");

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      const step = await login({
        tenantSlug: values.tenantSlug || undefined,
        email: values.email,
        password: values.password,
      });
      if (step) setSecondStep(step);
      else router.push(nextPath);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError(err.message);
      } else {
        setServerError("Invalid credentials. Please verify your email and password.");
      }
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setServerError(null);
    setGooglePending(true);
    try {
      const step = await loginWithGoogle({ tenantSlug: tenantSlug || "", credential });
      if (step) setSecondStep(step);
      else router.push(nextPath);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : "Google sign-in failed — please try again.");
    } finally {
      setGooglePending(false);
    }
  };

  return (
    <div className="force-light flex min-h-screen bg-white text-slate-900 antialiased">
      {/* Form column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Suntech Billing home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            <Logo />
          </Link>
          {detectedTenant ? (
            <Link
              href={`/register?tenant=${encodeURIComponent(detectedTenant)}`}
              className="text-sm font-medium text-slate-600 hover:text-slate-950"
            >
              Subscriber sign up
            </Link>
          ) : (
            <p className="text-sm text-slate-600">
              <span className="hidden sm:inline">New to Suntech Billing? </span>
              <Link href="/register" className="font-semibold text-blue-700 hover:text-blue-800">
                Create account
              </Link>
            </p>
          )}
        </header>

        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-sm">
            <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em] text-slate-950">Sign in</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Manage your network, billing and subscribers.
            </p>

            {secondStep ? (
              <TwoStepSignIn step={secondStep} onDone={() => router.push(nextPath)} onCancel={() => setSecondStep(null)} />
            ) : (
              <>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
              <input type="hidden" {...register("tenantSlug")} />

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@yourisp.co.ke"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email", {
                    setValueAs: (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
                  })}
                />
                {errors.email && <ErrorText>{errors.email.message}</ErrorText>}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label htmlFor="password" className="mb-0">
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="rounded text-xs font-medium text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-11"
                    aria-invalid={Boolean(errors.password)}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                </div>
                {errors.password && <ErrorText>{errors.password.message}</ErrorText>}
              </div>

              {serverError && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in <IconArrowRight size={15} />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6">
              <div className="relative mb-5 text-center text-xs text-slate-400">
                <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
                <span className="relative bg-white px-3">or</span>
              </div>
              {tenantSlug ? (
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-500">
                  Google sign-in works on your ISP&rsquo;s own address (yourisp.mashuphost.tech). Use your email and password here.
                </p>
              )}
              {googlePending && (
                <p className="mt-2 text-center text-xs text-slate-500" role="status">
                  Signing in with Google…
                </p>
              )}
            </div>

              </>
            )}

            <p className="mt-8 text-center text-sm text-slate-600">
              {detectedTenant ? (
                <>
                  Are you a subscriber?{" "}
                  <Link
                    href={`/register?tenant=${encodeURIComponent(detectedTenant)}`}
                    className="font-semibold text-blue-700 hover:text-blue-800"
                  >
                    Create a customer account
                  </Link>
                </>
              ) : (
                <>
                  Don&apos;t have an account?{" "}
                  <Link href="/register" className="font-semibold text-blue-700 hover:text-blue-800">
                    Register your ISP
                  </Link>
                </>
              )}
            </p>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 py-5 text-xs text-slate-500 sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} Suntech Billing</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:text-slate-800">Terms</Link>
            <Link href="/refund-policy" className="hover:text-slate-800">Refunds</Link>
            <Link href="/age-policy" className="hover:text-slate-800">Age policy</Link>
          </nav>
        </footer>
      </div>

      {/* Product panel — platform sign-in only. */}
      {!detectedTenant && (
        <aside className="hidden w-[46%] max-w-[760px] flex-col justify-center overflow-hidden border-l border-slate-200 bg-slate-50 px-12 py-16 lg:flex xl:px-16">
          <p className="text-sm font-semibold text-blue-700">Suntech Billing</p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold tracking-[-0.025em] text-slate-950">
            Your subscribers, payments and routers in one console.
          </h2>
          <ul className="mt-6 space-y-2.5 text-sm text-slate-600">
            {["M-Pesa STK Push, Paybill and Till", "MikroTik, PPPoE and FreeRADIUS", "Automated invoicing and suspensions"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <IconCheck size={16} className="text-emerald-600" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginContent />
    </Suspense>
  );
}
