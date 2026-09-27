import type { RadiusNas, Router } from "@mashupkgrid/database";
import { buildAppFilterSection } from "@mashupkgrid/network";

/** Strips characters that would let a router's (staff-editable) `name` break out of the RouterOS
 *  comment/string it's interpolated into below, or out of the `{ }`-delimited client block in the
 *  generated FreeRADIUS clients.conf snippet — a name containing a newline, quote, or brace would
 *  otherwise let whoever named the router inject arbitrary lines into a script another person
 *  (an ops admin pasting the FreeRADIUS snippet, or whoever runs the RouterOS script) trusts and
 *  runs verbatim. */
function sanitizeForScript(value: string): string {
  return value.replace(/[^\w .-]/g, "").trim() || "router";
}

/** Every third-party host an unauthenticated hotspot client must reach BEFORE it can pay and
 *  log in. Derived from what packages/payments actually calls, not guesswork:
 *
 *  - Safaricom / M-Pesa (packages/payments/src/mpesa) — the STK push itself is server-to-server,
 *    but the customer's own M-Pesa confirmation and any Daraja-hosted fallback page are not.
 *  - Paystack (packages/payments/src/paystack) — the customer is redirected to Paystack's hosted
 *    checkout, which pulls scripts from js.paystack.co and short-links through pstk.it.
 *  - Pesapal (packages/payments/src/pesapal) — same pattern, hosted checkout on pay.pesapal.com.
 *  - The 3-D Secure step-up hosts. A card payment that passes checkout but cannot reach its
 *    issuer's ACS silently fails at the last step, which reads to the customer as "the payment
 *    hung" — the single most confusing failure in a captive portal, since they have no way to
 *    reach a support page either.
 *
 *  Wildcards throughout: every one of these is CDN-fronted with rotating addresses, so pinning
 *  exact hosts is what breaks the moment a provider re-points a record. */
export const PAYMENT_GATEWAY_WALLED_GARDEN_HOSTS = [
  "*.safaricom.co.ke",
  "*.paystack.com",
  "*.paystack.co",
  "*.pstk.it",
  "*.pesapal.com",
  "*.visa.com",
  "*.mastercard.com",
  "*.cardinalcommerce.com",
  "*.modirum.com",
] as const;

/** RouterOS splits the walled garden across two menus and BOTH are needed.
 *  `/ip hotspot walled-garden` is the HTTP-proxy-level menu: it can match a Host header, but only
 *  for plain HTTP. `/ip hotspot walled-garden ip` is the packet-level menu, and it is the only
 *  one that lets an HTTPS connection through — without an entry there the hotspot intercepts the
 *  TLS connection and the client gets ERR_CONNECTION_CLOSED rather than a login page. Every
 *  host this platform cares about is HTTPS-only, so each name is emitted to both menus (note the
 *  differing action verbs: `allow` in the first, `accept` in the second).
 *
 *  A bare IP goes in as `dst-address` — passing one as `dst-host` makes RouterOS try, and fail,
 *  to resolve it as a name. Dev deployments hand this an IP; production hands it a domain.
 *
 *  All entries are commented "MASHUPKGRID" so the script can clear exactly its own rules on a
 *  re-run without touching anything an operator added by hand. */
function walledGardenLines(hosts: readonly string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const host of hosts) {
    if (!host || seen.has(host)) continue;
    seen.add(host);

    // Every line is wrapped: /import stops at the first command RouterOS rejects, and a stop here
    // used to skip everything after it — the login page, the heartbeat and the VPN — leaving a
    // router that linked once and then went silent.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      lines.push(`:do {/ip hotspot walled-garden ip add dst-address=${host} action=accept comment="MASHUPKGRID"} on-error={}`);
      continue;
    }
    lines.push(`:do {/ip hotspot walled-garden add dst-host=${host} action=allow comment="MASHUPKGRID"} on-error={}`);
    // The IP walled garden resolves dst-host to addresses and does not take wildcards; the HTTP
    // walled garden above already covers "*." names.
    if (!host.includes("*")) {
      lines.push(`:do {/ip hotspot walled-garden ip add dst-host=${host} action=accept comment="MASHUPKGRID"} on-error={}`);
    }
  }
  return lines.join("\n");
}

/** Hostname out of a config URL, tolerating a value that is already a bare host. */
function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;
  }
}

/** Two-part public suffixes this platform actually meets. Kenya is the primary market (see the
 *  Tenant model's KES/Africa-Nairobi defaults) where "acme.co.ke" is the registrable domain, not
 *  "co.ke" — getting that wrong would emit a "*.co.ke" walled-garden rule, opening the hotspot
 *  to an entire country's namespace. Not a full public-suffix list, and deliberately so: an
 *  unlisted suffix falls back to the last two labels, which is merely narrower than ideal
 *  (a redundant exact-host entry) rather than dangerously wide. */
const MULTI_PART_TLDS = new Set([
  "co.ke", "or.ke", "ne.ke", "ac.ke", "go.ke", "sc.ke", "me.ke", "mobi.ke", "info.ke",
  "co.tz", "co.ug", "co.rw", "co.za", "org.za", "com.ng", "com.gh", "co.zm", "co.zw",
  "co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "com.br", "co.in",
]);

/** The registrable domain — "api.mashuphost.tech" and "portal.acme.co.ke" reduce to
 *  "mashuphost.tech" and "acme.co.ke" respectively. */
function registrableDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const labelCount = MULTI_PART_TLDS.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-labelCount).join(".");
}

/** A host plus one wildcard covering its registrable domain. The exact host alone is not enough:
 *  a portal behind a CDN (mashuphost.tech sits behind Cloudflare) pulls assets and API calls from
 *  sibling names, and a tenant's own domain usually answers on both the apex and www. The
 *  wildcard is anchored at the registrable domain rather than the host, so "api.example.com"
 *  contributes "*.example.com" — a useful rule — instead of "*.api.example.com", which would
 *  match nothing anyone visits. An IP is returned as-is; it has no subdomains. */
function hostWithSubdomains(host: string): string[] {
  if (!host) return [];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return [host];
  return [host, `*.${registrableDomain(host)}`];
}

