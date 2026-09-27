import { resolveCname, resolveNs, resolve4 } from "node:dns/promises";

/**
 * Custom domains without guesswork for the ISP: we look up who runs the domain's DNS (from its
 * nameservers), show that company's own steps and a link straight to its DNS page, and check the
 * record ourselves until it's live.
 */

export interface DnsProvider {
  id: string;
  name: string;
  /** The company's site; the dashboard shows its icon. */
  site: string;
  /** Brand colour for the fallback badge when the icon can't load. */
  color: string;
  /** Deep link to the domain's DNS records, where the company has one. `{domain}` is replaced. */
  dnsUrl: string | null;
  /** Where to click, in the company's own words, to reach the DNS records. */
  steps: string[];
  /** What the company calls the "Host"/"Name" field and what to type for the root domain. */
  hostField: string;
  rootHost: string;
  /** Extra advice specific to this company (e.g. Cloudflare's proxy). */
  note?: string;
  /** Nameserver suffixes that identify this company. */
  ns: RegExp;
}

const generic = (menu: string) => [`Sign in and open your domain list.`, `Open the domain, then ${menu}.`, `Add a new record with the values below and save.`];

export const DNS_PROVIDERS: DnsProvider[] = [
  {
    id: "namecheap",
    name: "Namecheap",
    site: "namecheap.com",
    color: "#de3723",
    dnsUrl: "https://ap.www.namecheap.com/domains/domaincontrolpanel/{domain}/advancedns",
    steps: ["Sign in to Namecheap and go to Domain List.", "Click Manage next to the domain, then the Advanced DNS tab.", "Under Host Records click Add New Record, pick CNAME Record, fill in the values below and click the green tick."],
    hostField: "Host",
    rootHost: "@",
    ns: /registrar-servers\.com$|namecheaphosting\.com$/,
  },
  {
    id: "godaddy",
    name: "GoDaddy",
    site: "godaddy.com",
    color: "#1bdbdb",
    dnsUrl: "https://dcc.godaddy.com/control/dnsmanagement?domainName={domain}",
    steps: ["Sign in to GoDaddy and open My Products.", "Next to the domain click DNS (Manage DNS).", "Click Add New Record, choose type CNAME, fill in the values below and Save."],
    hostField: "Name",
    rootHost: "@",
    ns: /domaincontrol\.com$/,
  },
  {
    id: "hostinger",
    name: "Hostinger",
    site: "hostinger.com",
    color: "#673de6",
    dnsUrl: "https://hpanel.hostinger.com/domain/{domain}/dns",
    steps: ["Sign in to hPanel and open Domains.", "Click Manage on the domain, then DNS / Nameservers.", "Under Manage DNS records choose type CNAME, fill in the values below and click Add Record."],
    hostField: "Name",
    rootHost: "@",
    ns: /dns-parking\.com$|hostinger\.[a-z.]+$/,
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    site: "cloudflare.com",
    color: "#f38020",
    dnsUrl: "https://dash.cloudflare.com/?to=/:account/{domain}/dns/records",
    steps: ["Sign in to Cloudflare and pick the domain.", "Open DNS > Records and click Add record.", "Choose type CNAME, fill in the values below, set Proxy status to DNS only (grey cloud) and Save."],
    hostField: "Name",
    rootHost: "@",
    note: "Keep the cloud grey (DNS only). With the orange cloud on, Cloudflare answers instead of us and the secure certificate can't be issued.",
    ns: /ns\.cloudflare\.com$/,
  },
  {
    id: "truehost",
    name: "Truehost",
    site: "truehost.co.ke",
    color: "#0a58ca",
    dnsUrl: null,
    steps: ["Sign in to the Truehost client area and open Domains > My Domains.", "Click the domain, then Manage DNS (DNS Management).", "Add a CNAME record with the values below and save."],
    hostField: "Host Name",
    rootHost: "@",
    ns: /truehost\.[a-z.]+$|truehostcloud\.com$/,
  },
  {
    id: "hostpinnacle",
    name: "HostPinnacle",
    site: "hostpinnacle.co.ke",
    color: "#e4032e",
    dnsUrl: null,
    steps: ["Sign in to the HostPinnacle client area and open Domains > My Domains.", "Choose the domain, then Manage DNS.", "Add a CNAME record with the values below and save."],
    hostField: "Host Name",
    rootHost: "@",
    ns: /hostpinnacle\.[a-z.]+$/,
  },
  {
    id: "kenyawebexperts",
    name: "Kenya Web Experts",
    site: "kenyawebexperts.com",
    color: "#0b7a3e",
    dnsUrl: null,
    steps: generic("Manage DNS"),
    hostField: "Host",
    rootHost: "@",
    ns: /kenyawebexperts\.com$|kwe\.co\.ke$/,
  },
  {
    id: "hostafrica",
    name: "HostAfrica",
    site: "hostafrica.co.ke",
    color: "#f7931e",
    dnsUrl: null,
    steps: generic("DNS Management"),
    hostField: "Host",
    rootHost: "@",
    ns: /hostafrica\.[a-z.]+$/,
  },
  {
    id: "bluehost",
    name: "Bluehost",
    site: "bluehost.com",
    color: "#3060e4",
    dnsUrl: null,
    steps: ["Sign in to Bluehost and open Domains.", "Click Manage next to the domain, then the DNS tab.", "Under CNAME click Add Record, fill in the values below and Save."],
    hostField: "Host Record",
    rootHost: "@",
    ns: /bluehost\.com$/,
  },
  {
    id: "hostgator",
    name: "HostGator",
    site: "hostgator.com",
    color: "#ffcf00",
    dnsUrl: null,
    steps: generic("DNS / Zone Editor"),
    hostField: "Host",
    rootHost: "@",
    ns: /hostgator\.com$/,
  },
  {
    id: "squarespace",
    name: "Squarespace (Google Domains)",
    site: "squarespace.com",
    color: "#111111",
    dnsUrl: "https://account.squarespace.com/domains/managed/{domain}/dns/dns-settings",
    steps: ["Sign in to Squarespace Domains and pick the domain.", "Open DNS > DNS Settings.", "Under Custom records click Add record, choose CNAME, fill in the values below and Save."],
    hostField: "Host",
    rootHost: "@",
    ns: /googledomains\.com$|squarespacedns\.com$/,
  },
  {
    id: "route53",
    name: "Amazon Route 53",
    site: "aws.amazon.com",
    color: "#8c4fff",
    dnsUrl: "https://console.aws.amazon.com/route53/v2/hostedzones",
    steps: ["Open Route 53 > Hosted zones and pick the domain.", "Click Create record.", "Choose record type CNAME, fill in the values below and Create records."],
    hostField: "Record name",
    rootHost: "(leave empty)",
    ns: /awsdns-\d+\.[a-z.]+$/,
  },
  {
    id: "digitalocean",
    name: "DigitalOcean",
    site: "digitalocean.com",
    color: "#0080ff",
    dnsUrl: "https://cloud.digitalocean.com/networking/domains/{domain}",
    steps: ["Open Networking > Domains and pick the domain.", "Choose CNAME in Create new record.", "Fill in the values below and Create Record."],
    hostField: "Hostname",
    rootHost: "@",
    ns: /digitalocean\.com$/,
  },
  {
    id: "namesilo",
    name: "NameSilo",
    site: "namesilo.com",
    color: "#002d62",
    dnsUrl: "https://www.namesilo.com/account_domain_manage_dns.php?domain={domain}",
    steps: ["Sign in to NameSilo and open Domain Manager.", "Click the blue globe (Manage DNS) next to the domain.", "Click CNAME at the top, fill in the values below and Submit."],
    hostField: "Hostname",
    rootHost: "(leave empty)",
    ns: /dnsowl\.com$/,
  },
  {
    id: "porkbun",
    name: "Porkbun",
    site: "porkbun.com",
    color: "#ef7878",
    dnsUrl: "https://porkbun.com/account/domainsSpeedy",
    steps: ["Sign in to Porkbun and open Domain Management.", "Click DNS next to the domain.", "Choose type CNAME, fill in the values below and Add."],
    hostField: "Host",
    rootHost: "(leave empty)",
    ns: /porkbun\.com$/,
  },
  {
    id: "ionos",
    name: "IONOS",
    site: "ionos.com",
    color: "#003d8f",
    dnsUrl: null,
    steps: generic("DNS"),
    hostField: "Host name",
    rootHost: "@",
    ns: /ui-dns\.[a-z]+$/,
  },
  {
    id: "wix",
    name: "Wix",
    site: "wix.com",
    color: "#0c6efc",
    dnsUrl: null,
    steps: ["Open Domains in your Wix account.", "Click the ⋯ next to the domain, then Manage DNS Records.", "Under CNAME click + Add Record, fill in the values below and Save."],
    hostField: "Host Name",
    rootHost: "(leave empty)",
    ns: /wixdns\.net$/,
  },
];

