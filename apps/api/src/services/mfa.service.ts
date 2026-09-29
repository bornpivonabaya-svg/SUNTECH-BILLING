import { prisma, type User } from "@mashupkgrid/database";
import { env } from "@mashupkgrid/config";
import { ConflictError, UnauthorizedError, ValidationError, decryptAtRest, encryptAtRest, generateAlnumSecret, resolveTenantPreferences, verifyPassword } from "@mashupkgrid/shared";
import { createSession, generateRecoveryCodes, generateSmsCode, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp, type DeviceContext, type IssuedTokens } from "@mashupkgrid/auth";
import { sendTenantSms } from "@mashupkgrid/sms";
import { createHash } from "node:crypto";
import { redis } from "../lib/redis.js";

/**
 * Two-step login. After a correct password, a user with two-step login on gets a short-lived
 * challenge instead of a session, and a session only once they give a code from their
 * authenticator app, an SMS, or one of their recovery codes. When the ISP requires it and a staff
 * member hasn't set it up yet, the password step returns a setup challenge instead: they set it
 * up there and then, and only then get a session.
 */

const CHALLENGE_TTL = 5 * 60;
const MAX_TRIES = 5;
const SMS_RESEND_SECONDS = 60;

type Purpose = "verify" | "setup";

interface Challenge {
  userId: string;
  tenantId: string | null;
  purpose: Purpose;
  device: DeviceContext;
  tries: number;
  smsCodeHash?: string;
  smsSentAt?: number;
}

export type SecondStep =
  | { mfaRequired: true; challengeToken: string; method: "TOTP" | "SMS"; phoneHint: string | null }
  | { mfaSetupRequired: true; setupToken: string; smsAvailable: boolean };

const key = (token: string) => `mfa:challenge:${token}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const phoneHint = (phone: string | null) => (phone ? `•••${phone.replace(/\D/g, "").slice(-3)}` : null);

async function saveChallenge(token: string, c: Challenge): Promise<void> {
  await redis.set(key(token), JSON.stringify(c), "EX", CHALLENGE_TTL);
}

async function loadChallenge(token: string, purpose: Purpose): Promise<Challenge> {
  const raw = await redis.get(key(token));
  const c = raw ? (JSON.parse(raw) as Challenge) : null;
  if (!c || c.purpose !== purpose) throw new UnauthorizedError("This sign-in has expired. Please sign in again.");
  return c;
}

/** Counts a wrong code; the fifth ends the challenge. */
async function failTry(token: string, c: Challenge): Promise<never> {
  c.tries += 1;
  if (c.tries >= MAX_TRIES) await redis.del(key(token));
  else await saveChallenge(token, c);
  throw new UnauthorizedError(c.tries >= MAX_TRIES ? "Too many wrong codes. Please sign in again." : "That code is not right. Please try again.");
}

/** Staff: anyone holding a role other than the customer or agent ones. */
export async function isStaffUser(userId: string): Promise<boolean> {
  const roles = await prisma.userRole.findMany({ where: { userId }, include: { role: { select: { name: true } } } });
  return roles.some((r) => r.role.name !== "CUSTOMER" && r.role.name !== "AGENT");
}

async function tenantRequiresMfa(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { preferences: true } });
  return resolveTenantPreferences(tenant?.preferences).security.requireStaffMfa;
}

export async function isMfaRequiredFor(user: Pick<User, "id" | "tenantId">): Promise<boolean> {
  return (await tenantRequiresMfa(user.tenantId)) && (await isStaffUser(user.id));
}

async function sendSmsCode(user: Pick<User, "tenantId" | "phone">, c: Challenge): Promise<void> {
  if (!user.tenantId || !user.phone) throw new ConflictError("There is no phone number to send a code to");
  const code = generateSmsCode();
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
  const res = await sendTenantSms(user.tenantId, user.phone, `${code} is your ${tenant?.name ?? ""} sign-in code. It expires in 5 minutes. Don't share it with anyone.`);
  if (!res.delivered) throw new ConflictError("The code could not be sent by SMS. Use your authenticator app or a recovery code.");
  c.smsCodeHash = sha(code);
  c.smsSentAt = Date.now();
}