/** Blocks a customer re-sharing their paid session over their own phone hotspot or travel router.
 *
 *  Detection is by TTL, which is the only signal a router actually has. A packet from the paying
 *  device arrives with its operating system's default TTL — 64 on Android/iOS/Linux, 128 on
 *  Windows. When that device re-routes for someone else, the second device's packets pass through
 *  it and arrive one hop lower: 63, or 127. Dropping those catches sharing without touching the
 *  customer who paid.
 *
 *  It is a heuristic, and honestly so:
 *    - A customer whose own device legitimately sits behind a router (a travel router in a hotel
 *      room, some MiFi units) is blocked even though only one person is using it.
 *    - An operating system with a non-standard default TTL is misjudged in either direction.
 *    - Anyone who knows this exists can set their TTL to 65 and defeat it in one command.
 *  So it raises the cost of casual sharing — which is nearly all of it — rather than stopping a
 *  determined person. That is why it is opt-in per router: an operator turns it on where sharing
 *  is actually costing them, and leaves it off where a wrongly-blocked customer is worse. */
export const ANTI_TETHER_COMMENT = "MASHUPKGRID ANTI-TETHER";

function buildAntiTetheringSection(enabled: boolean): string {
  return antiTetheringRules(enabled).join("\n");
}

/**
 * The rules, in the mangle table's prerouting chain. Prerouting sees a packet's TTL exactly as the
 * customer's device sent it (64 from their phone, 63 from a device sharing through it); the filter
 * table's forward chain sees it after the router has already taken one off, so matching 63 there
 * dropped every phone's own traffic — customers were "logged in" with nothing loading. Here a
 * shared packet's TTL is set to 1, so the router discards it instead of forwarding it, and the
 * paying device is never touched.
 *
 * Also clears the old forward-chain rules, from routers set up before this changed.
 */
export function antiTetheringRules(globalOn: boolean): string[] {
  const rule = (match: string, ttl: number) =>
    `/ip firewall mangle add chain=prerouting ${match} ttl=equal:${ttl} action=change-ttl new-ttl=set:1 passthrough=no comment="${ANTI_TETHER_COMMENT}"`;
  const ttls = [63, 127, 254];
  return [
    `# 10. Anti-tethering: ${globalOn ? "every signed-in hotspot device, plus packages that ask for it" : "only packages that ask for it (via their RADIUS address list)"}.`,
    `/ip firewall filter remove [find comment="${ANTI_TETHER_COMMENT}"]`,
    `/ip firewall mangle remove [find comment="${ANTI_TETHER_COMMENT}"]`,
    ...(globalOn ? ttls.map((t) => rule("hotspot=auth", t)) : []),
    ...ttls.map((t) => rule(`src-address-list="mashup-anti-tether"`, t)),
    `:put "Anti-tethering rules in place (shared connections blocked, the paying device untouched)"`,
  ];
}

/** Standalone script to install or refresh the per-app package filter on an existing router. */
export function buildSocialFirewallOnlyScript(opts: { portalHosts?: string[] } = {}): string {
  return `# MASHUPKGRID ISP — per-app packages (TikTok only, YouTube only, …)
# Paste this into your MikroTik terminal:

${buildAppFilterSection({ portalHosts: opts.portalHosts })}

:put "Per-app package filtering is active."
`;
}

/** The PPPoE server half of a router's setup.
 *
 *  Emitted only when an interface is configured. PPPoE is not defaulted the way the hotspot is:
 *  a hotspot safely binds the LAN bridge, whereas a PPPoE server needs to face the subscribers
 *  specifically — a port, or a VLAN trunk — and it hands out addresses from a pool. Inventing an
 *  addressing plan for someone's live network is how you collide with their existing subnets, so
 *  a router with no PPPoE configuration gets no PPPoE section rather than a guess.
 *
 *  Without this the router authenticates PPPoE against RADIUS correctly and still cannot accept
 *  a single subscriber, because nothing is listening for PPPoE discovery — exactly the failure
 *  the hotspot had before `/ip hotspot add` was restored. */
function buildPppoeSection(
  iface?: string | null,
  gatewayIp?: string | null,
  poolRange?: string | null
): string {
  if (!iface) {
    return `# 8. PPPoE — not configured for this router. Hotspot works without it; if you sell
#    PPPoE/fibre subscriptions, set the PPPoE interface and address range on the router in the
#    dashboard and re-run this script. RADIUS is already wired for PPP, so only the server
#    itself is missing.`;
  }

  const gateway = gatewayIp || "10.10.0.1";
  const range = poolRange || "10.10.0.2-10.10.255.254";

  return `# 8. PPPoE Server. RADIUS already knows how to authenticate these subscribers (step 4);
#    this is the part that listens for them. Each line is idempotent and self-contained, so a
#    re-run updates rather than duplicates.
/ip pool remove [find name=mkg-pppoe-pool]
/ip pool add name=mkg-pppoe-pool ranges=${range}
/ppp profile remove [find name=mkg-pppoe]
/ppp profile add name=mkg-pppoe local-address=${gateway} remote-address=mkg-pppoe-pool
# The subscriber's speed comes from RADIUS per account (Mikrotik-Rate-Limit), not from this
# profile — the profile only supplies the addressing, so one profile serves every package.
/interface pppoe-server server remove [find service-name=mkg-pppoe]
/interface pppoe-server server add service-name=mkg-pppoe interface=${iface} default-profile=mkg-pppoe one-session-per-host=yes disabled=no
:put "PPPoE server listening on ${iface}, subscribers get ${range}"`;
}

/** Builds the one paste-and-run script a "Link a router" wizard needs before it knows anything
 *  about the router's address: it enables the RouterOS API, creates the dedicated user/password
 *  this platform generated (so no one ever types API credentials into the dashboard), and calls
 *  the platform back so `Router.host` gets filled in from the request's own source address —
 *  see completeRouterProvisioning in @mashupkgrid/network. `/tool fetch`'s exact syntax is
 *  broadly compatible across RouterOS v6.45+ and v7.x; older releases may need `mode=https`
 *  swapped for `mode=http` or the flag renamed, hence the router.useTls branch below. */