export const UNKNOWN_PROVIDER: Omit<DnsProvider, "ns"> = {
  id: "other",
  name: "Your domain company",
  site: "",
  color: "#64748b",
  dnsUrl: null,
  steps: generic("find DNS, DNS Management or Zone Editor"),
  hostField: "Host / Name",
  rootHost: "@",
};

export function providerFromNameservers(nameservers: string[]): Omit<DnsProvider, "ns"> | null {
  const names = nameservers.map((n) => n.toLowerCase().replace(/\.$/, ""));
  const hit = DNS_PROVIDERS.find((p) => names.some((n) => p.ns.test(n)));
  if (!hit) return null;
  const { ns: _ns, ...rest } = hit;
  return rest;
}

/** The zone that holds this hostname's records (the nearest name with nameservers) and them. */
export async function findZone(hostname: string, lookupNs: (name: string) => Promise<string[]> = resolveNs): Promise<{ zone: string; nameservers: string[] } | null> {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    try {
      const ns = await lookupNs(name);
      if (ns.length) return { zone: name, nameservers: ns };
    } catch {
      // No nameservers at this level (a subdomain) — try the parent.
    }
  }
  return null;
}

export interface DomainSetupPlan {
  hostname: string;
  zone: string | null;
  nameservers: string[];
  provider: Omit<DnsProvider, "ns">;
  detected: boolean;
  /** The records to add, in the provider's own field names: one CNAME, or for a root domain
   *  (where most companies can't hold a CNAME) A records to the platform's addresses. */
  records: Array<{ type: "CNAME" | "A"; host: string; value: string; ttl: string }>;
  isRoot: boolean;
  dnsUrl: string | null;
}