/** Called after a correct password. Null means no second step: issue the session. */
export async function secondStepFor(user: User, device: DeviceContext): Promise<SecondStep | null> {
  if (user.mfaMethod) {
    const token = generateAlnumSecret(40);
    const c: Challenge = { userId: user.id, tenantId: user.tenantId, purpose: "verify", device, tries: 0 };
    if (user.mfaMethod === "SMS") await sendSmsCode(user, c);
    await saveChallenge(token, c);
    return { mfaRequired: true, challengeToken: token, method: user.mfaMethod, phoneHint: user.mfaMethod === "SMS" ? phoneHint(user.phone) : null };
  }
  if (await isMfaRequiredFor(user)) {
    const token = generateAlnumSecret(40);
    await saveChallenge(token, { userId: user.id, tenantId: user.tenantId, purpose: "setup", device, tries: 0 });
    return { mfaSetupRequired: true, setupToken: token, smsAvailable: Boolean(user.phone && user.tenantId) };
  }
  return null;
}

/** Checks a code for a user with two-step login on: their method's code, or a recovery code. */
async function checkCode(user: User, code: string, c: Challenge): Promise<"ok" | "recovery" | "bad"> {
  const clean = code.trim();
  if (/^\d{6}$/.test(clean.replace(/\s/g, ""))) {
    if (user.mfaMethod === "TOTP" && user.totpSecretEncrypted && verifyTotp(decryptAtRest(user.totpSecretEncrypted, env.ENCRYPTION_KEY), clean)) {
      // A code works once: someone who saw it can't reuse it while it is still current.
      const fresh = await redis.set(`mfa:totp-used:${user.id}:${clean.replace(/\s/g, "")}`, "1", "EX", 120, "NX");
      return fresh ? "ok" : "bad";
    }
    if (user.mfaMethod === "SMS" && c?.smsCodeHash && sha(clean.replace(/\s/g, "")) === c.smsCodeHash) return "ok";
    return "bad";
  }
  const hash = hashRecoveryCode(clean);
  if (user.mfaRecoveryCodes.includes(hash)) {
    // Each recovery code works once.
    await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hash) } });
    return "recovery";
  }
  return "bad";
}

export async function verifyChallenge(token: string, code: string): Promise<{ user: User; tokens: IssuedTokens; usedRecoveryCode: boolean; recoveryCodesLeft: number }> {
  const c = await loadChallenge(token, "verify");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  const result = await checkCode(user, code, c);
  if (result === "bad") return failTry(token, c);
  await redis.del(key(token));
  const tokens = await createSession(user.id, user.tenantId, c.device);
  const left = result === "recovery" ? user.mfaRecoveryCodes.length - 1 : user.mfaRecoveryCodes.length;
  return { user, tokens, usedRecoveryCode: result === "recovery", recoveryCodesLeft: left };
}

export async function resendChallengeSms(token: string): Promise<void> {
  const c = await loadChallenge(token, "verify");
  if (c.smsSentAt && Date.now() - c.smsSentAt < SMS_RESEND_SECONDS * 1000) throw new ConflictError("Please wait a minute before asking for another code");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  if (user.mfaMethod !== "SMS") throw new ConflictError("This account uses an authenticator app");
  await sendSmsCode(user, c);
  await saveChallenge(token, c);
}

// ------------------------------------------------------------------ Setting it up

export interface SetupStart {
  method: "TOTP" | "SMS";
  secret?: string;
  otpauthUrl?: string;
  phoneHint?: string | null;
}

async function issuerFor(user: Pick<User, "tenantId">): Promise<string> {
  if (!user.tenantId) return "Suntech";
  const t = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
  return t?.name ?? "Suntech";
}

/** Starts setup: an authenticator secret (kept, encrypted, until confirmed) or an SMS code. */
async function startSetup(user: User, method: "TOTP" | "SMS", c: Challenge): Promise<SetupStart> {
  if (method === "TOTP") {
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecretEncrypted: encryptAtRest(secret, env.ENCRYPTION_KEY) } });
    return { method, secret, otpauthUrl: otpauthUrl(await issuerFor(user), user.email, secret) };
  }
  await sendSmsCode(user, c);
  return { method, phoneHint: phoneHint(user.phone) };
}