export function buildMikrotikProvisioningScript(
  router: Router,
  credentials: { username: string; password: string },
  callbackUrl: string,
  options: {
    radiusHost?: string;
    radiusSecret?: string;
    managementSource?: string;
    /** The platform's WireGuard subnet; allowed to reach the API and WinBox (remote WinBox relay). */
    vpnSubnet?: string;
    serverPublicKey?: string;
    serverHost?: string;
    serverPort?: number;
    vpnIp?: string;
    loginTemplateUrl?: string;
    hotspotInterface?: string;
    /** Existing IP pool the hotspot hands addresses from — deliberately reusing the interface's
     *  current DHCP pool rather than creating a second one on the same subnet. */
    addressPool?: string;
    /** Host of the branded captive-portal page the router's login.html redirects to (the web
     *  app, which is a different host from the API in every deployment) — it MUST be in the
     *  walled garden or an unauthenticated client can never load the page it was redirected to,
     *  which looks exactly like "the captive portal doesn't display". */
    portalHost?: string;
    /** Every additional hostname this tenant's own customers may be sent to — their verified
     *  custom domains (the Domain model). A tenant on a white-label domain has a portal that is
     *  NOT on portalHost, so without these the redirect lands on a host the hotspot is still
     *  blocking and the customer sees a connection error instead of a login page. */
    portalDomains?: string[];
    /** Hosts a super admin allowed platform-wide (PlatformWalledGardenHost), already validated
     *  by packages/network normalizeWalledGardenHost. Added verbatim: an IP goes to the IP menu,
     *  a name to both, exactly like the built-in entries. */
    extraWalledGardenHosts?: string[];
    /** PPPoE server settings. Omitted entirely when `pppoeInterface` is absent — see the step 8
     *  comment in the generated script for why this is opt-in rather than defaulted. */
    pppoeInterface?: string | null;
    pppoeGatewayIp?: string | null;
    pppoePoolRange?: string | null;
    /** See buildAntiTetheringSection — opt-in because TTL detection has real false positives. */
    blockTethering?: boolean;
    /** Physical ports running the Hotspot captive portal. Defaults to ["ether2", "ether3", "ether4", "wlan1"]. */
    hotspotPorts?: string[];
    /** Dedicated non-hotspot direct LAN port (e.g. "ether4" or "ether5") with no captive portal. */
    lanPort?: string | null;
    /** RouterOS major version the ISP chose when adding the router (null: detect on the router).
     *  v6 gets no WireGuard section and its own NTP syntax; either way the script warns in the
     *  router's log if the router turns out to run the other version. */
    routerOsMajor?: number | null;
  } = {}
): string {
  const apiLine = router.useTls
    ? `/ip service set api-ssl disabled=no port=${router.apiPort}`
    : `/ip service set api disabled=no port=${router.apiPort}`;

  const safeName = sanitizeForScript(router.name);
  const radiusHost = options.radiusHost || "68.210.187.104";
  // Defaults to the router's own generated password, and completeRouterProvisioning (in
  // @mashupkgrid/network) registers the RadiusNas row with exactly this value when the callback
  // below lands. The embedded RADIUS server matches a NAS by source IP and verifies with that
  // stored secret, so if this default is changed here it MUST be changed there too — a mismatch
  // makes every Access-Request fail with no reply, which the captive portal shows the user as
  // "Already authorizing, retry later".
  const radiusSecret = options.radiusSecret || credentials.password;
  const managementSource = options.managementSource?.trim();
  const vpnSubnet = options.vpnSubnet?.trim() || DEFAULT_VPN_SUBNET;
  const serverHost = options.serverHost || "68.210.187.104";
  const serverPort = options.serverPort || 51820;
  const serverPublicKey = options.serverPublicKey || "";
  const vpnIp = options.vpnIp || "10.90.0.2";
  const osMajor = options.routerOsMajor === 6 || options.routerOsMajor === 7 ? options.routerOsMajor : null;
  const versionSection = buildVersionSection(osMajor);
  const ntpLines = buildNtpLines(osMajor);
  // WireGuard is v7-only: a router the ISP says runs v6 doesn't get the (guarded) section at all.
  const wireguardSection = serverPublicKey && osMajor !== 6
    ? `
# Optional management VPN (RouterOS v7+). This is deliberately last: a legacy or low-resource
# hAP must still finish hotspot provisioning even when WireGuard is unavailable.
${deferred(`/interface wireguard remove [find name=mkg-wg]
/interface wireguard add name=mkg-wg listen-port=${serverPort}
:delay 2s
/ip address remove [find interface=mkg-wg]
/ip address add address=${vpnIp}/32 interface=mkg-wg
:local routerPublicKey [/interface wireguard get [find name=mkg-wg] public-key]
/tool fetch url="${callbackUrl}" http-method=post http-data=$routerPublicKey keep-result=no
:delay 2s
/interface wireguard peers remove [find interface=mkg-wg]
/interface wireguard peers add interface=mkg-wg public-key="${serverPublicKey}" endpoint-address="${serverHost}" endpoint-port=${serverPort} allowed-address=${vpnSubnet} persistent-keepalive=25s`)}
`
    :"";
  const hotspotInterface = options.hotspotInterface || "bridge";
  // "bridge" / "default-dhcp" are the names MikroTik's own defconf ships with, so they are right
  // on a factory-reset router; the DHCP-derived fallback in the script covers everything else.
  const addressPool = options.addressPool || "default-dhcp";
  const antiTetheringSection = buildAntiTetheringSection(options.blockTethering === true);
  const pppoeSection = buildPppoeSection(
    options.pppoeInterface,
    options.pppoeGatewayIp,
    options.pppoePoolRange
  );
  const loginTemplateUrl = options.loginTemplateUrl || "https://api.mashuphost.tech/api/v1/hotspot/demo-isp/mikrotik-login-template";
  // The "you're online" page shown after a successful sign-in, served next to the login page.
  const aloginTemplateUrl = aloginUrlFor(loginTemplateUrl);
  const apiHost = hostFromUrl(loginTemplateUrl);
  const portalHost = options.portalHost ? hostFromUrl(options.portalHost) : "captive.mashuphost.tech";
  // App-only customers must still reach the portal (to buy full internet) and the API behind it.
  const appFilterSection = buildAppFilterSection({ portalHosts: [...new Set([portalHost, apiHost])] });
  // Order matters only for readability of the generated script; walledGardenLines de-dupes.
  // The tenant's own domains come before the gateways so an operator reading the script sees
  // "my portal is reachable" first — that is the entry they most often need to check.
  const walledGardenHosts = [
    serverHost,
    "captive.mashuphost.tech",
    ...hostWithSubdomains(apiHost),
    ...hostWithSubdomains(portalHost),
    ...hostWithSubdomains("mashuphost.tech"),
    ...(options.portalDomains ?? []).flatMap((d) => hostWithSubdomains(hostFromUrl(d))),
    ...PAYMENT_GATEWAY_WALLED_GARDEN_HOSTS,
    ...(options.extraWalledGardenHosts ?? []),
  ];

  const rawHotspotPorts = (options.hotspotPorts && options.hotspotPorts.length > 0)
    ? options.hotspotPorts
    : ["ether2", "ether3", "ether4", "wlan1"];
  const lanPort = options.lanPort?.trim() || null;
  const pppoeIface = options.pppoeInterface?.trim() || null;

  // Filter out any port explicitly assigned to direct LAN, PPPoE, or WAN (ether1)
  let activeHotspotPorts = rawHotspotPorts.filter(
    (p) => p !== lanPort && p !== pppoeIface && p !== "ether1"
  );
  if (activeHotspotPorts.length === 0) {
    activeHotspotPorts = ["ether2", "ether3"];
  }

  // Always bridge wireless radios (wlan1, wifi1) if present and not assigned to LAN / PPPoE
  const wirelessInterfaces = ["wlan1", "wifi1"].filter(
    (w) => w !== lanPort && w !== pppoeIface && !activeHotspotPorts.includes(w)
  );

  const allBridgePorts = [...activeHotspotPorts, ...wirelessInterfaces];

  const bridgePortLines = allBridgePorts
    .map((port) => `:do {/interface bridge port add bridge=bridge interface=${port}} on-error={}`)
    .join("\n");

  const cleanupExcludedPorts = [lanPort, pppoeIface]
    .filter(Boolean)
    .map((port) => `:do {/interface bridge port remove [find interface=${port}]} on-error={}`)
    .join("\n");

  const directLanSection = lanPort
    ? `
# Direct LAN / Non-Hotspot port (${lanPort}) — No Captive Portal, No Voucher required
:do {/ip address remove [find interface=${lanPort} comment="MASHUPKGRID DIRECT LAN"]} on-error={}
:do {/ip address add address=192.168.99.1/24 interface=${lanPort} comment="MASHUPKGRID DIRECT LAN"} on-error={}
:do {/ip pool remove [find name=mkg-direct-lan-pool]} on-error={}
:do {/ip pool add name=mkg-direct-lan-pool ranges=192.168.99.10-192.168.99.254} on-error={}
:do {/ip dhcp-server remove [find name=mkg-direct-dhcp]} on-error={}
:do {/ip dhcp-server add name=mkg-direct-dhcp interface=${lanPort} address-pool=mkg-direct-lan-pool disabled=no} on-error={}
:do {/ip dhcp-server network remove [find comment="MASHUPKGRID DIRECT LAN"]} on-error={}
:do {/ip dhcp-server network add address=192.168.99.0/24 gateway=192.168.99.1 dns-server=192.168.99.1 comment="MASHUPKGRID DIRECT LAN"} on-error={}
:put "Direct LAN active on ${lanPort} (192.168.99.1/24) — No Voucher Required"`
    : "";

  const minimalProvisioningScript = `# MASHUPKGRID ISP - safe baseline setup for "${safeName}"
# The router must already have WAN internet access for this file to download.
${versionSection}
:do {/tool fetch url="${callbackUrl}" http-method=post keep-result=no} on-error={}

# The platform's management account comes first, before anything that can drop the session
# running this script — without it the router is linked but can never be managed.
:do {/user remove [find name=${credentials.username}]} on-error={}
:do {/user add name=${credentials.username} group=full password="${credentials.password}"} on-error={}

# WAN first: ether1 is the internet port. Re-enable it, take it out of the LAN bridge if an earlier
# setup put it there (a bridged ether1 leaves its DHCP client "Interface not active"), and make
# sure its DHCP client is on — otherwise nothing below can reach the platform.
:do {/interface ethernet set [find default-name=ether1] disabled=no} on-error={}
:do {/interface bridge port remove [find interface=ether1]} on-error={}
:do {/ip dhcp-client enable [find interface=ether1]} on-error={}
# DNS: take the upstream's servers and keep public ones as a fallback. Without working DNS every
# walled-garden entry below waits on a lookup, the router stalls, and it can't resolve the portal.
:do {/ip dhcp-client set [find interface=ether1] use-peer-dns=yes} on-error={}
:do {/ip dns set servers=1.1.1.1,8.8.8.8} on-error={}

# LAN, Wi-Fi and WAN baseline. Existing configurations are preserved when present.
:do {/interface bridge add name=bridge} on-error={}
${cleanupExcludedPorts ? `${cleanupExcludedPorts}\n` : ""}${bridgePortLines}
:do {/ip dhcp-client add interface=ether1 disabled=no add-default-route=yes use-peer-dns=yes} on-error={}
:do {/ip address add address=192.168.88.1/24 interface=bridge} on-error={}
:do {/ip pool add name=default-dhcp ranges=192.168.88.10-192.168.88.254} on-error={}
:do {/ip dhcp-server add name=mkg-dhcp interface=bridge address-pool=default-dhcp disabled=no} on-error={}
:do {/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1} on-error={}
:do {/ip dns set allow-remote-requests=yes} on-error={}
:do {/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="MASHUPKGRID"} on-error={}
${directLanSection ? `${directLanSection}\n` : ""}

# Management API and account.
:do {${apiLine}} on-error={}
${buildManagementAccessSection(managementSources({ managementSource, vpnSubnet }), router.apiPort, router.useTls)}

# RADIUS and captive portal.
# Replace every RADIUS server a previous setup added (tagged), so a router re-linked to another
# server doesn't keep asking the old one first — each dead entry costs every login its timeout.
:do {/radius remove [find comment="MASHUPKGRID"]} on-error={}
:do {/radius remove [find address="${radiusHost}"]} on-error={}
:do {/radius add service=ppp,hotspot address=${radiusHost} secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3s comment="MASHUPKGRID"} on-error={}
:do {/ppp aaa set use-radius=yes accounting=yes interim-update=1m} on-error={}
# login-by=mac first: a phone that has paid is logged straight back in by the RADIUS server
# (findMacLogin) when it reconnects, without seeing the sign-in page at all.
:do {/ip hotspot profile set [find] use-radius=yes login-by=mac,http-chap,http-pap,cookie mac-auth-mode=mac-as-username trial=no radius-accounting=yes radius-interim-update=1m html-directory=hotspot} on-error={}
:do {/ip hotspot set [find interface=bridge] profile=default disabled=no} on-error={}
:do {/ip hotspot reset-html} on-error={}
:do {/ip hotspot user profile set [find default=yes] shared-users=1} on-error={}
:do {/ip hotspot remove [find name=mkg-hotspot]} on-error={}
:do {/ip hotspot add name=mkg-hotspot interface=bridge address-pool=default-dhcp profile=default disabled=no} on-error={}
:do {/ip hotspot walled-garden remove [find comment="MASHUPKGRID"]} on-error={}
:do {/ip hotspot walled-garden ip remove [find comment="MASHUPKGRID"]} on-error={}
${walledGardenLines(walledGardenHosts)}
:do {/tool fetch url="${loginTemplateUrl}" dst-path=hotspot/login.html check-certificate=no} on-error={}
:do {/tool fetch url="${loginTemplateUrl}" dst-path=flash/hotspot/login.html check-certificate=no} on-error={}
:do {/tool fetch url="${aloginTemplateUrl}" dst-path=hotspot/alogin.html check-certificate=no} on-error={}
:do {/tool fetch url="${aloginTemplateUrl}" dst-path=flash/hotspot/alogin.html check-certificate=no} on-error={}

# Self-repair for the branded login page: if hotspot/login.html is ever missing (a setup cut short,
# a reset of the hotspot folder), customers get MikroTik's stock sign-in page instead of the portal.
:do {/system scheduler remove [find name=mkg-portal-page]} on-error={}
:do {/system scheduler add name=mkg-portal-page interval=5m on-event=":if ([:len [/file find name=\\"hotspot/login.html\\"]] = 0 && [:len [/file find name=\\"flash/hotspot/login.html\\"]] = 0) do={:do {/ip hotspot reset-html} on-error={}; :do {/tool fetch url=\\"${loginTemplateUrl}\\" dst-path=hotspot/login.html check-certificate=no} on-error={}; :do {/tool fetch url=\\"${loginTemplateUrl}\\" dst-path=flash/hotspot/login.html check-certificate=no} on-error={}; :do {/tool fetch url=\\"${aloginTemplateUrl}\\" dst-path=hotspot/alogin.html check-certificate=no} on-error={}; :do {/tool fetch url=\\"${aloginTemplateUrl}\\" dst-path=flash/hotspot/alogin.html check-certificate=no} on-error={}}"} on-error={}

# Persistent check-in, once a minute. It fetches the platform's small report script into memory
# (never onto flash) and runs it: CPU, memory, disk, temperature, uptime, users — see
# buildHeartbeatScript. If that fails for any reason, it still checks in plainly, so the router
# never shows Offline because of the report. Survives reboots and is safe to re-run.
:do {/system scheduler remove [find name=mkg-heartbeat]} on-error={}
:do {/system scheduler add name=mkg-heartbeat interval=1m on-event="${heartbeatOnEvent(callbackUrl)}"} on-error={}

# Automated NTP Time Synchronization
:do {/system clock set time-zone-autodetect=yes time-zone-name=Africa/Nairobi} on-error={}
${ntpLines}

${pppoeSection}

${antiTetheringSection}

${wireguardSection}

# Per-app packages (TikTok only, …). Light enough for a 32 MB hAP lite; see app-filter.ts.
${appFilterSection}

# Wi-Fi last: renaming the network disconnects anyone configuring the router over it.
# Older radios (every v6 router, and v7 ones like the hAP lite) use the "wireless" package and
# name the radio wlan1; v7 ax models use the newer "wifi" package and name it wifi1. A router has
# one or the other, so both lines are deferred — see deferred().
${deferred(`/interface wireless set wlan1 disabled=no mode=ap-bridge ssid="MASHUPKGRID"`)}
${osMajor === 6 ? "" : `${deferred(`/interface wifi set [find default-name=wifi1] disabled=no configuration.mode=ap configuration.ssid="MASHUPKGRID"`)}
`}
:put "========================================================="
:put "  SUCCESS! Router & Hotspot captive portal are ONLINE!  "
:put "  All ISP core features and per-app packages activated!  "
:put "========================================================="
`;

  return isolateEveryCommand(wrapTopLevelCommands(minimalProvisioningScript));
}

