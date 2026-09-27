"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { TawkToWidget } from "@/components/tawk-to-widget";
import {
  getThemeComponent,
  getThemeMeta,
  appOnlyNotice,
  DEFAULT_THEME_ID,
  THEME_CATALOG,
  type HotspotPackage,
  type VoucherLoginResult,
  type AccountLoginResult,
  type ThemeId,
} from "@/components/hotspot/themes";
import { CaptivePortalPluginContainer } from "@/components/hotspot/plugins/CaptivePortalPluginContainer";
import { PortalSheet, SheetError, sheetInput, sheetLabel, sheetPrimary, sheetSecondary } from "@/components/hotspot/portal-sheet";
import { loadPortalLanguage, portalStrings, savePortalLanguage, type PortalLanguage } from "@/lib/portal-strings";

interface TenantInfo {
  name: string;
  phone?: string | null;
  supportPhone?: string | null;
  brandName?: string | null;
  welcomeTitle?: string | null;
  bannerSubtitle?: string | null;
  activeThemeId?: ThemeId | null;
  installationFee?: string | null;
  fiberRates?: Array<{ speed: string; price: string; subtitle?: string }> | null;
  /** Already set by every tenant in Settings; the portal is the one surface that never showed
   *  either until now. */
  logoUrl?: string | null;
  brandColor?: string | null;
}

interface PaymentMethodsInfo {
  mpesa: boolean;
  paystack: boolean;
  paystackPublicKey?: string | null;
  pesapal?: boolean;
  pesapalConsumerKey?: string | null;
}

interface PurchaseResponse {
  method?: "MPESA" | "PAYSTACK" | "PESAPAL";
  checkoutRequestId?: string;
  reference?: string;
  authorizationUrl?: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  amountMinor: number;
  phone?: string;
}

interface PurchaseStatusResponse {
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  mpesaReceiptNumber?: string | null;
  voucherCode: string | null;
  resultDesc?: string | null;
  gatewayResponse?: string | null;
}

function formatPriceKsh(priceMinor: number): string {
  const ksh = Math.round(priceMinor / 100);
  return `KSh ${ksh.toLocaleString("en-KE")}`;
}

/** MikroTik's hotspot drops a client's active session the moment their device disconnects from
 *  the WiFi (sleep, walking out of range, switching networks) — reconnecting gets them a fresh
 *  captive-portal redirect even though their voucher's paid-for time hasn't run out. Without
 *  this, "reconnect" means re-typing the voucher code every single time. The voucher code IS
 *  the router credential (see submitRouterLogin's call sites: username=password=code), so
 *  remembering it here is equivalent to a session token — scoped to this one browser, cleared
 *  the moment it expires or fails. Deliberately voucher-only, not account-login: a subscriber's
 *  real account password is a different sensitivity class not worth persisting client-side. */
const REMEMBERED_VOUCHER_PREFIX = "mkg-hotspot-voucher:";
/** Per-tenant so one ISP's staff preview can never brand another ISP's portal. */
const CAPTIVE_PREVIEW_PREFIX = "mkg_hotspot_captive_config:";
/** The phone number this device last paid with, per tenant. A captive portal is re-entered
 *  constantly by the same handful of devices, and re-typing an M-Pesa number on a phone keypad
 *  behind a login wall is the step people abandon at. Stored only in the visitor's own browser
 *  — it never reaches the server and identifies nobody but the device's own owner. */
const REMEMBERED_PHONE_PREFIX = "mkg-hotspot-phone:";
const REMEMBERED_LINK_LOGIN_PREFIX = "mkg-hotspot-link-login:";
const REMEMBERED_MAC_PREFIX = "mkg-hotspot-mac:";
const REMEMBERED_LINK_ORIG_PREFIX = "mkg-hotspot-link-orig:";
const DEFAULT_ROUTER_LOGIN_URL = "http://192.168.88.1/login";

function rememberPhone(tenantSlug: string, phone: string): void {
  try {
    localStorage.setItem(REMEMBERED_PHONE_PREFIX + tenantSlug, phone);
  } catch {}
}

function loadRememberedPhone(tenantSlug: string): string {
  try {
    return localStorage.getItem(REMEMBERED_PHONE_PREFIX + tenantSlug) ?? "";
  } catch {
    return "";
  }
}

interface RememberedVoucher {
  code: string;
  expiresAt: string;
}

function rememberVoucher(tenantSlug: string, code: string, expiresAt: string | null): void {
  if (!expiresAt) return;
  try {
    localStorage.setItem(REMEMBERED_VOUCHER_PREFIX + tenantSlug, JSON.stringify({ code, expiresAt }));
  } catch {
    // Private browsing / storage blocked — force-reconnect just has nothing to work with.
  }
}

