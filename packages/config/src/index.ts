import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Loads the repo-root `.env` file into `process.env` for local development, regardless of
 * which package/app imports this module first or what its own CWD is (pnpm's `--filter`
 * changes CWD per-package, so a naive `.env` lookup from CWD alone would miss the root file).
 * Deliberately a no-op when the file doesn't exist — Docker/production inject env vars
 * directly (via `docker-compose`'s `env_file`), so there is no `.env` file to find there, and
 * that's expected, not an error.
 */
function loadRootDotEnvIfPresent(): void {
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
  // packages/config/src -> repo root is two levels up (also correct from packages/config/dist).
  const rootEnvPath = path.resolve(thisFileDir, "../../../.env");
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // No .env file at the repo root — fine in Docker/CI where env vars are already set.
  }
}

loadRootDotEnvIfPresent();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_PEPPER: z.string().min(32, "JWT_REFRESH_PEPPER must be at least 32 characters"),
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  /** Defaults false — no reverse proxy sits in front of the API in this stack's own
   *  infrastructure/ (no nginx/traefik config exists there), so trusting a client-supplied
   *  `X-Forwarded-For` unconditionally (Fastify's `trustProxy: true`) would let anyone spoof
   *  `request.ip` and defeat per-IP rate limiting and the maintenance-mode IP allowlist by
   *  sending a different value on every request. Only set true if a real trusted reverse proxy
   *  is added that overwrites this header itself before requests reach the API.
   *  z.coerce.boolean() is the exact footgun ENABLE_EMBEDDED_RADIUS_SERVER's comment below warns
   *  about — Boolean("false") is true in JS, so `TRUST_PROXY=false` in .env would coerce to
   *  true and silently defeat everything this comment says it protects. Comparing the raw string
   *  against the literal "true" is what actually makes this opt-in-only. */
  TRUST_PROXY: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Publicly reachable base URL of apps/api — used to build the M-Pesa callback URL handed to
   *  Safaricom (must be internet-reachable, e.g. an ngrok tunnel in dev, a real domain in
   *  prod; localhost will never receive a callback). */
  APP_API_PUBLIC_URL: z.string().default("http://localhost:4000"),

  WEB_PORT: z.coerce.number().int().positive().default(3000),
  NEXT_PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  /** Base URL of apps/web, used server-side (worker) to build links inside transactional emails. */
  APP_WEB_URL: z.string().default("http://localhost:3000"),
  /** Dedicated captive portal hostname reached directly without CDN proxying for MikroTik hotspot sign-in */
  APP_PORTAL_URL: z.string().default("https://captive.suntechke.com"),
  /** The domain every tenant's automatic subdomain is built under (`{tenant.slug}.{this}`) —
   *  a placeholder until a real domain is registered and pointed at this deployment; actually
   *  making `{slug}.{this}` resolve to the tenant's dashboard is a separate, not-yet-built
   *  hostname-routing layer (see the multi-tenant-domains plan) — this var only powers the
   *  platform-URL value shown to staff today. */
  PLATFORM_BASE_DOMAIN: z.string().default("billing.example.com"),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  /** Opt-in only — a real deployment should run real FreeRADIUS (infrastructure/freeradius).
   *  This exists purely so RADIUS-dependent features (hotspot, PPPoE) are testable in
   *  environments with no Linux infra to run FreeRADIUS on (see packages/radius's
   *  radius-server.ts doc comment for exactly what it does and doesn't implement). */
  // z.coerce.boolean() is a footgun here — Boolean("false") is true in JS, so any non-empty
  // string (including the literal word "false") would coerce to true. Comparing against the
  // literal string "true" is what actually gives an opt-in-only default.
  ENABLE_EMBEDDED_RADIUS_SERVER: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  RADIUS_AUTH_PORT: z.coerce.number().int().positive().default(1812),
  RADIUS_ACCT_PORT: z.coerce.number().int().positive().default(1813),

  /** The platform's own WireGuard server identity — routers connect to this as a client. Opt-in
   *  (see packages/network's wireguard-peer.service.ts doc comment): requires the `wg`
   *  command-line tool and an already-running `wg0` interface on the host, which is real Linux
   *  server infra this dev environment doesn't have — the feature is fully implemented and
   *  ready to enable wherever that exists. */
  ENABLE_WIREGUARD_REMOTE_ACCESS: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  WIREGUARD_INTERFACE: z.string().default("wg0"),
  WIREGUARD_SERVER_PUBLIC_KEY: z.string().optional().default(""),
  /** The private half of the pair above. Only the container's entrypoint uses it, to bring the
   *  interface up; nothing in application code reads it, and it must never be logged or returned
   *  by an endpoint — a router only ever needs WIREGUARD_SERVER_PUBLIC_KEY. */
  WIREGUARD_SERVER_PRIVATE_KEY: z.string().optional().default(""),
  /** Host:port other peers (routers) dial to reach this server — must be a real, internet- or
   *  LAN-reachable address once WireGuard is actually enabled. Empty means "this server's public
   *  address" as the router routes work it out (see platformPublicAddress in @mashupkgrid/network). */
  WIREGUARD_SERVER_ENDPOINT: z.string().optional().default(""),
  WIREGUARD_LISTEN_PORT: z.coerce.number().int().positive().default(51820),
  /** Pool routers' tunnel IPs are allocated from — .1 is reserved for the server itself. */
  WIREGUARD_SUBNET_CIDR: z.string().default("10.90.0.0/16"),

  /** The fixed public IP/CIDR from which the platform manages RouterOS devices. Empty means
   *  this server's own public address (RADIUS_SERVER_HOST, else the API host resolved). */
  ROUTER_MANAGEMENT_SOURCE: z
    .union([
      z.literal(""),
      z.string().regex(/^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?$/, "ROUTER_MANAGEMENT_SOURCE must be an IPv4 address or CIDR"),
    ])
    .optional()
    .default(""),

  /** Base URL routers use to reach this API (setup script, check-ins, hotspot login page).
   *  Defaults to APP_API_PUBLIC_URL. Set it when routers should use a different address from
   *  browsers and Safaricom — e.g. http://192.168.1.183:4000 to test a router on the same LAN as
   *  a dev machine, so its check-ins arrive from the same address its RADIUS packets do. */
  ROUTER_API_BASE_URL: z.string().optional().default(""),

  /** Remote WinBox through this server: the worker listens on one TCP port per VPN-linked
   *  router and relays it over WireGuard to that router's WinBox (port 8291). Opt-in — it only
   *  works where the WireGuard interface exists (production), and the port range must also be
   *  published by the container and opened in the host firewall. */
  ENABLE_WINBOX_RELAY: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  WINBOX_RELAY_PORT_RANGE: z
    .string()
    .regex(/^\d{2,5}-\d{2,5}$/, "WINBOX_RELAY_PORT_RANGE must look like 20000-20199")
    // Must match the range docker-compose.prod.yml publishes for the api service.
    .default("20000-20199"),
  /** Host operators type into WinBox. Defaults to the WireGuard endpoint's host. */
  WINBOX_RELAY_PUBLIC_HOST: z.string().optional().default(""),
  /** Optional comma-separated IPv4 addresses/CIDRs allowed to use the relay (e.g. your office). */
  WINBOX_RELAY_ALLOWED_SOURCES: z.string().optional().default(""),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().default("no-reply@mashupkgrid.local"),

  /** Resend API integration for high-deliverability transactional email (resend.com) */
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM: z.string().optional().default(""),

  /** Web push (alerts to staff phones and computers). Generate a pair once with
   *  `npx web-push generate-vapid-keys`; changing them later makes every device turn alerts on
   *  again. Empty means push is off and the dashboard says so. */
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  /** Contact the push services can reach if the alerts misbehave: a mailto: or https: URL. */
  VAPID_SUBJECT: z.string().optional().default("mailto:alerts@suntechke.com"),

  // M-Pesa credentials are configured per-tenant, encrypted, in the PaymentProviderConfig
  // table (docs/architecture/10-phase3-plan.md) — set via the admin UI/API, not here. These
  // env vars are unused by application code; kept only as the seed script's optional default
  // for the demo tenant in local development.
  MPESA_CONSUMER_KEY: z.string().optional().default(""),
  MPESA_CONSUMER_SECRET: z.string().optional().default(""),
  MPESA_SHORTCODE: z.string().optional().default(""),
  MPESA_PASSKEY: z.string().optional().default(""),
  /** Daraja has no HMAC/signature scheme for its webhooks the way Paystack does — Safaricom will
   *  POST a completion callback to whatever URL it was given by anyone who can reach it, with no
   *  way for the receiving server to prove the sender is really Safaricom. The standard
   *  mitigation (used since there's nothing else Daraja offers) is a shared secret embedded in
   *  the callback URL itself: set here, appended as `?token=...` when the STK callback URL is
   *  built (packages/payments/src/mpesa/*.service.ts) and required on the equivalent C2B
   *  validation/confirmation URLs a tenant registers with Safaricom. Optional so a fresh/dev
   *  install without it set doesn't hard-fail — but see the loud startup warning in
   *  apps/api/src/routes/mpesa.ts when it's unset; every real deployment handling real payments
   *  should set this. */
  MPESA_CALLBACK_TOKEN: z.string().min(16).optional(),

  SMS_API_KEY: z.string().optional().default(""),
  WHATSAPP_API_KEY: z.string().optional().default(""),
  /** Opt-in, same reasoning/pattern as ENABLE_EMBEDDED_RADIUS_SERVER below — the self-hosted
   *  Baileys WhatsApp client (packages/whatsapp) pairs with a real personal/business WhatsApp
   *  number via QR code (no Meta Business API credentials needed), so it must never start
   *  automatically in an environment nobody has paired a number for yet. */
  ENABLE_WHATSAPP_BOT: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  /** Where the paired session's auth keys are persisted (packages/whatsapp's
   *  useMultiFileAuthState) so the QR code only needs to be scanned once per machine — deleting
   *  this folder forces a fresh pairing. Relative paths resolve from wherever the process
   *  starts, so an absolute path is safer once this runs somewhere other than local dev. */
  WHATSAPP_AUTH_STATE_PATH: z.string().optional().default("./.whatsapp-auth"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Refusing to start.\n${issues}\n\n` +
        `See .env.example for the full list of required variables.`
    );
  }
  return parsed.data;
}

/** Validated once at first import. A missing/malformed secret throws immediately. */
export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDevelopment = env.NODE_ENV === "development";

/** Email is configured if either Resend API key or full SMTP credentials are present */
export const emailTransportConfigured = Boolean(
  env.RESEND_API_KEY || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD)
);