/** The report script's address: next to the callback, same token. */
export function heartbeatScriptUrl(callbackUrl: string): string {
  return callbackUrl.replace(/\/callback$/, "/heartbeat.rsc");
}

/** The mkg-heartbeat scheduler's script, escaped to sit inside on-event="…" of the setup script. */
function heartbeatOnEvent(callbackUrl: string): string {
  const plain = `/tool fetch url=\\"${callbackUrl}\\" http-method=post keep-result=no`;
  return (
    `:do {:local r [/tool fetch url=\\"${heartbeatScriptUrl(callbackUrl)}\\" output=user as-value]; ` +
    `:local f [:parse (\\$r->\\"data\\")]; \\$f} on-error={:do {${plain}} on-error={}}`
  );
}

/**
 * What mkg-heartbeat runs each minute, served fresh by the platform (so it improves without anyone
 * re-running setup). Reads the router's own figures and posts them to the callback as a form
 * body — parseHeartbeatReport in @mashupkgrid/network reads it. Written for RouterOS 6 and 7
 * alike: /system health differs between them, so it is read through :parse and may fail alone,
 * as may the hotspot user count on a router with no hotspot. Kept well under the 4 KB a v6
 * `fetch output=user` returns.
 */
export function buildHeartbeatScript(callbackUrl: string, loginTemplateUrl?: string, options: { hotspotCheck?: boolean } = {}): string {
  const get = (field: string) => `[/system resource get ${field}]`;
  const aloginTemplateUrl = loginTemplateUrl ? aloginUrlFor(loginTemplateUrl) : null;
  const portalSelfRepair = loginTemplateUrl
    ? `:if ([:len [/file find name="hotspot/login.html"]] = 0 && [:len [/file find name="flash/hotspot/login.html"]] = 0) do={:do {/ip hotspot reset-html} on-error={}; :do {/tool fetch url="${loginTemplateUrl}" dst-path=hotspot/login.html check-certificate=no} on-error={}; :do {/tool fetch url="${loginTemplateUrl}" dst-path=flash/hotspot/login.html check-certificate=no} on-error={}; ${aloginTemplateUrl ? `:do {/tool fetch url="${aloginTemplateUrl}" dst-path=hotspot/alogin.html check-certificate=no} on-error={}; :do {/tool fetch url="${aloginTemplateUrl}" dst-path=flash/hotspot/alogin.html check-certificate=no} on-error={}; ` : ""}};`
    : `:if ([:len [/file find name="hotspot/login.html"]] = 0 && [:len [/file find name="flash/hotspot/login.html"]] = 0) do={:do {/ip hotspot reset-html} on-error={}};`;
  return [
    `{`,
    // Self-repair, each change made only when something is actually wrong, so a healthy router
    // writes nothing every minute. Radio commands go through deferred(): a router without that
    // menu (no wifi package, v6) must not fail this whole script, which is parsed as one.
    deferred(`/interface bridge port add bridge=bridge interface=wlan1`),
    deferred(`/interface bridge port add bridge=bridge interface=wifi1`),
    deferred(`/interface wireless set [find name=wlan1 disabled=yes] disabled=no mode=ap-bridge`),
    deferred(`/interface wifi set [find default-name=wifi1 disabled=yes] disabled=no configuration.mode=ap`),
    `:do {:if ([/ip dns get allow-remote-requests] = false) do={/ip dns set allow-remote-requests=yes}} on-error={}`,
    `:do {:if ([:len [/ip dns get servers]] = 0) do={/ip dns set servers=1.1.1.1,8.8.8.8}} on-error={}`,
    // Customers' DNS goes to the router (a phone with a hard-coded 8.8.8.8 otherwise never sees
    // the sign-in page). Exactly one pair of rules: any other count — none, or the duplicates an
    // earlier version added every minute — is cleared and replaced.
    `:do {:if ([:len [/ip firewall nat find comment="MASHUPKGRID DNS"]] != 2) do={/ip firewall nat remove [find comment="MASHUPKGRID DNS"]; /ip firewall nat add chain=dstnat in-interface=bridge protocol=udp dst-port=53 action=redirect to-ports=53 comment="MASHUPKGRID DNS"; /ip firewall nat add chain=dstnat in-interface=bridge protocol=tcp dst-port=53 action=redirect to-ports=53 comment="MASHUPKGRID DNS"}} on-error={}`,
    // Every hotspot profile: RADIUS on, and pointed at a folder that really has the sign-in page.
    `:do {:foreach p in=[/ip hotspot profile find] do={:local dir [/ip hotspot profile get $p html-directory]; :if ([:len [/file find name=($dir . "/login.html")]] = 0) do={:if ([:len [/file find name="flash/hotspot/login.html"]] > 0) do={/ip hotspot profile set $p html-directory=flash/hotspot} else={:if ([:len [/file find name="hotspot/login.html"]] > 0) do={/ip hotspot profile set $p html-directory=hotspot}}}; :if ([/ip hotspot profile get $p use-radius] = false) do={/ip hotspot profile set $p use-radius=yes login-by=mac,http-chap,http-pap,cookie}}} on-error={}`,
    `:do {/ip hotspot enable [find interface=bridge disabled=yes]} on-error={}`,
    portalSelfRepair,
    // cpu-load is the last second's load, and this runs straight after the router fetched it over
    // TLS — on a hAP lite that alone reads ~100%. Let the spike pass before sampling.
    `:delay 3s`,
    `:local d ("cpu=" . ${get("cpu-load")} . "&uptime=" . ${get("uptime")} . "&freemem=" . ${get("free-memory")} . "&totmem=" . ${get("total-memory")} . "&freehdd=" . ${get("free-hdd-space")} . "&tothdd=" . ${get("total-hdd-space")} . "&ver=" . ${get("version")} . "&board=" . ${get("board-name")})`,
    `:do {:set d ($d . "&users=" . [:len [/ip hotspot active find]])} on-error={}`,
    `:do {:local h [:parse ":return [:tostr [/system health print as-value]]"]; :set d ($d . "&health=" . [$h])} on-error={}`,
    // The management VPN (RouterOS 7): whether mkg-wg exists, and how long since its last
    // handshake — "1," means it exists but has never connected. v6 has no WireGuard: skipped.
    `:do {:local w [:parse ":return ([:len [/interface wireguard find name=mkg-wg]] . \\",\\" . [/interface wireguard peers get [find interface=mkg-wg] last-handshake])"]; :set d ($d . "&wg=" . [$w])} on-error={:do {:local w [:parse ":return [:len [/interface wireguard find name=mkg-wg]]"]; :set d ($d . "&wg=" . [$w])} on-error={}}`,
    ...(options.hotspotCheck === false ? [] : [HOTSPOT_CHECK]),
    `/tool fetch url="${callbackUrl}" http-method=post http-data=$d keep-result=no`,
    `}`,
    "",
  ].join("\n");
}

