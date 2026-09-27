import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_MS = 5 * 60 * 1000;

/** Checks a Sanity webhook's `sanity-webhook-signature` header against the webhook secret:
 *  "t=<ms>,v1=<base64url HMAC-SHA256 of `${t}.${body}`>", refused if older than five minutes. */
export function verifySanitySignature(header: string | null, body: string, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || Math.abs(now - t) > MAX_AGE_MS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1.replace(/=+$/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