export async function planDomainSetup(
  hostname: string,
  target: string,
  lookup: { ns?: (name: string) => Promise<string[]>; a?: (name: string) => Promise<string[]> } = {}
): Promise<DomainSetupPlan> {
  const found = await findZone(hostname, lookup.ns);
  const detectedProvider = found ? providerFromNameservers(found.nameservers) : null;
  const provider = detectedProvider ?? UNKNOWN_PROVIDER;
  const zone = found?.zone ?? null;
  const isRoot = zone !== null && hostname === zone;
  const host = zone && !isRoot ? hostname.slice(0, -(zone.length + 1)) : provider.rootHost;
  const ttl = "Automatic (or 5 minutes)";
  let records: DomainSetupPlan["records"] = [{ type: "CNAME", host, value: target, ttl }];
  // Cloudflare flattens a root CNAME; everyone else needs the addresses themselves.
  if (isRoot && provider.id !== "cloudflare") {
    const ips = await (lookup.a ?? resolve4)(target).catch(() => [] as string[]);
    if (ips.length) records = ips.map((ip) => ({ type: "A" as const, host, value: ip, ttl }));
  }
  const dnsUrl = provider.dnsUrl ? (provider.dnsUrl.includes("{domain}") ? (zone ? provider.dnsUrl.replace("{domain}", zone) : null) : provider.dnsUrl) : null;
  return { hostname, zone, nameservers: found?.nameservers ?? [], provider, detected: detectedProvider !== null, records, isRoot, dnsUrl };
}

export type DomainCheck = { ok: true; via: "CNAME" | "A" } | { ok: false; reason: string };

/** Is the hostname pointing at us? A CNAME to the tenant's platform address, or (for a root
 *  domain, where most companies can't set a CNAME, or Cloudflare's flattening) the same IPv4
 *  addresses as that platform address. */
export async function checkDomainPointsTo(
  hostname: string,
  target: string,
  dns: { cname?: (name: string) => Promise<string[]>; a?: (name: string) => Promise<string[]> } = {}
): Promise<DomainCheck> {
  const cname = dns.cname ?? ((n: string) => resolveCname(n));
  const a = dns.a ?? ((n: string) => resolve4(n));
  const norm = (h: string) => h.toLowerCase().replace(/\.$/, "");
  let cnames: string[] = [];
  try {
    cnames = await cname(hostname);
  } catch {
    // no CNAME; the A-record comparison below decides
  }
  if (cnames.some((c) => norm(c) === norm(target))) return { ok: true, via: "CNAME" };
  if (cnames.length) return { ok: false, reason: `It points to ${cnames.join(", ")}; it should point to ${target}.` };

  const [mine, theirs] = await Promise.all([a(hostname).catch(() => [] as string[]), a(target).catch(() => [] as string[])]);
  if (mine.length && theirs.length && mine.every((ip) => theirs.includes(ip))) return { ok: true, via: "A" };
  if (mine.length) return { ok: false, reason: `It points to ${mine.join(", ")}; it should be a CNAME to ${target}.` };
  return { ok: false, reason: `No record for ${hostname} yet. DNS changes usually show within minutes, sometimes up to a few hours.` };
}

/** The address a tenant's custom domain must point at: their own platform subdomain. */
export function domainTarget(tenantSlug: string, baseDomain: string): string {
  return `${tenantSlug}.${baseDomain}`.toLowerCase();
}