/**
 * The router checks its own hotspot every minute and reports counts, so the dashboard can say in
 * plain words why customers get "Connected, no internet" (see hotspotProblems in
 * @mashupkgrid/network) without anyone typing router commands: running hotspot servers, phones
 * that reached the hotspot (hosts) and signed in (auth), DHCP leases, the DNS redirect rules,
 * sign-in page files, radios in the bridge, the portal in the walled garden, pings answered by
 * the internet, and whether DNS resolves. Left out for RouterOS 6, whose report must stay under
 * the 4 KB its fetch returns.
 */
const HOTSPOT_CHECK = `:do {:local c ("srv=" . [:len [/ip hotspot find disabled=no]] . ";hosts=" . [:len [/ip hotspot host find]] . ";auth=" . [:len [/ip hotspot active find]] . ";leases=" . [:len [/ip dhcp-server lease find]] . ";dnsnat=" . [:len [/ip firewall nat find comment="MASHUPKGRID DNS"]] . ";login=" . [:len [/file find name~"hotspot/login.html"]] . ";radios=" . [:len [/interface bridge port find interface~"wlan|wifi"]] . ";garden=" . [:len [/ip hotspot walled-garden find dst-host~"mashuphost"]] . ";ping=" . [/ping 8.8.8.8 count=2]); :do {:resolve google.com; :set c ($c . ";dns=1")} on-error={:set c ($c . ";dns=0")}; :set d ($d . "&hs=" . $c)} on-error={}`;