/** Turns it on once the first code checks out, and returns fresh recovery codes. */
async function confirmSetup(user: User, method: "TOTP" | "SMS", code: string, c: Challenge): Promise<string[] | null> {
  const clean = code.replace(/\s/g, "");
  const ok =
    method === "TOTP"
      ? Boolean(user.totpSecretEncrypted) && verifyTotp(decryptAtRest(user.totpSecretEncrypted!, env.ENCRYPTION_KEY), clean)
      : Boolean(c.smsCodeHash) && sha(clean) === c.smsCodeHash;
  if (!ok) return null;
  const codes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaMethod: method, totpEnabledAt: new Date(), mfaRecoveryCodes: codes.map(hashRecoveryCode), ...(method === "SMS" ? { totpSecretEncrypted: null } : {}) },
  });
  return codes;
}

/** Setup during sign-in, for staff whose ISP requires two-step login. */
export async function startSetupFromChallenge(token: string, method: "TOTP" | "SMS"): Promise<SetupStart> {
  const c = await loadChallenge(token, "setup");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  const res = await startSetup(user, method, c);
  (c as Challenge & { method?: string }).method = method;
  await saveChallenge(token, c);
  return res;
}

export async function confirmSetupFromChallenge(token: string, code: string): Promise<{ user: User; tokens: IssuedTokens; recoveryCodes: string[] }> {
  const c = (await loadChallenge(token, "setup")) as Challenge & { method?: "TOTP" | "SMS" };
  if (!c.method) throw new ValidationError("Choose how to receive codes first");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  const codes = await confirmSetup(user, c.method, code, c);
  if (!codes) return failTry(token, c);
  await redis.del(key(token));
  const tokens = await createSession(user.id, user.tenantId, c.device);
  return { user, tokens, recoveryCodes: codes };
}

/** Setup from the security settings of a signed-in user. The SMS code waits in Redis. */
const enrollKey = (userId: string) => `mfa:enroll:${userId}`;

export async function startSetupForUser(userId: string, method: "TOTP" | "SMS"): Promise<SetupStart> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Replacing the secret now would lock them out before the new one is confirmed.
  if (user.mfaMethod) throw new ConflictError("Two-step login is already on. Turn it off first to change how you get codes.");
  const c: Challenge = { userId, tenantId: user.tenantId, purpose: "setup", device: {}, tries: 0 };
  const res = await startSetup(user, method, c);
  await redis.set(enrollKey(userId), JSON.stringify({ ...c, method }), "EX", CHALLENGE_TTL);
  return res;
}

export async function confirmSetupForUser(userId: string, code: string): Promise<string[]> {
  const raw = await redis.get(enrollKey(userId));
  const c = raw ? (JSON.parse(raw) as Challenge & { method: "TOTP" | "SMS" }) : null;
  if (!c) throw new ConflictError("Setup has expired. Please start again.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const codes = await confirmSetup(user, c.method, code, c);
  if (!codes) {
    c.tries += 1;
    if (c.tries >= MAX_TRIES) await redis.del(enrollKey(userId));
    else await redis.set(enrollKey(userId), JSON.stringify(c), "EX", CHALLENGE_TTL);
    throw new UnauthorizedError("That code is not right. Please try again.");
  }
  await redis.del(enrollKey(userId));
  return codes;
}

async function assertPassword(user: User, password: string): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedError("Your password is not right");
}

/** Turning it off needs the account password, and isn't allowed where the ISP requires it. */
export async function disableForUser(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaMethod) throw new ConflictError("Two-step login is not on");
  if (await isMfaRequiredFor(user)) throw new ConflictError("Your ISP requires two-step login for staff, so it can't be turned off");
  await assertPassword(user, password);
  await prisma.user.update({ where: { id: userId }, data: { mfaMethod: null, totpSecretEncrypted: null, totpEnabledAt: null, mfaRecoveryCodes: [] } });
}

export async function regenerateRecoveryCodes(userId: string, password: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaMethod) throw new ConflictError("Two-step login is not on");
  await assertPassword(user, password);
  const codes = generateRecoveryCodes();
  await prisma.user.update({ where: { id: userId }, data: { mfaRecoveryCodes: codes.map(hashRecoveryCode) } });
  return codes;
}
