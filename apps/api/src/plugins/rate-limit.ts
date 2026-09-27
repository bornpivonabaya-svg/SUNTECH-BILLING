import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { redis } from "../lib/redis.js";
import { RateLimitedError } from "@mashupkgrid/shared";
import { isDevelopment } from "@mashupkgrid/config";

/**
 * Global default rate limit, Redis-backed so it's correct across multiple API instances
 * (project instruction §37). Per-route-family limits (login, OTP, registration, password
 * reset) are applied with tighter `config.rateLimit` overrides on those specific routes.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (request) => request.ip,
    // @fastify/rate-limit does `throw params.errorResponseBuilder(req, ctx)` internally (it is
    // NOT sent as a response body directly) — returning our own AppError subclass here, rather
    // than a plain object, lets the global error handler's `isAppError` branch serialize it
    // correctly (429 + the standard envelope) instead of falling through to a generic 500.
    errorResponseBuilder: (_request, context) => new RateLimitedError(Math.ceil(context.ttl / 1000)),
  });
}

// These stay tight in production (brute-force/OTP-guessing protection) but that same tightness
// is exactly what makes iterative local testing painful — 5 login attempts per 15 minutes is
// gone after one debugging session. Development gets a much looser bound instead of no bound at
// all, so a genuine runaway retry loop still gets caught during dev, just not a normal workflow.
export const authRateLimitConfig = isDevelopment
  ? { max: 100, timeWindow: "1 minute" }
  : { max: 50, timeWindow: "15 minutes" };
export const otpRateLimitConfig = isDevelopment
  ? { max: 100, timeWindow: "1 minute" }
  : { max: 5, timeWindow: "1 hour" };
export const publicApiRateLimitConfig = { max: 100, timeWindow: "1 minute" };
// Every customer on a hotspot reaches us from the router's one public address (NAT), so these
// per-address limits are per SITE, not per phone. 20 per 15 minutes stopped a site after its
// 20th sale or sign-in. 300 per 15 minutes serves a busy site and still bounds guessing an
// 8-character voucher code (32^8 ≈ 10^12 codes) to nothing meaningful.
export const hotspotLoginRateLimitConfig = isDevelopment
  ? { max: 300, timeWindow: "1 minute" }
  : { max: 300, timeWindow: "15 minutes" };
/** Account sign-in guesses a customer's own password, so it stays tighter than a voucher code. */
export const hotspotAccountLoginRateLimitConfig = isDevelopment
  ? { max: 100, timeWindow: "1 minute" }
  : { max: 100, timeWindow: "15 minutes" };
/** The portal's page loads and its every-2.5-seconds payment check. A site with a few customers
 *  paying at once goes past the general 300 a minute, which left a paid customer waiting. */
export const hotspotPortalRateLimitConfig = { max: 3000, timeWindow: "1 minute" };