/** hotspot/alogin.html sits next to the login page on the API: same path, alogin template. */
export function aloginUrlFor(loginTemplateUrl: string): string {
  return loginTemplateUrl.replace(/mikrotik-login-template(\?|$)/, "mikrotik-alogin-template$1");
}

/** Opening lines naming the RouterOS version the script was made for, and a check that warns
 *  (on screen and in the router's log) when the router runs another one — the script still
 *  runs, since every command is wrapped, but the ISP learns to regenerate it with the right one. */
export function buildVersionSection(osMajor: 6 | 7 | null): string {
  if (osMajor === null) {
    return `# RouterOS version: detected on the router (works on v6 and v7).
:put ("RouterOS " . [/system resource get version])`;
  }
  const warning = `MASHUPKGRID: this script was made for RouterOS v${osMajor} but this router runs `;
  return `# RouterOS version: made for v${osMajor} (chosen when the router was added).
:if ([:pick [/system resource get version] 0 1] != "${osMajor}") do={:put ("WARNING: ${warning}" . [/system resource get version] . ". Change the version on the router's page and run the new script."); :log warning ("${warning}" . [/system resource get version])}`;
}

/** NTP: RouterOS 7 lists servers under /system ntp client servers; v6 takes them as
 *  server-dns-names. Unknown version: both, and the one the router doesn't know fails alone. */
