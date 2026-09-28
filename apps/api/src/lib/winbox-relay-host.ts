import { lookup as dnsLookup } from "node:dns/promises";

type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/**
 * Where operators point WinBox for the relay, found automatically:
 *  1. the override (WINBOX_RELAY_PUBLIC_HOST), when set;
 *  2. winbox.<the platform's domain> (winbox.mashuphost.tech), when it already points at the same
 *     server as the API — true wherever the domain has the DNS-only "*" record the deployment
 *     guide sets up, so nobody adds anything;
 *  3. the API's own name (api.mashuphost.tech, DNS-only, straight to this server);
 *  4. the fallback (the VPN endpoint).
 * Never the bare domain: it sits behind Cloudflare's proxy, which carries web traffic only. The
 * answer is cached for 10 minutes.
 */
let cache: { key: string; host: string; at: number } | null = null;

export async function winboxRelayHost(
  opts: { override?: string; apiUrl?: string; fallback: string },
  lookup: Lookup = systemLookup,
  now = Date.now()
): Promise<string> {
  if (opts.override) return opts.override;
  const key = `${opts.apiUrl}|${opts.fallback}`;
  if (cache && cache.key === key && now - cache.at < 10 * 60_000) return cache.host;

  let apiHost = "";
  try {
    apiHost = opts.apiUrl ? new URL(opts.apiUrl).hostname : "";
  } catch {
    // not a URL: use the fallback
  }
  let host = opts.fallback;
  if (apiHost && apiHost !== "localhost" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(apiHost)) {
    host = apiHost;
    const labels = apiHost.split(".");
    const candidate = `winbox.${labels.length > 2 ? labels.slice(1).join(".") : apiHost}`;
    try {
      const [api, winbox] = await Promise.all([lookup(apiHost), lookup(candidate)]);
      if (winbox.length > 0 && winbox.every((a) => api.includes(a))) host = candidate;
    } catch {
      // winbox.<domain> doesn't resolve: the API's name it is
    }
  }
  cache = { key, host, at: now };
  return host;
}

/** For tests: forget the cached answer. */
export function resetWinboxRelayHostCache(): void {
  cache = null;
}
