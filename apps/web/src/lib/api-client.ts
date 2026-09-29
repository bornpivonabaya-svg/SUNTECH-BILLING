export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    // 1. Local development on loopback
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return `${window.location.protocol}//localhost:4000`;
    }
    // 2. Direct LAN / Raw IP access
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:4000`;
    }
    // 3. Explicit non-localhost NEXT_PUBLIC_API_URL if configured
    if (process.env.NEXT_PUBLIC_API_URL) {
      try {
        const configuredUrl = new URL(process.env.NEXT_PUBLIC_API_URL, window.location.origin);
        if (configuredUrl.hostname !== "localhost" && configuredUrl.hostname !== "127.0.0.1") {
          return process.env.NEXT_PUBLIC_API_URL;
        }
      } catch {
        // fallback to dynamic domain resolution
      }
    }
    // 4. Any public domain (mashuphost.tech, app.mashuphost.tech, mash.mashuphost.tech) -> isp.suntechke.com
    const parts = window.location.hostname.split(".");
    const baseDomain = parts.slice(-2).join(".");
    return `${window.location.protocol}//api.${baseDomain}`;
  }

  // Server-side (inside Next.js Node container)
  if (process.env.INTERNAL_API_URL) {
    return process.env.INTERNAL_API_URL;
  }
  if (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes("localhost")) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  return "http://api:4000";
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export class ApiRequestError extends Error {
  code: string;
  status: number;
  requestId: string;
  details?: unknown;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = "ApiRequestError";
    this.code = body.error.code;
    this.status = status;
    this.requestId = body.error.requestId;
    this.details = body.error.details;
  }
}

let accessToken: string | null = null;

/** Access tokens live only in memory (never localStorage) — a full page reload silently
 *  re-acquires one from the httpOnly refresh cookie via AuthProvider's bootstrap refresh. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function doFetch<T>(path: string, options: RequestInit & { skipAuth?: boolean }): Promise<T> {
  const headers = new Headers(options.headers);
  // Only declare JSON content when there actually is a body — Fastify's JSON body parser
  // rejects Content-Type: application/json on a request with an empty body
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which is exactly what every bodyless POST (refresh, logout)
  // was hitting: a real 400 from a body-parsing mismatch that had nothing to do with cookies,
  // easy to misdiagnose as a cookie/session bug because the symptom (401-adjacent failures
  // right after register/login) looks identical.
  if (typeof options.body === "string" && options.body.length > 0) {
    headers.set("Content-Type", "application/json");
  }
  if (!options.skipAuth && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const baseUrl = getApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    // The browser never reached the server: offline, DNS, a blocked origin. Say that plainly
    // instead of leaking "Failed to fetch" into every form on the page.
    throw new ApiRequestError(0, {
      success: false,
      error: { code: "NETWORK_ERROR", message: "Can't reach the server. Check your internet connection and try again.", requestId: "offline" },
    });
  }

  if (response.status === 204) {
    return {} as T;
  }

  const body = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;

  if (!response.ok || !body || body.success === false) {
    if (body && body.success === false) throw new ApiRequestError(response.status, body);
    throw new ApiRequestError(response.status, {
      success: false,
      error: { code: "UNKNOWN_ERROR", message: response.statusText || "Request failed", requestId: "unknown" },
    });
  }

  return body.data;
}

// Every caller shares one in-flight refresh, same reasoning as AuthProvider's own
// inFlightRefresh: a background poll and a user-triggered action can both hit a 401 within
// milliseconds of each other, and the refresh token rotates on every use — the loser of two
// concurrent refresh() calls would otherwise get a genuine 400 from an already-rotated cookie,
// not a recoverable retry.
let inFlightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const result = await doFetch<{ accessToken: string }>("/api/v1/auth/refresh", {
        method: "POST",
        skipAuth: true,
      });
      accessToken = result.accessToken;
      return accessToken;
    } catch {
      accessToken = null;
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

/**
 * A 15-minute access token expiring mid-session is routine, not exceptional — a staff member
 * reading a script and walking over to a router, or any background poll (the "link a router"
 * wizard's wait-for-callback loop, live session refresh, etc.), can easily outlast it. Without
 * retrying here, every one of those call sites would need its own refresh-and-retry logic, and
 * a silent `.catch(() => {})` around a poll (a legitimate pattern for "router isn't reachable
 * yet") would otherwise swallow "the token expired" identically to "still waiting" forever —
 * exactly the failure mode that let this go unnoticed until real hardware testing surfaced it.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  try {
    return await doFetch<T>(path, options);
  } catch (err) {
    const isExpiredToken =
      err instanceof ApiRequestError && err.status === 401 && !options.skipAuth && accessToken !== null;
    if (!isExpiredToken) throw err;

    const refreshed = await refreshAccessToken();
    if (!refreshed) throw err;

    return doFetch<T>(path, options);
  }
}