export function buildNtpLines(osMajor: 6 | 7 | null): string {
  const v7 = [
    deferred(`/system ntp client set enabled=yes`),
    deferred(`/system ntp client servers add address=pool.ntp.org`),
    deferred(`/system ntp client servers add address=time.google.com`),
  ].join("\n");
  const v6 = deferred(`/system ntp client set enabled=yes server-dns-names=pool.ntp.org,time.google.com`);
  if (osMajor === 7) return v7;
  if (osMajor === 6) return v6;
  return `${v7}\n${v6}`;
}

/** RouterOS checks a whole file before `/import` runs any of it, and a menu or parameter this
 *  router doesn't have ("bad command name wifi" on a hAP lite, `/interface wireguard` on v6) is a
 *  syntax error there — `on-error` never sees it and NOTHING in the script runs, not even the
 *  check-in on its first line. So a command that only exists on some versions or packages is
 *  handed to `:parse` as text: it is only checked when it runs, and then its failure is an
 *  ordinary error `on-error` catches. */
export function deferred(commands: string): string {
  const source = commands.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "; ");
  return `:do {:local mkgCmd [:parse "${source}"]; $mkgCmd} on-error={}`;
}

/** The setup script goes through `/import`, which checks the whole file before running any of it.
 *  `on-error` only catches failures while running, so one command or parameter a router doesn't
 *  know — a v7-only DNS option on v6, a menu from a package it lacks — would still reject the
 *  entire file, check-in included. Every single-line command is therefore handed to `:parse`
 *  (see deferred()): the file is always accepted, and an unknown command only skips itself. */
export function isolateEveryCommand(script: string): string {
  return script
    .split("\n")
    .map((line) => {
      const inner = /^:do \{(\/.*)\} on-error=\{\}$/.exec(line)?.[1];
      return inner ? deferred(inner) : line;
    })
    .join("\n");
}

/** Reverses deferred() on each line so the script reads as the plain commands it runs. */
export function plainCommands(script: string): string {
  return script
    .split("\n")
    .map((line) => {
      const source = /^:do \{:local mkgCmd \[:parse "(.*)"\]; \$mkgCmd\} on-error=\{\}$/.exec(line)?.[1];
      return source === undefined ? line : `:do {${source.replace(/\\(.)/g, "$1")}} on-error={}`;
    })
    .join("\n");
}

/** /import stops at the first command RouterOS rejects, and everything after it silently never
 *  runs — a feature a given RouterOS version doesn't support must not cost the router its
 *  heartbeat or VPN. Wraps every bare top-level command (a line starting with "/") so each one can
 *  fail on its own; indented lines inside :if / :do blocks are left as they are. */
export function wrapTopLevelCommands(script: string): string {
  return script
    .split("\n")
    .map((line) => (line.startsWith("/") ? `:do {${line}} on-error={}` : line))
    .join("\n");
}

/** Step 1 of remote access: WireGuard is RouterOS v7+ only (there is no v6 equivalent — unlike
 *  the provisioning/RADIUS scripts above, this one has no legacy fallback). The router generates
 *  its own keypair locally (`/interface wireguard add` with no `private-key=` auto-generates
 *  one) and only ever sends the *public* half anywhere. The key travels as the raw POST body
 *  (`http-data=`), not a query parameter — a WireGuard public key is standard base64 and would
 *  need URL-encoding RouterOS's scripting language has no built-in way to do. */
export function buildMikrotikVpnStartScript(router: Router, callbackUrl: string, listenPort = 51820): string {
  return `# MASHUPKGRID ISP — remote access (WireGuard) setup, step 1 of 2, for router "${sanitizeForScript(router.name)}"
# Requires RouterOS v7+ (WireGuard has no v6 equivalent). Paste into the router's terminal, run it.

{
  # 1. Clean up any previous WireGuard interface and create fresh interface
  /interface wireguard remove [find name=mkg-wg]
  /interface wireguard add name=mkg-wg listen-port=${listenPort}
  :delay 2s

  # 2. Read back the public key and register it with the cloud platform
  :local pubkey [/interface wireguard get [find name=mkg-wg] public-key]
  :put ("Generated WireGuard Public Key: " . $pubkey)
  /tool fetch url="${callbackUrl}?pubkey=$pubkey" http-method=post http-data=$pubkey keep-result=no

  :put "========================================================="
  :put "  Step 1 complete! Click 'Finish Remote Access' on web   "
  :put "========================================================="
}
`;
}

