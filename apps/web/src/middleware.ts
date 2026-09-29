import { NextResponse, type NextRequest } from "next/server";

/**
 * Narrowly scoped on purpose — only the pre-authentication entry points a hostname-aware visitor
 * would actually land on. Never touches /api, /_next, static assets, the dashboard, or the
 * hotspot portal: those either don't need hostname resolution (dashboard pages are scoped by the
 * authenticated user's own JWT tenantId, completely independent of hostname) or already have
 * their own explicit tenant identity (hotspot's [tenantSlug] path param).
 */
export const config = {
  matcher: ["/", "/login", "/register"],
};

const API_BASE_URL =
  process.env.INTERNAL_API_URL ??
  (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes("localhost")
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://api:4000");

/** Loopback/plain-IP access has nothing to resolve — skip the extra fetch on every single local
 *  dev page load. A spoofed Host header in a test request (e.g. `curl -H "Host: foo.bar" ...`)
 *  is unaffected by this check: it only ever sees the literal Host *header* value, which is
 *  exactly what a real hostname-routed request would have. */
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Resolves the incoming Host header to a tenant slug via the public /api/v1/domains/resolve
 * endpoint (checks both the automatic `{slug}.{PLATFORM_BASE_DOMAIN}` pattern and verified
 * custom domains — see apps/api/src/routes/domains.ts) and, when found, rewrites the request to
 * the matching page with `?tenant={slug}` so it can be pre-filled — the tenant's own domain stays
 * visible in the address bar throughout (a rewrite, not a redirect). This is a UX convenience
 * only, never an authorization decision: real tenant isolation for authenticated requests is
 * already enforced server-side by the JWT's own tenantId, completely independent of this.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get("host");
  if (!host) return NextResponse.next();

  const hostname = host.split(":")[0]!.toLowerCase();
  if (isLocalHost(hostname)) return NextResponse.next();

  // If request arrives on captive portal domain, route directly to hotspot sign-in
  if (hostname.startsWith("captive.")) {
    const url = request.nextUrl.clone();
    // Only with an ISP named in the link: never show some other ISP's sign-in page.
    const tenant = url.searchParams.get("tenant");
    if (tenant && (url.pathname === "/" || url.pathname === "/login")) {
      url.pathname = `/hotspot/${tenant}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  let tenantSlug: string | null = null;
  try {
    const resolveUrl = `${API_BASE_URL}/api/v1/domains/resolve?host=${encodeURIComponent(hostname)}`;
    const res = await fetch(resolveUrl);
    if (res.ok) {
      const body = (await res.json()) as { data?: { tenantSlug?: string } };
      tenantSlug = body.data?.tenantSlug ?? null;
    }
  } catch {
    // API unreachable — fail open (no rewrite), same as an unrecognized host would.
  }

  if (!tenantSlug) return NextResponse.next();

  const url = request.nextUrl.clone();
  if (url.pathname === "/") {
    url.pathname = "/login";
    url.searchParams.set("tenant", tenantSlug);
    return NextResponse.rewrite(url);
  }
  if ((url.pathname === "/login" || url.pathname === "/register") && !url.searchParams.has("tenant")) {
    url.searchParams.set("tenant", tenantSlug);
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}