function loadRememberedVoucher(tenantSlug: string): RememberedVoucher | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_VOUCHER_PREFIX + tenantSlug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedVoucher>;
    if (!parsed.code || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(REMEMBERED_VOUCHER_PREFIX + tenantSlug);
      return null;
    }
    return { code: parsed.code, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function forgetRememberedVoucher(tenantSlug: string): void {
  try {
    localStorage.removeItem(REMEMBERED_VOUCHER_PREFIX + tenantSlug);
  } catch {
    // ignore
  }
}

/** The URL that hands the router the credentials it should log this device in with.
 *
 *  RouterOS accepts them as query parameters on link-login-only, which is what makes this work at
 *  all from a hosted portal. */
function routerLoginUrl(linkLoginOnly: string, username: string, password: string): string {
  try {
    // Parsed rather than concatenated so an existing query string (RouterOS often appends `dst`)
    // is preserved instead of being clobbered by a naive "?username=".
    const url = new URL(linkLoginOnly);
    url.searchParams.set("username", username);
    url.searchParams.set("password", password);
    return url.toString();
  } catch {
    const separator = linkLoginOnly.includes("?") ? "&" : "?";
    return `${linkLoginOnly}${separator}username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }
}

function submitRouterLogin(
  linkLoginOnly: string,
  username: string,
  password: string,
  dstUrl?: string | null
): void {
  const effectiveLink = linkLoginOnly || DEFAULT_ROUTER_LOGIN_URL;
  const loginUrl = routerLoginUrl(effectiveLink, username, password);

  // Strategy 1: Top-level Form POST to RouterOS /login
  // Full-page form submissions from HTTPS to HTTP are allowed by browsers and directly
  // handled by RouterOS Hotspot C binary servlet without requiring custom router templates.
  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = effectiveLink;
    form.target = "_self";
    form.style.display = "none";

    const u = document.createElement("input");
    u.type = "hidden";
    u.name = "username";
    u.value = username;
    form.appendChild(u);

    const p = document.createElement("input");
    p.type = "hidden";
    p.name = "password";
    p.value = password;
    form.appendChild(p);

    if (dstUrl) {
      const dst = document.createElement("input");
      dst.type = "hidden";
      dst.name = "dst";
      dst.value = dstUrl;
      form.appendChild(dst);
    }

    document.body.appendChild(form);
    form.submit();
    return;
  } catch (e) {
    console.error("Direct form POST failed, attempting navigation:", e);
  }

  // Fallback Strategy: Top-level navigation with query parameters (in case custom login.html handles query params)
  try {
    window.location.href = loginUrl;
  } catch (e) {
    console.error("Router navigation failed:", e);
  }
}

export default function HotspotCaptivePortalPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const searchParams = useSearchParams();
  const paramLinkLoginOnly = searchParams.get("link-login-only");
  /** This phone's MAC, put in the sign-in link by the router ($(mac) in the login template). */
  const paramPhoneMac = searchParams.get("mac");
  const paramLinkOrig = searchParams.get("link-orig");
  const paramRouterError = searchParams.get("error");

  const [linkLoginOnly, setLinkLoginOnly] = useState<string | null>(paramLinkLoginOnly);
  const [phoneMac, setPhoneMac] = useState<string | null>(paramPhoneMac);
  const [linkOrig, setLinkOrig] = useState<string | null>(paramLinkOrig);

  useEffect(() => {
    if (paramRouterError) {
      const decoded = decodeURIComponent(paramRouterError);
      setError(decoded);
    }
  }, [paramRouterError]);

  useEffect(() => {
    if (paramLinkLoginOnly) {
      setLinkLoginOnly(paramLinkLoginOnly);
      try { sessionStorage.setItem(REMEMBERED_LINK_LOGIN_PREFIX + tenantSlug, paramLinkLoginOnly); } catch {}
      try { localStorage.setItem(REMEMBERED_LINK_LOGIN_PREFIX + tenantSlug, paramLinkLoginOnly); } catch {}
    } else {
      try {
        const stored = sessionStorage.getItem(REMEMBERED_LINK_LOGIN_PREFIX + tenantSlug) || localStorage.getItem(REMEMBERED_LINK_LOGIN_PREFIX + tenantSlug);
        if (stored) setLinkLoginOnly(stored);
      } catch {}
    }

    if (paramPhoneMac) {
      setPhoneMac(paramPhoneMac);
      try { sessionStorage.setItem(REMEMBERED_MAC_PREFIX + tenantSlug, paramPhoneMac); } catch {}
      try { localStorage.setItem(REMEMBERED_MAC_PREFIX + tenantSlug, paramPhoneMac); } catch {}
    } else {
      try {
        const stored = sessionStorage.getItem(REMEMBERED_MAC_PREFIX + tenantSlug) || localStorage.getItem(REMEMBERED_MAC_PREFIX + tenantSlug);
        if (stored) setPhoneMac(stored);
      } catch {}
    }

    if (paramLinkOrig) {
      setLinkOrig(paramLinkOrig);
      try { sessionStorage.setItem(REMEMBERED_LINK_ORIG_PREFIX + tenantSlug, paramLinkOrig); } catch {}
      try { localStorage.setItem(REMEMBERED_LINK_ORIG_PREFIX + tenantSlug, paramLinkOrig); } catch {}
    } else {
      try {
        const stored = sessionStorage.getItem(REMEMBERED_LINK_ORIG_PREFIX + tenantSlug) || localStorage.getItem(REMEMBERED_LINK_ORIG_PREFIX + tenantSlug);
        if (stored) setLinkOrig(stored);
      } catch {}
    }
  }, [paramLinkLoginOnly, paramPhoneMac, paramLinkOrig, tenantSlug]);

  const queryTheme = searchParams.get("theme") as ThemeId | null;
  const paystackRef = searchParams.get("paystack") || searchParams.get("ref");
  const pesapalRef = searchParams.get("pesapal");

  // Language: what this phone chose last time, else the tenant's default (English until the
  // published plugin config says otherwise). Every theme and sheet below reads `t`.
  const [lang, setLang] = useState<PortalLanguage>("en");
  const langChosen = useRef(false);
  useEffect(() => {
    const stored = loadPortalLanguage();
    if (stored) {
      langChosen.current = true;
      setLang(stored);
    }
  }, []);
  const t = portalStrings(lang);
  const applyTenantDefaultLanguage = (next: PortalLanguage) => {
    if (!langChosen.current) setLang(next);
  };
  const changeLanguage = (next: PortalLanguage) => {
    langChosen.current = true;
    setLang(next);
    savePortalLanguage(next);
  };

  // Active Theme Selection
  const [activeThemeId, setActiveThemeId] = useState<ThemeId>(queryTheme || DEFAULT_THEME_ID);
  const [userSelectedTheme, setUserSelectedTheme] = useState<ThemeId | null>(queryTheme || null);
  const [showThemePicker, setShowThemePicker] = useState(false);

  useEffect(() => {
    if (queryTheme) {
      setActiveThemeId(queryTheme);
      setUserSelectedTheme(queryTheme);
    }
  }, [queryTheme]);

  const handleSelectTheme = (themeId: ThemeId) => {
    setActiveThemeId(themeId);
    setUserSelectedTheme(themeId);
    setShowThemePicker(false);

    // Persist to local preview storage so it sticks across reloads
    try {
      const existing = localStorage.getItem(`${CAPTIVE_PREVIEW_PREFIX}${tenantSlug}`);
      const parsed = existing ? JSON.parse(existing) : {};
      parsed.activeThemeId = themeId;
      localStorage.setItem(`${CAPTIVE_PREVIEW_PREFIX}${tenantSlug}`, JSON.stringify(parsed));
      setLocalConfig(parsed);
    } catch {}

    // Update browser URL with ?theme=... without full page reload
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("theme", themeId);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };

  // Modals
  const [selectedPkg, setSelectedPkg] = useState<HotspotPackage | null>(null);
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTvModal, setShowTvModal] = useState(false);

  // Payment method selection ("MPESA" | "PAYSTACK" | "PESAPAL")
  const [selectedGateway, setSelectedGateway] = useState<"MPESA" | "PAYSTACK" | "PESAPAL">("MPESA");
  const [buyPhone, setBuyPhone] = useState("");
  const [buyEmail, setBuyEmail] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Login results & router handshake
  const [voucherResult, setVoucherResult] = useState<VoucherLoginResult | null>(null);
  const [accountResult, setAccountResult] = useState<AccountLoginResult | null>(null);
  const [completingRouterLogin, setCompletingRouterLogin] = useState(false);
  /** Set when the handoff to the router did not navigate away. Holds the URL to offer as a tap
   *  target, since a user-initiated navigation is allowed where an automatic one may not be. */
  const [stalledLoginUrl, setStalledLoginUrl] = useState<string | null>(null);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverPhone, setRecoverPhone] = useState("");
  const [recoverMessage, setRecoverMessage] = useState("");
  const [recoverError, setRecoverError] = useState<string | null>(null);

  // Force-reconnect: replays a still-valid, previously-accepted voucher code without the
  // customer having to type it again after a WiFi disconnect/reconnect.
  const [rememberedVoucher, setRememberedVoucher] = useState<RememberedVoucher | null>(null);
  const [autoReconnecting, setAutoReconnecting] = useState(false);

  /**
   * Hands off to the router and refuses to spin forever if that handoff does not happen.
   *
   * A successful handoff replaces this page, so nothing below the navigation should ever run.
   * When it does run, the browser declined to leave — and the customer has already PAID, so the
   * one unacceptable outcome is an endless "Authenticating…" with no way out. They get their
   * code and a tap-to-connect link instead, which works because a navigation the user starts is
   * permitted where an automatic one may not be.
   */
  const handOffToRouter = (
    link: string,
    username: string,
    password: string,
    showResultInstead: () => void
  ) => {
    setCompletingRouterLogin(true);
    setStalledLoginUrl(null);
    submitRouterLogin(link, username, password, linkOrig);
    window.setTimeout(() => {
      setCompletingRouterLogin(false);
      setStalledLoginUrl(routerLoginUrl(link, username, password));
      showResultInstead();
    }, 4000);
  };
  const autoReconnectAttempted = useRef(false);

  // M-Pesa / Paystack / Pesapal polling
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const [activePaystackRef, setActivePaystackRef] = useState<string | null>(paystackRef);
  const [activePesapalRef, setActivePesapalRef] = useState<string | null>(pesapalRef);
  const [pollingStatus, setPollingStatus] = useState<"PENDING" | "COMPLETED" | "FAILED" | "CANCELLED" | null>(null);
  // 150s, not 60. Real M-Pesa completion is: the customer notices the push notification, unlocks
  // their phone, and enters their PIN — routinely 20-40s on its own — plus however long Safaricom
  // takes to call our server back, which is not instant and occasionally lags well past a minute
  // under load. A 60s giveup was shorter than the transaction it was timing, so a customer who
  // was simply a little slow to enter their PIN was told "failed" while the payment went through
  // moments later — exactly what showed up as "dashboard says paid, customer sees nothing".
  const POLL_TIMEOUT_SECONDS = 150;
  const [pollCountdown, setPollCountdown] = useState(POLL_TIMEOUT_SECONDS);

  // Contact Support (raises a Ticket for a walk-in customer with no account)
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportName, setSupportName] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSent, setSupportSent] = useState(false);

  const { data: tenant, isLoading: loadingTenant, error: tenantError } = useQuery({
    queryKey: ["hotspot-info", tenantSlug],
    queryFn: () => apiFetch<TenantInfo>(`/api/v1/hotspot/${tenantSlug}/info`, { skipAuth: true }),
    // A tenant that is not open for business answers with a definite code; polling it again
    // will not change the answer.
    retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
  });

  const [localConfig, setLocalConfig] = useState<Partial<TenantInfo> | null>(null);

  // Staff-side branding preview, scoped to ONE tenant. The key used to be a single global
  // "mkg_hotspot_captive_config", written by the dashboard's customizer/settings/themes pages
  // and read here unconditionally — so on any device that had opened a dashboard, one tenant's
  // brand name and support number were rendered on a DIFFERENT tenant's captive portal. It also
  // made the portal's branding depend on the viewer's browser history rather than on the
  // tenant, which is not something anyone can debug from the server side.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${CAPTIVE_PREVIEW_PREFIX}${tenantSlug}`);
      if (raw) setLocalConfig(JSON.parse(raw));
    } catch {}
  }, [tenantSlug]);

  // Sync theme with tenant backend config or localStorage if no query override and no manual selection
  useEffect(() => {
    if (queryTheme || userSelectedTheme) return;
    const themeToUse = localConfig?.activeThemeId || tenant?.activeThemeId;
    if (themeToUse) {
      setActiveThemeId(themeToUse as ThemeId);
    }
  }, [queryTheme, userSelectedTheme, tenant?.activeThemeId, localConfig?.activeThemeId]);

  const { data: liveChat } = useQuery({
    queryKey: ["hotspot-live-chat", tenantSlug],
    queryFn: () => apiFetch<{ show: boolean; widgetId: string | null }>(`/api/v1/hotspot/${tenantSlug}/live-chat`, {
      skipAuth: true,
    }),
    staleTime: 5 * 60 * 1000,
  });

  const submitSupportTicket = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/hotspot/${tenantSlug}/support-ticket`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ name: supportName.trim(), phone: supportPhone.trim() || undefined, message: supportMessage.trim() }),
      }),
    onSuccess: () => {
      setSupportSent(true);
      setSupportName("");
      setSupportPhone("");
      setSupportMessage("");
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : "Failed to send — please try again"),
  });

  const { data: paymentMethods } = useQuery({
    queryKey: ["hotspot-payment-methods", tenantSlug],
    queryFn: () => apiFetch<PaymentMethodsInfo>(`/api/v1/hotspot/${tenantSlug}/payment-methods`, { skipAuth: true }),
  });

  useEffect(() => {
    if (!paymentMethods) return;
    if (paymentMethods.mpesa) setSelectedGateway("MPESA");
    else if (paymentMethods.pesapal) setSelectedGateway("PESAPAL");
    else if (paymentMethods.paystack) setSelectedGateway("PAYSTACK");
  }, [paymentMethods]);

  const { data: packages, isLoading: loadingPackages } = useQuery({
    queryKey: ["hotspot-packages", tenantSlug],
    queryFn: () => apiFetch<HotspotPackage[]>(`/api/v1/hotspot/${tenantSlug}/packages`, { skipAuth: true }),
  });

  const [canDisconnectPrevious, setCanDisconnectPrevious] = useState(false);
  const [pendingVoucherCode, setPendingVoucherCode] = useState<string>("");

  const connectWithVoucher = useMutation({
    mutationFn: (vars?: string | { code?: string; disconnectPrevious?: boolean }) => {
      const codeToUse = typeof vars === "string" ? vars : vars?.code;
      const disconnectPrevious = typeof vars === "object" ? vars?.disconnectPrevious : false;
      const finalCode = (codeToUse ?? voucherCode).trim().toUpperCase();
      return apiFetch<VoucherLoginResult>(`/api/v1/hotspot/${tenantSlug}/login`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ code: finalCode, mac: phoneMac || undefined, disconnectPrevious }),
      });
    },
    onSuccess: (data, vars) => {
      setError(null);
      setCanDisconnectPrevious(false);
      setAutoReconnecting(false);
      const codeToUse = typeof vars === "string" ? vars : vars?.code;
      const finalCode = (codeToUse ?? voucherCode).trim().toUpperCase();
      // Remembered *after* a real Access-Accept, not at purchase time — so force-reconnect only
      // ever replays a code the router has actually already accepted once.
      rememberVoucher(tenantSlug, finalCode, data.expiresAt);
      if (data.expiresAt) setRememberedVoucher({ code: finalCode, expiresAt: data.expiresAt });

      const targetRouterLink = linkLoginOnly || DEFAULT_ROUTER_LOGIN_URL;
      handOffToRouter(targetRouterLink, finalCode, finalCode, () => {
        setVoucherResult(data);
        setShowVoucherModal(false);
        setSelectedPkg(null);
      });
    },
    onError: (err, vars) => {
      setVoucherResult(null);
      setAutoReconnecting(false);
      console.error("Voucher error:", err);
      const codeToUse = typeof vars === "string" ? vars : vars?.code;
      const finalCode = (codeToUse ?? voucherCode).trim().toUpperCase();
      const message =
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? `Connection error: ${err.message}`
            : "Could not connect — please try again";
      setError(message);
      if (message.toLowerCase().includes("another session") || message.toLowerCase().includes("another device")) {
        setCanDisconnectPrevious(true);
        setPendingVoucherCode(finalCode);
      }
      // A rejected/expired/used code has nothing left to auto-retry with — keeping it around
      // would just mean the next disconnect silently fails the same way again.
      if (err instanceof ApiRequestError && !message.toLowerCase().includes("another")) {
        forgetRememberedVoucher(tenantSlug);
      }
    },
  });

  // Load whatever's remembered for this tenant as soon as we're in the browser (SSR has no
  // localStorage), and — the actual force-reconnect — if the router just redirected us here
  // (link-login-only present) with a still-valid remembered code, replay it immediately with no
  // tap required. Runs once per page load; a ref (not state) guards it so it can't refire on
  // every render once linkLoginOnly/tenantSlug settle.
  useEffect(() => {
    const remembered = loadRememberedVoucher(tenantSlug);
    setRememberedVoucher(remembered);
    // Pre-fill the payment number from this device's last purchase. Deliberately does not
    // overwrite anything already typed: this effect also re-runs on tenantSlug changes.
    setBuyPhone((current) => current || loadRememberedPhone(tenantSlug));
    if (paramRouterError) return;
    if (autoReconnectAttempted.current) return;
    if (!remembered) return;
    autoReconnectAttempted.current = true;
    setAutoReconnecting(true);
    connectWithVoucher.mutate(remembered.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, linkLoginOnly, paramRouterError]);

  const forceReconnect = () => {
    if (!rememberedVoucher) return;
    setError(null);
    setAutoReconnecting(true);
    connectWithVoucher.mutate(rememberedVoucher.code);
  };

  // A phone that has paid before, recognised by its MAC on the server, even when this browser has
  // no saved code (captive mini-browsers often keep none). The code never comes to the page.
  const { data: deviceStatus } = useQuery({
    queryKey: ["hotspot-device", tenantSlug, phoneMac],
    queryFn: () =>
      apiFetch<{ canReconnect: boolean; packageName?: string | null; minutesLeft?: number | null; dataLeftMb?: number | null }>(
        `/api/v1/hotspot/${tenantSlug}/devices/${encodeURIComponent(phoneMac!)}/status`,
        { skipAuth: true }
      ),
    enabled: Boolean(phoneMac),
    retry: false,
  });

  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  const macReconnectAttempted = useRef(false);

  /** Asks the router to log this phone in by its MAC; the server accepts only this same phone. */
  const reconnectByMac = () => {
    if (!phoneMac) return;
    const targetRouterLink = linkLoginOnly || DEFAULT_ROUTER_LOGIN_URL;
    setError(null);
    handOffToRouter(targetRouterLink, phoneMac, "", () =>
      setError("This phone couldn't be reconnected automatically. Enter your code, or use “Paid but not connected?”.")
    );
  };

  // A phone the server recognises (it paid before, time or data left) is logged straight back in
  // the moment the portal opens — no tap. The router only puts a MAC in the sign-in link when it
  // is the one showing this page, so a plain browser preview never triggers a hand-off. The
  // "Welcome back" sheet below stays as the fallback for the case where the hand-off stalls.
  useEffect(() => {
    if (!deviceStatus?.canReconnect || rememberedVoucher || !phoneMac) return;
    if (macReconnectAttempted.current) return;
    macReconnectAttempted.current = true;
    reconnectByMac();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceStatus?.canReconnect, rememberedVoucher, phoneMac]);

  /**
   * Recovers a purchase the customer already paid for but never got connected on.
   *
   * On success this behaves exactly like a fresh voucher purchase — the code is remembered and
   * the router hand-off runs — so a stranded customer ends up online rather than merely being
   * shown a code and left to work out what to do with it.
   */
  const recoverPurchase = useMutation({
    mutationFn: () =>
      apiFetch<{ code: string }>(`/api/v1/hotspot/${tenantSlug}/recover`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          phone: recoverPhone.trim() || undefined,
          mpesaMessage: recoverMessage.trim() || undefined,
        }),
      }),
    onSuccess: (data) => {
      setRecoverError(null);
      setShowRecover(false);
      setVoucherCode(data.code);
      // Straight into the normal login path: the code is only useful once it is on the router.
      connectWithVoucher.mutate(data.code);
    },
    onError: (err) =>
      setRecoverError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not find that payment — please try again"
      ),
  });

  const connectWithAccount = useMutation({
    mutationFn: () =>
      apiFetch<AccountLoginResult>(`/api/v1/hotspot/${tenantSlug}/account-login`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ phone: accountPhone.trim(), password: accountPassword }),
      }),
    onSuccess: (data) => {
      setError(null);
      const targetRouterLink = linkLoginOnly || DEFAULT_ROUTER_LOGIN_URL;
      handOffToRouter(targetRouterLink, data.username, accountPassword, () => {
        setAccountResult(data);
        setShowAccountModal(false);
      });
    },
    onError: (err) => {
      setAccountResult(null);
      console.error("Account login error:", err);
      setError(
        err instanceof ApiRequestError
          ? err.message
          : err instanceof Error
            ? `Connection error: ${err.message}`
            : "Could not connect — please try again"
      );
    },
  });

  const initiatePurchase = useMutation({
    mutationFn: () =>
      apiFetch<PurchaseResponse>(`/api/v1/hotspot/${tenantSlug}/purchase`, {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          hotspotPackageId: selectedPkg!.id,
          phone: buyPhone.trim(),
          email: buyEmail.trim() || undefined,
          method: selectedGateway,
          linkLoginOnly: linkLoginOnly ?? undefined,
        }),
      }),
    onSuccess: (data) => {
      setError(null);
      // Remembered only once the gateway has accepted the request, so a typo that never reached
      // a payment provider is not what gets pre-filled on the customer's next visit.
      rememberPhone(tenantSlug, buyPhone.trim());
      if ((data.method === "PAYSTACK" || data.method === "PESAPAL") && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
      if (data.checkoutRequestId) {
        setCheckoutRequestId(data.checkoutRequestId);
        setPollingStatus("PENDING");
        setPollCountdown(POLL_TIMEOUT_SECONDS);
      }
    },
    onError: (err) => {
      console.error("Purchase error:", err);
      setError(err instanceof ApiRequestError ? err.message : "Failed to initiate payment");
    },
  });

  // Paystack Return check
  useEffect(() => {
    if (!activePaystackRef) return;

    let stopped = false;
    const checkPaystack = async () => {
      try {
        const res = await apiFetch<PurchaseStatusResponse>(
          `/api/v1/hotspot/${tenantSlug}/purchase/paystack/${activePaystackRef}/status`,
          { skipAuth: true }
        );
        if (res.status === "COMPLETED" && res.voucherCode && !stopped) {
          connectWithVoucher.mutate(res.voucherCode);
          setActivePaystackRef(null);
        }
      } catch {
        // ignore
      }
    };
    void checkPaystack();
    return () => {
      stopped = true;
    };
  }, [activePaystackRef, tenantSlug, connectWithVoucher]);

  // M-Pesa STK Polling loop
  useEffect(() => {
    if (!checkoutRequestId || pollingStatus !== "PENDING") return;

    const interval = setInterval(async () => {
      try {
        const res = await apiFetch<PurchaseStatusResponse>(
          `/api/v1/hotspot/${tenantSlug}/purchase/${checkoutRequestId}/status`,
          { skipAuth: true }
        );

        if (res.status === "COMPLETED" && res.voucherCode) {
          setPollingStatus("COMPLETED");
          clearInterval(interval);
          connectWithVoucher.mutate(res.voucherCode);
        } else if (res.status === "FAILED" || res.status === "CANCELLED") {
          setPollingStatus(res.status);
          setError(res.resultDesc || (res.status === "CANCELLED" ? "Payment was cancelled on phone." : "Payment failed."));
          clearInterval(interval);
        }
      } catch {
        // continue polling
      }
    }, 2500);

    const countdown = setInterval(() => {
      setPollCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          clearInterval(countdown);

          // The last resort before ever telling the customer "it failed": one direct lookup by
          // the phone number they just paid with. Our own status endpoint above already
          // live-queries Safaricom on every poll, so giving up here does not mean the payment
          // failed — it means WE stopped asking. If Safaricom's callback simply landed a few
          // seconds after our last check (routine under load, or if the customer took a little
          // longer on their PIN than this window), this recovers it silently and connects the
          // customer with no action from them at all — the alternative is a customer staring at
          // "payment timed out" for a payment that the dashboard already shows as received.
          void (async () => {
            try {
              const recovered = await apiFetch<{ code: string }>(
                `/api/v1/hotspot/${tenantSlug}/recover`,
                { method: "POST", skipAuth: true, body: JSON.stringify({ phone: buyPhone.trim() }) }
              );
              setPollingStatus("COMPLETED");
              setVoucherCode(recovered.code);
              connectWithVoucher.mutate(recovered.code);
            } catch {
              // Genuinely still pending, or genuinely failed — either way we have exhausted what
              // this page can check on its own. Point at the always-available recovery button
              // rather than a dead end: a payment that completes even later is not lost, the
              // customer can search for it themselves at any time.
              setPollingStatus("FAILED");
              setError(
                "Still waiting on M-Pesa. If you already entered your PIN, tap “Already paid but not connected?” below — your payment is not lost."
              );
            }
          })();

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdown);
    };
  }, [checkoutRequestId, pollingStatus, tenantSlug, connectWithVoucher, buyPhone]);

  const effectiveThemeId = (userSelectedTheme || localConfig?.activeThemeId || tenant?.activeThemeId || activeThemeId) as ThemeId;
  const SelectedThemeComponent = getThemeComponent(effectiveThemeId);
  // No hardcoded fallback identity. These previously defaulted to one specific ISP's trading
  // name and support number, so ANY tenant who had not filled in their branding showed that
  // company's name and phone number to their own paying customers — telling them to call a
  // competitor for help. An empty string is correct here: the components below already omit a
  // missing support number, and the tenant's registered name is always available from /info.
  const contactPhone = tenant?.phone || localConfig?.phone || tenant?.supportPhone || localConfig?.supportPhone || "";
  const tenantDisplayName = tenant?.brandName || localConfig?.brandName || tenant?.name || "";
  const supportPhoneToUse = tenant?.supportPhone || localConfig?.supportPhone || contactPhone;
  const welcomeTitleToUse = tenant?.welcomeTitle || localConfig?.welcomeTitle || undefined;
  const bannerSubtitleToUse = tenant?.bannerSubtitle || localConfig?.bannerSubtitle || undefined;
  const installationFeeToUse = tenant?.installationFee || localConfig?.installationFee || undefined;
  const fiberRatesToUse = tenant?.fiberRates || localConfig?.fiberRates || undefined;

  // An ISP that is not (or no longer) open: still awaiting platform approval, suspended, or
  // cancelled. Customers on its Wi-Fi land here from the router redirect, so this has to say
  // something a person can act on rather than a spinner or a raw error code.
  if (tenantError instanceof ApiRequestError && ["TENANT_PENDING_APPROVAL", "TENANT_SUSPENDED", "UNAUTHORIZED", "NOT_FOUND"].includes(tenantError.code)) {
    const pending = tenantError.code === "TENANT_PENDING_APPROVAL";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#090d16] p-6 text-center text-white">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-lg font-semibold">{pending ? "This Wi-Fi is not open yet" : "This Wi-Fi is not available"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {pending
              ? "The network operator's account is still being set up. Please try again later, or ask the venue for help."
              : tenantError.code === "NOT_FOUND"
                ? "There is no network at this address. Check the link you were given."
                : "The network operator's account is currently inactive. Please ask the venue for help."}
          </p>
        </div>
      </div>
    );
  }

  // Prevent old "classic-dark" build from flashing before tenant's real theme is loaded
  if (loadingTenant && !tenant && !localConfig && !queryTheme && !userSelectedTheme) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center p-6 text-white text-center">
        <div className="h-12 w-12 rounded-full border-4 border-sky-500/20 border-t-sky-400 animate-spin mb-4" />
        <p className="text-base font-bold tracking-wide text-white">Connecting to Wi-Fi…</p>
        <p className="text-xs text-slate-400 mt-1">Directing you to your branded portal…</p>
      </div>
    );
  }

  const themeMeta = getThemeMeta(effectiveThemeId);
  const openRecover = () => {
    setShowRecover(true);
    setRecoverError(null);
  };
  const openSupport = () => {
    setSupportSent(false);
    setShowSupportModal(true);
  };

  return (
    <CaptivePortalPluginContainer
      tenantSlug={tenantSlug}
      activeVoucherCode={voucherResult ? voucherCode : rememberedVoucher?.code}
      voucherExpiresAt={voucherResult?.expiresAt || rememberedVoucher?.expiresAt}
      voucherDataCapMb={voucherResult?.dataCapMb}
      isAuthenticating={completingRouterLogin || autoReconnecting}
      appearance={themeMeta.appearance ?? "dark"}
      language={lang}
      onLanguageChange={changeLanguage}
      onPublishedDefaultLanguage={applyTenantDefaultLanguage}
      onVoucherCodeApplied={(scanned) => {
        setVoucherCode(scanned);
        setShowVoucherModal(true);
      }}
    >
      <div className="relative min-h-screen">
        {liveChat?.show && <TawkToWidget widgetId={liveChat.widgetId} />}

        {/* Theme switcher — development preview only (?themePicker=true). */}
        {searchParams.get("themePicker") === "true" && (
          <div className="fixed right-2 top-2 z-50">
            <button
              type="button"
              onClick={() => setShowThemePicker((v) => !v)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow"
            >
              Theme: {effectiveThemeId}
            </button>
            {showThemePicker && (
              <div className="absolute right-0 mt-2 w-60 space-y-0.5 rounded-2xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl">
                {THEME_CATALOG.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => handleSelectTheme(theme.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left ${
                      effectiveThemeId === theme.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>{theme.name}</span>
                    {effectiveThemeId === theme.id && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* One tap from online, but the browser wouldn't hand off to the router by itself. */}
        {stalledLoginUrl && (
          <PortalSheet title={t.paymentReceived} description={t.oneLastTap} zIndex="z-[100]">
            <a href={stalledLoginUrl} className={`${sheetPrimary} block bg-emerald-600 text-center hover:bg-emerald-700`}>
              {t.connectMeNow}
            </a>
            <button type="button" onClick={() => setStalledLoginUrl(null)} className={`${sheetSecondary} mt-2`}>
              {t.showCodeInstead}
            </button>
          </PortalSheet>
        )}

        {showRecover && (
          <PortalSheet
            title={t.getConnected}
            description={t.getConnectedDesc}
            onClose={() => setShowRecover(false)}
            zIndex="z-[110]"
          >
            <label htmlFor="recoverPhone" className={sheetLabel}>
              {t.phonePaidWith}
            </label>
            <input
              id="recoverPhone"
              inputMode="tel"
              placeholder="07XX XXX XXX"
              value={recoverPhone}
              onChange={(e) => setRecoverPhone(e.target.value)}
              className={sheetInput}
            />
            <div className="my-3 flex items-center gap-2 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {t.orPasteMessage}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <textarea
              rows={3}
              placeholder="TGH7ABC123 Confirmed. Ksh10.00 sent to…"
              value={recoverMessage}
              onChange={(e) => setRecoverMessage(e.target.value)}
              className={`${sheetInput} text-sm`}
            />
            {recoverError && (
              <div className="mt-3">
                <SheetError>{recoverError}</SheetError>
              </div>
            )}
            <button
              type="button"
              disabled={recoverPurchase.isPending || (!recoverPhone.trim() && !recoverMessage.trim())}
              onClick={() => recoverPurchase.mutate()}
              className={`${sheetPrimary} mt-4`}
            >
              {recoverPurchase.isPending ? t.lookingForPayment : t.connectMe}
            </button>
            <button type="button" onClick={() => setShowRecover(false)} className={`${sheetSecondary} mt-2`}>
              {t.cancel}
            </button>
          </PortalSheet>
        )}

        {/* Another device connected warning banner */}
        {error && canDisconnectPrevious && (
          <div className="fixed inset-x-4 top-4 z-[999] mx-auto max-w-md rounded-2xl bg-amber-500 p-4 text-white shadow-2xl">
            <p className="font-semibold text-sm">{error}</p>
            <p className="mt-1 text-xs text-amber-100">Another device is currently using this voucher. Tap below to disconnect that device and connect this phone.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => connectWithVoucher.mutate({ code: pendingVoucherCode || voucherCode, disconnectPrevious: true })}
                className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-amber-900 shadow hover:bg-amber-50"
              >
                Disconnect & Connect Here
              </button>
              <button
                type="button"
                onClick={() => { setCanDisconnectPrevious(false); setError(null); }}
                className="rounded-xl bg-amber-700/60 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Back online in one tap with the still-valid code from last time. */}
        {rememberedVoucher && !completingRouterLogin && (
          <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2">
            <button
              type="button"
              onClick={forceReconnect}
              disabled={autoReconnecting || connectWithVoucher.isPending}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60"
            >
              {autoReconnecting || connectWithVoucher.isPending ? t.reconnecting : t.reconnectWithCode}
            </button>
          </div>
        )}

        {/* Back online in one tap: this phone has paid before and still has time left. */}
        {deviceStatus?.canReconnect && !rememberedVoucher && !completingRouterLogin && !reconnectDismissed && macReconnectAttempted.current && (
          <PortalSheet
            title={t.welcomeBack}
            description={
              [
                deviceStatus.packageName,
                deviceStatus.minutesLeft != null
                  ? `${deviceStatus.minutesLeft >= 120 ? `${Math.floor(deviceStatus.minutesLeft / 60)} h` : `${deviceStatus.minutesLeft} min`} ${t.left}`
                  : null,
                deviceStatus.dataLeftMb != null
                  ? `${deviceStatus.dataLeftMb >= 1024 ? `${(deviceStatus.dataLeftMb / 1024).toFixed(1)} GB` : `${deviceStatus.dataLeftMb} MB`} ${t.ofDataLeft}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || t.packageStillActive
            }
            onClose={() => setReconnectDismissed(true)}
          >
            <button type="button" onClick={reconnectByMac} className={sheetPrimary}>
              {t.reconnect}
            </button>
            <button type="button" onClick={() => setReconnectDismissed(true)} className={`${sheetSecondary} mt-2`}>
              {t.notNow}
            </button>
          </PortalSheet>
        )}

        {autoReconnecting && !completingRouterLogin && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-6">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-600 border-t-transparent" aria-hidden="true" />
              <p className="text-base font-semibold text-slate-900">{t.reconnectingYou}</p>
              <p className="mt-1 text-sm text-slate-500">{t.usingLastCode}</p>
            </div>
          </div>
        )}

        {completingRouterLogin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
              </div>
              <p className="text-xl font-bold text-slate-900">{t.activatingInternet}</p>
              <p className="mt-2 text-sm text-slate-600">
                {t.paymentConnecting}
              </p>
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 py-1.5 px-3 rounded-full">
                <span>✓ {t.verified}</span> · <span>{t.automaticLogin}</span>
              </div>
            </div>
          </div>
        )}

        <SelectedThemeComponent
          tenantSlug={tenantSlug}
          tenantName={tenantDisplayName}
          contactPhone={contactPhone}
          supportPhone={supportPhoneToUse}
          welcomeTitle={welcomeTitleToUse}
          bannerSubtitle={bannerSubtitleToUse}
          installationFee={installationFeeToUse}
          fiberRates={fiberRatesToUse}
          logoUrl={tenant?.logoUrl}
          brandColor={tenant?.brandColor}
          packages={packages}
          loadingPackages={loadingPackages}
          onSelectPackage={(pkg) => {
            setSelectedPkg(pkg);
            setError(null);
          }}
          onOpenVoucherModal={() => {
            setShowVoucherModal(true);
            setError(null);
          }}
          onOpenAccountModal={() => {
            setShowAccountModal(true);
            setError(null);
          }}
          onOpenTvModal={() => setShowTvModal(true)}
          onOpenRecover={openRecover}
          onOpenSupport={openSupport}
          voucherResult={voucherResult}
          accountResult={accountResult}
          completingRouterLogin={completingRouterLogin}
          t={t}
        />

        {/* Themes that don't show help themselves get one slim bar, and room at the bottom so it
            never covers their packages. */}
        {!themeMeta.inlineHelp && (
          <>
            <div className="h-20" aria-hidden="true" />
            <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 border-t border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] [color-scheme:light]">
              <button type="button" onClick={openRecover} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {t.paidNotConnectedShort}
              </button>
              <button type="button" onClick={openSupport} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                {t.help}
              </button>
            </div>
          </>
        )}

        {/* Buy a package */}
        {selectedPkg && (
          <PortalSheet onClose={pollingStatus === "PENDING" ? undefined : () => setSelectedPkg(null)}>
            {pollingStatus === "COMPLETED" ? (
              <div className="py-2 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">{t.paymentConfirmed}</h2>
                <p className="mt-1 text-sm text-slate-600">{t.connectingNow}</p>
                {voucherCode && (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-center">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Your Voucher Code</p>
                    <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-emerald-950">{voucherCode}</p>
                    <p className="mt-1 text-xs text-emerald-700">Saved to this device. If your phone doesn't connect automatically, enter this code on the Wi-Fi sign-in screen.</p>
                  </div>
                )}
              </div>
            ) : pollingStatus === "PENDING" ? (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                  <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-emerald-600 border-t-transparent" aria-hidden="true" />
                </div>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">{t.checkYourPhone}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.enterPinToPay} <span className="font-semibold text-slate-900">{formatPriceKsh(selectedPkg.priceMinor)}</span> {t.from}{" "}
                  <span className="font-semibold text-slate-900">{buyPhone}</span>.
                </p>
                <p className="mt-2 text-xs text-slate-400">{t.waitingForConfirmation} · {pollCountdown}s</p>
                <button
                  type="button"
                  className={`${sheetPrimary} mt-4`}
                  onClick={async () => {
                    try {
                      const res = await apiFetch<PurchaseStatusResponse>(`/api/v1/hotspot/${tenantSlug}/purchase/${checkoutRequestId}/status`, {
                        skipAuth: true,
                      });
                      if (res.status === "COMPLETED" && res.voucherCode) {
                        setPollingStatus("COMPLETED");
                        connectWithVoucher.mutate(res.voucherCode);
                      } else if (res.status === "FAILED" || res.status === "CANCELLED") {
                        setPollingStatus(res.status);
                        setError(res.resultDesc || "Payment failed.");
                      }
                    } catch {
                      // Polling continues in the background.
                    }
                  }}
                >
                  {t.enteredPin}
                </button>
                <button
                  type="button"
                  className={`${sheetSecondary} mt-2`}
                  onClick={() => {
                    setCheckoutRequestId(null);
                    setPollingStatus(null);
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  initiatePurchase.mutate();
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">{t.youAreBuying}</p>
                    <h2 className="text-lg font-semibold text-slate-900">{selectedPkg.name}</h2>
                  </div>
                  <p className="text-xl font-semibold tabular-nums text-slate-900">{formatPriceKsh(selectedPkg.priceMinor)}</p>
                </div>
                {appOnlyNotice(selectedPkg.appPolicy) && (
                  <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                    {appOnlyNotice(selectedPkg.appPolicy)}
                  </p>
                )}

                {[paymentMethods?.mpesa, paymentMethods?.pesapal, paymentMethods?.paystack].filter(Boolean).length > 1 && (
                  <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="group" aria-label={t.paymentMethod}>
                    {(
                      [
                        ["MPESA", "M-Pesa", paymentMethods?.mpesa],
                        ["PESAPAL", "Pesapal", paymentMethods?.pesapal],
                        ["PAYSTACK", t.card, paymentMethods?.paystack],
                      ] as const
                    )
                      .filter(([, , enabled]) => enabled)
                      .map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={selectedGateway === id}
                          onClick={() => setSelectedGateway(id)}
                          className={`rounded-lg py-2 font-medium ${selectedGateway === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                        >
                          {label}
                        </button>
                      ))}
                  </div>
                )}

                <label htmlFor="buyPhone" className={`${sheetLabel} mt-4`}>
                  {selectedGateway === "MPESA" ? t.mpesaNumber : t.phoneNumber}
                </label>
                <input
                  id="buyPhone"
                  autoFocus
                  type="tel"
                  inputMode="tel"
                  placeholder="0712 345 678"
                  value={buyPhone}
                  onChange={(e) => setBuyPhone(e.target.value)}
                  className={sheetInput}
                  required
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  {selectedGateway === "MPESA"
                    ? t.mpesaHint
                    : selectedGateway === "PESAPAL"
                    ? t.pesapalHint
                    : t.paystackHint}
                </p>

                {(selectedGateway === "PAYSTACK" || selectedGateway === "PESAPAL") && (
                  <>
                    <label htmlFor="buyEmail" className={`${sheetLabel} mt-4`}>
                      {t.email} {selectedGateway === "PESAPAL" && <span className="font-normal text-slate-400">{t.optional}</span>}
                    </label>
                    <input
                      id="buyEmail"
                      type="email"
                      placeholder="you@example.com"
                      value={buyEmail}
                      onChange={(e) => setBuyEmail(e.target.value)}
                      className={sheetInput}
                      required={selectedGateway === "PAYSTACK"}
                    />
                  </>
                )}

                {error && (
                  <div className="mt-3">
                    <SheetError>{error}</SheetError>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={initiatePurchase.isPending || !buyPhone || (selectedGateway === "PAYSTACK" && !buyEmail.trim())}
                  className={`${sheetPrimary} mt-5 ${selectedGateway === "MPESA" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                >
                  {initiatePurchase.isPending
                    ? t.sending
                    : selectedGateway === "PESAPAL"
                    ? t.continueToPesapal
                    : selectedGateway === "PAYSTACK"
                    ? t.continueToCard
                    : t.payWithMpesa(formatPriceKsh(selectedPkg.priceMinor))}
                </button>
                <button type="button" className={`${sheetSecondary} mt-2`} onClick={() => setSelectedPkg(null)}>
                  {t.cancel}
                </button>
              </form>
            )}
          </PortalSheet>
        )}

        {/* Voucher code */}
        {showVoucherModal && (
          <PortalSheet title={t.enterYourVoucher} description={t.voucherDesc} onClose={() => setShowVoucherModal(false)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                connectWithVoucher.mutate();
              }}
            >
              <input
                autoFocus
                aria-label={t.voucherCode}
                placeholder="e.g. 9PMLTXCY"
                autoCapitalize="characters"
                autoComplete="off"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                className={`${sheetInput} text-center font-mono text-xl tracking-[0.2em]`}
                required
              />
              {error && (
                <div className="mt-3">
                  <SheetError>{error}</SheetError>
                </div>
              )}
              {canDisconnectPrevious && (
                <button
                  type="button"
                  onClick={() => connectWithVoucher.mutate({ code: pendingVoucherCode || voucherCode, disconnectPrevious: true })}
                  className={`${sheetPrimary} mt-3 bg-amber-600 hover:bg-amber-700`}
                >
                  Disconnect Previous Device & Connect
                </button>
              )}
              <button type="submit" disabled={connectWithVoucher.isPending || !voucherCode} className={`${sheetPrimary} mt-4`}>
                {connectWithVoucher.isPending ? t.connecting : t.connect}
              </button>
              <button type="button" className={`${sheetSecondary} mt-2`} onClick={() => setShowVoucherModal(false)}>
                {t.cancel}
              </button>
            </form>
          </PortalSheet>
        )}

        {/* Subscriber account */}
        {showAccountModal && (
          <PortalSheet title={t.accountLogin} description={t.accountLoginDesc} onClose={() => setShowAccountModal(false)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                connectWithAccount.mutate();
              }}
            >
              <label htmlFor="accountPhone" className={sheetLabel}>
                {t.phoneNumber}
              </label>
              <input
                id="accountPhone"
                autoFocus
                inputMode="tel"
                placeholder="0712 345 678"
                value={accountPhone}
                onChange={(e) => setAccountPhone(e.target.value)}
                className={sheetInput}
                required
              />
              <label htmlFor="accountPassword" className={`${sheetLabel} mt-3`}>
                {t.password}
              </label>
              <input
                id="accountPassword"
                type="password"
                value={accountPassword}
                onChange={(e) => setAccountPassword(e.target.value)}
                className={sheetInput}
                required
              />
              {error && (
                <div className="mt-3">
                  <SheetError>{error}</SheetError>
                </div>
              )}
              <button type="submit" disabled={connectWithAccount.isPending || !accountPhone || !accountPassword} className={`${sheetPrimary} mt-4`}>
                {connectWithAccount.isPending ? t.signingIn : t.signInAndConnect}
              </button>
              <button type="button" className={`${sheetSecondary} mt-2`} onClick={() => setShowAccountModal(false)}>
                {t.cancel}
              </button>
            </form>
          </PortalSheet>
        )}

        {/* TV / console */}
        {showTvModal && (
          <PortalSheet
            title={t.connectTv}
            description={t.connectTvDesc}
            onClose={() => setShowTvModal(false)}
          >
            <button type="button" className={sheetPrimary} onClick={() => setShowTvModal(false)}>
              {t.gotIt}
            </button>
          </PortalSheet>
        )}

        {/* Contact support */}
        {showSupportModal && (
          <PortalSheet
            title={supportSent ? t.messageSent : t.contactSupport}
            description={supportSent ? t.weWillGetBack : t.tellUsWhatsWrong}
            onClose={() => setShowSupportModal(false)}
          >
            {supportSent ? (
              <button type="button" className={sheetPrimary} onClick={() => setShowSupportModal(false)}>
                {t.close}
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  submitSupportTicket.mutate();
                }}
              >
                <label htmlFor="supportName" className={sheetLabel}>
                  {t.yourName}
                </label>
                <input id="supportName" value={supportName} onChange={(e) => setSupportName(e.target.value)} className={sheetInput} required />
                <label htmlFor="supportPhone" className={`${sheetLabel} mt-3`}>
                  {t.phoneNumber} <span className="font-normal text-slate-400">{t.optional}</span>
                </label>
                <input
                  id="supportPhone"
                  inputMode="tel"
                  placeholder="0712 345 678"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  className={sheetInput}
                />
                <label htmlFor="supportMessage" className={`${sheetLabel} mt-3`}>
                  {t.whatsTheProblem}
                </label>
                <textarea
                  id="supportMessage"
                  rows={3}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className={`${sheetInput} text-sm`}
                  required
                />
                {error && (
                  <div className="mt-3">
                    <SheetError>{error}</SheetError>
                  </div>
                )}
                <button type="submit" disabled={submitSupportTicket.isPending} className={`${sheetPrimary} mt-4`}>
                  {submitSupportTicket.isPending ? t.sending : t.sendMessageButton}
                </button>
                <button type="button" className={`${sheetSecondary} mt-2`} onClick={() => setShowSupportModal(false)}>
                  {t.cancel}
                </button>
              </form>
            )}
          </PortalSheet>
        )}
      </div>
    </CaptivePortalPluginContainer>
  );
}