export interface VpnCompleteScriptInput {
  serverPublicKey: string;
  serverEndpoint: string;
  serverListenPort: number;
  assignedVpnIp: string;
  /** The platform's WireGuard tunnel subnet (WIREGUARD_SUBNET_CIDR). Scopes what the peer is
   *  allowed to send — see the allowed-address line below for why 0.0.0.0/0 was wrong here. */
  tunnelSubnetCidr?: string;
}

/** Step 2, generated only after the platform has allocated this router a tunnel IP and added it
 *  as a peer on its own WireGuard interface (see completeVpnRegistration in @mashupkgrid/network)
 *  — this router-side half can't be built before that, since it needs the assigned IP. Once run,
 *  `Router.host` is already the tunnel IP server-side, so every other feature (test-connection,
 *  hotspot script, live sessions) just starts working over the tunnel with no further changes. */
export function buildMikrotikVpnCompleteScript(input: VpnCompleteScriptInput): string {
  const endpointHost = input.serverEndpoint.includes(":") ? input.serverEndpoint.split(":")[0] : input.serverEndpoint;
  const endpointPort = input.serverEndpoint.includes(":") ? Number(input.serverEndpoint.split(":")[1]) : (input.serverListenPort || 51820);
  const serverPubKey = input.serverPublicKey || "";
  const tunnelSubnet = input.tunnelSubnetCidr || "10.90.0.0/16";

  return `# MASHUPKGRID ISP — remote access (WireGuard) setup, step 2 of 2
# Paste into the router's terminal, run it. This finishes the tunnel — the platform can then
# reach this router at ${input.assignedVpnIp} regardless of its real network location.

# allowed-address is the peer's permission to claim a source address, not a route. Scoping it to
# the platform's own tunnel subnet is what makes this a MANAGEMENT tunnel: at 0.0.0.0/0 the
# server peer was authorised to send the router traffic claiming ANY source address on the
# internet, and on a small CPE it also invites the whole-internet-through-the-tunnel behaviour
# that flattens a device with no crypto acceleration.
/interface wireguard peers remove [find interface=mkg-wg]
/interface wireguard peers add interface=mkg-wg public-key="${serverPubKey}" endpoint-address="${endpointHost}" endpoint-port=${endpointPort} allowed-address=${tunnelSubnet} persistent-keepalive=25s

/ip address remove [find interface=mkg-wg]
/ip address add address=${input.assignedVpnIp}/32 interface=mkg-wg

:put "========================================================="
:put "  SUCCESS! WireGuard tunnel active at ${input.assignedVpnIp} "
:put "========================================================="
`;
}

/** Default router LAN — what the setup script itself configures on the bridge. */
export const ROUTER_LAN_SUBNET = "192.168.88.0/24";
export const DEFAULT_VPN_SUBNET = "10.90.0.0/16";

/** The addresses allowed to reach a router's API and WinBox: the platform, its WireGuard VPN
 *  (the remote-WinBox relay arrives from there) and the router's own LAN. Nothing else — a
 *  RouterOS API or WinBox login open to the whole internet is brute-forced within days. */
export function managementSources(options: { managementSource?: string | null; vpnSubnet?: string | null; extra?: string[] }): string[] {
  const list = [options.managementSource, options.vpnSubnet || DEFAULT_VPN_SUBNET, ROUTER_LAN_SUBNET, ...(options.extra ?? [])]
    .map((s) => (s ?? "").trim())
    .filter((s) => /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/.test(s));
  return [...new Set(list)];
}

/** RouterOS lines that restrict the API and WinBox to `sources`, replacing any older rule that
 *  opened them to everyone. Safe to re-run. */
export function buildManagementAccessSection(sources: string[], apiPort: number, useTls: boolean): string {
  const addressList = sources.join(",");
  const apiService = useTls ? "api-ssl" : "api";
  const unusedApiService = useTls ? "api" : "api-ssl";
  return `# Management access: only the platform, its VPN and this router's LAN may reach the API and WinBox.
# Off: the API variant the platform doesn't use (api-ssl with no certificate keeps the router's
# certificate process busy), and telnet/FTP, plain-text logins open to every hotspot customer.
:do {/ip service set ${unusedApiService} disabled=yes} on-error={}
:do {/ip service set telnet disabled=yes} on-error={}
:do {/ip service set ftp disabled=yes} on-error={}
:do {/ip firewall address-list remove [find list="mashup-mgmt"]} on-error={}
${sources.map((s) => `:do {/ip firewall address-list add list="mashup-mgmt" address=${s} comment="MASHUPKGRID MANAGEMENT"} on-error={}`).join("\n")}
:do {/ip firewall filter remove [find comment="MASHUPKGRID ISP API"]} on-error={}
:do {/ip firewall filter remove [find comment="MASHUPKGRID WINBOX REMOTE"]} on-error={}
:do {/ip firewall filter remove [find comment="MASHUPKGRID MANAGEMENT"]} on-error={}
:do {/ip firewall filter add chain=input protocol=tcp dst-port=${apiPort},8291 src-address-list="mashup-mgmt" action=accept comment="MASHUPKGRID MANAGEMENT"} on-error={}
:do {/ip firewall filter move [find comment="MASHUPKGRID MANAGEMENT"] destination=0} on-error={}
:do {/ip service set ${apiService} disabled=no port=${apiPort} address=${addressList}} on-error={}
:do {/ip service set winbox disabled=no port=8291 address=${addressList}} on-error={}`;
}

/**
 * WinBox access script. It no longer opens WinBox to the internet: it restricts WinBox to the
 * platform, its VPN and the LAN, which is exactly what remote WinBox through the platform's
 * relay needs (the relay reaches the router over the VPN).
 */
export function buildMikrotikWinboxScript(
  routerName: string,
  options: { managementSource?: string | null; vpnSubnet?: string | null; apiPort?: number; useTls?: boolean } = {}
): string {
  const safeName = sanitizeForScript(routerName);
  const sources = managementSources(options);
  return `# MASHUPKGRID ISP - WinBox access for "${safeName}"
# Allows WinBox (8291) from the MashupHost server, its VPN and this router's LAN only.
${buildManagementAccessSection(sources, options.apiPort ?? 8728, options.useTls ?? false)}
:put "WinBox is reachable from: ${sources.join(", ")}"
:put "Connect remotely through the address shown on the MashupHost Routers page."
`;
}

