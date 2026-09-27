import { createSocket, type Socket } from "node:dgram";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@mashupkgrid/database";
import {
  createAdapterForRouter,
  findMacLogin,
  normalizeMac,
  rememberDevice,
  sessionNamesForVoucher,
  voucherUsageForSession,
  type MacLogin,
} from "@mashupkgrid/network";
import { timingSafeStringEqual } from "@mashupkgrid/shared";

/**
 * A real, minimal RADIUS server (RFC 2865/2866) for the case this platform actually hit during
 * hardware testing: MikroTik hotspot's `login-by=http-chap,http-pap` falls back to plain PAP
 * when the login form doesn't submit CHAP fields (this app's captive-portal page submits a plain
 * username/password, same as the router's own default login page would in non-JS mode) — and
 * without *something* listening on UDP 1812/1813, every Access-Request just times out, so the
 * router never unblocks the client no matter how correct the voucher/RADIUS-client config is.
 *
 * This is not a FreeRADIUS replacement — no CHAP, no EAP, no accounting persistence beyond
 * acknowledging the packet. It answers exactly what MikroTik hotspot's PAP flow needs against
 * the same `radcheck`/`radreply` tables voucher.service.ts already populates, and forwards the
 * `radreply` attributes those tables actually carry: `Session-Timeout` (standard, RFC 2865 §5.27
 * — without this, a voucher's `expiresAt` in *our* database has no effect on an already-active
 * hotspot session at all, since RADIUS is only consulted at login, not enforced continuously; a
 * live hAP lite test confirmed exactly this gap), `Mikrotik-Rate-Limit` (vendor-specific,
 * Vendor-Id 14988 sub-type 8), and `Mikrotik-Total-Limit`/`Mikrotik-Total-Limit-Gigawords`
 * (sub-types 17/18 — data-cap enforcement, confirmed against both the MikroTik Wiki's RADIUS
 * vendor dictionary and FreeRADIUS's dictionary.mikrotik).
 *
 * RouterOS's own real-time enforcement of Mikrotik-Total-Limit on Hotspot sessions is
 * documented by MikroTik's own community as unreliable/delayed (forum reports of caps not being
 * enforced until a session reset) — sending the attribute is still correct and done below, but
 * it is not trusted alone. The accounting listener (1813) is the actual enforcement path: it
 * accumulates each session's Acct-Input/Output-Octets from Interim-Update/Stop packets, compares
 * against the same cap, and force-disconnects the session on the router itself the moment the
 * cap is crossed — independent of whatever RouterOS was going to do on its own.
 *
 * Any reply attribute this server doesn't recognize is logged and skipped rather than guessed
 * at, since shipping a wrong vendor sub-attribute number silently breaks the reply instead of
 * just omitting it. A real production deployment should still run real FreeRADIUS (see
 * infrastructure/freeradius) once Linux infra is available — this exists so the platform's own
 * RADIUS-dependent features are actually testable without it.
 */

const RADIUS_CODE = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
} as const;

const ATTR = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  ACCT_STATUS_TYPE: 40,
  REPLY_MESSAGE: 18,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_INPUT_GIGAWORDS: 52,
  ACCT_OUTPUT_GIGAWORDS: 53,
  /** RFC 3579 §3.2. RouterOS 7.15+ ships require-message-auth=yes-for-request-resp by default
   *  (the BlastRADIUS mitigation), and a NAS in that mode DISCARDS an Access-Accept that has no
   *  Message-Authenticator — silently, so it looks exactly like the server never answered. */
  MESSAGE_AUTHENTICATOR: 80,
  // Session identity/detail, all RFC 2865/2866. Without these an accounting row cannot say
  // WHICH session it describes, so none of them are optional for persistence.
  NAS_IP_ADDRESS: 4,
  FRAMED_IP_ADDRESS: 8,
  FRAMED_PROTOCOL: 7,
  CALLED_STATION_ID: 30,
  CALLING_STATION_ID: 31,
  NAS_PORT_TYPE: 61,
  ACCT_SESSION_ID: 44,
  ACCT_SESSION_TIME: 46,
  ACCT_TERMINATE_CAUSE: 49,
  NAS_PORT_ID: 87,
} as const;

/** RFC 2866 §5.1 */
const ACCT_STATUS_TYPE = { START: 1, STOP: 2, INTERIM_UPDATE: 3 } as const;

interface RadiusAttribute {
  type: number;
  value: Buffer;
}

interface RadiusPacket {
  code: number;
  identifier: number;
  authenticator: Buffer;
  attributes: RadiusAttribute[];
}

function parsePacket(buf: Buffer): RadiusPacket | null {
  if (buf.length < 20) return null;
  const code = buf.readUInt8(0);
  const identifier = buf.readUInt8(1);
  const length = buf.readUInt16BE(2);
  const authenticator = buf.subarray(4, 20);
  if (length > buf.length) return null;

  const attributes: RadiusAttribute[] = [];
  let offset = 20;
  while (offset < length) {
    const type = buf.readUInt8(offset);
    const attrLen = buf.readUInt8(offset + 1);
    if (attrLen < 2 || offset + attrLen > length) break;
    attributes.push({ type, value: buf.subarray(offset + 2, offset + attrLen) });
    offset += attrLen;
  }
  return { code, identifier, authenticator, attributes };
}

function findAttr(packet: RadiusPacket, type: number): Buffer | null {
  return packet.attributes.find((a) => a.type === type)?.value ?? null;
}

function readUInt32Attr(packet: RadiusPacket, type: number): number {
  const buf = findAttr(packet, type);
  return buf && buf.length === 4 ? buf.readUInt32BE(0) : 0;
}

/** RFC 2865 §5.2 — PAP's User-Password attribute is XOR-obscured against successive MD5(secret
 *  + prior-16-byte-block) chunks, seeded by the Request Authenticator for the first block. */
function decodePapPassword(encrypted: Buffer, secret: string, requestAuthenticator: Buffer): string {
  const secretBuf = Buffer.from(secret, "utf8");
  const blocks = Math.ceil(encrypted.length / 16);
  const decrypted = Buffer.alloc(encrypted.length);
  let prevBlock = requestAuthenticator;

  for (let i = 0; i < blocks; i++) {
    const hash = createHash("md5").update(Buffer.concat([secretBuf, prevBlock])).digest();
    const cipherBlock = encrypted.subarray(i * 16, i * 16 + 16);
    for (let j = 0; j < cipherBlock.length; j++) {
      decrypted[i * 16 + j] = cipherBlock[j]! ^ hash[j]!;
    }
    prevBlock = cipherBlock;
  }
  // Password is NUL-padded to a 16-byte boundary, not length-prefixed — trim the padding.
  const nulIndex = decrypted.indexOf(0);
  return (nulIndex === -1 ? decrypted : decrypted.subarray(0, nulIndex)).toString("utf8");
}

function encodeAttribute(type: number, value: Buffer): Buffer {
  const header = Buffer.from([type, value.length + 2]);
  return Buffer.concat([header, value]);
}

/** RFC 2865 §3 — the reply's Response Authenticator is MD5(Code+ID+Length+RequestAuthenticator
 *  +Attributes+Secret), computed over the reply packet itself with the *request's* authenticator
 *  spliced in — this is what proves the reply actually came from whoever holds the shared
 *  secret, not just anyone who can send a UDP packet back to the NAS.
 *
 *  Access-Accept/Access-Reject additionally carry a Message-Authenticator (RFC 3579 §3.2).
 *  This is not optional in practice: RouterOS 7.15+ defaults to
 *  `require-message-auth=yes-for-request-resp` and a NAS in that mode drops a reply without one
 *  WITHOUT logging anything the operator can see — indistinguishable from the server being
 *  down, which is how it presented on a live hAP (the captive portal just sat on
 *  "Already authorizing, retry later"). Accounting-Response is excluded: RFC 3579 scopes the
 *  attribute to Access-* packets, and RouterOS does not expect it on accounting replies.
 *
 *  Order is load-bearing. The Message-Authenticator is HMAC-MD5 over the packet while its own
 *  16-byte value reads as zeroes AND the authenticator field still holds the REQUEST's
 *  authenticator; only once it is spliced in can the Response Authenticator be computed over
 *  the finished attribute buffer. Computing them the other way round yields a packet that every
 *  correct NAS rejects. */
function buildResponse(
  code: number,
  identifier: number,
  requestAuthenticator: Buffer,
  secret: string,
  attributes: RadiusAttribute[]
): Buffer {
  const withMessageAuthenticator =
    code === RADIUS_CODE.ACCESS_ACCEPT || code === RADIUS_CODE.ACCESS_REJECT;

  const allAttributes = withMessageAuthenticator
    ? [...attributes, { type: ATTR.MESSAGE_AUTHENTICATOR, value: Buffer.alloc(16) }]
    : attributes;

  const attrBuf = Buffer.concat(allAttributes.map((a) => encodeAttribute(a.type, a.value)));
  const length = 20 + attrBuf.length;
  const header = Buffer.alloc(4);
  header.writeUInt8(code, 0);
  header.writeUInt8(identifier, 1);
  header.writeUInt16BE(length, 2);

  if (withMessageAuthenticator) {
    // The zeroed value sits in the final 16 bytes of attrBuf (its attribute was appended last),
    // which is also exactly where the computed HMAC has to land.
    const messageAuthenticator = createHmac("md5", Buffer.from(secret, "utf8"))
      .update(Buffer.concat([header, requestAuthenticator, attrBuf]))
      .digest();
    messageAuthenticator.copy(attrBuf, attrBuf.length - 16);
  }

  const responseAuthenticator = createHash("md5")
    .update(Buffer.concat([header, requestAuthenticator, attrBuf, Buffer.from(secret, "utf8")]))
    .digest();

  return Buffer.concat([header, responseAuthenticator, attrBuf]);
}

/** RFC 2866 §3 — Accounting-Requests are authenticated with MD5(Code + ID + Length +
 * sixteen zero bytes + Attributes + shared secret). Never process an accounting update before
 * this check: otherwise anyone able to send UDP to port 1813 can fabricate usage and trigger a
 * customer's data-cap disconnect. */
function verifyAccountingRequest(packet: Buffer, secret: string): boolean {
  if (packet.length < 20) return false;
  const length = packet.readUInt16BE(2);
  if (length !== packet.length) return false;
  const expected = createHash("md5")
    .update(packet.subarray(0, 4))
    .update(Buffer.alloc(16))
    .update(packet.subarray(20, length))
    .update(Buffer.from(secret, "utf8"))
    .digest();
  return timingSafeEqual(expected, packet.subarray(4, 20));
}

/** The NAS row for a packet's source address. Returns tenantId alongside the secret because
 *  accounting rows are tenant-scoped and the packet itself carries no tenant identity — the
 *  source IP is the only thing that maps a session back to whose network it happened on. */
async function getNas(sourceAddress: string): Promise<{ secret: string; tenantId: string } | null> {
  const nas = await prisma.radiusNas.findFirst({
    where: { nasname: sourceAddress },
    select: { secret: true, tenantId: true },
  });
  return nas ?? null;
}

/** RFC 3579 §3.2 — an Access-Request's Message-Authenticator is HMAC-MD5 over the whole packet
 *  with that attribute's value zeroed, keyed by the shared secret. RouterOS 7 sends one. Returns
 *  null when the packet carries none (RouterOS 6), so the caller can't prove the sender. */
export function verifyRequestMessageAuthenticator(packet: Buffer, secret: string): boolean | null {
  if (packet.length < 20) return null;
  const length = Math.min(packet.readUInt16BE(2), packet.length);
  let offset = 20;
  while (offset + 2 <= length) {
    const type = packet[offset]!;
    const attrLen = packet[offset + 1]!;
    if (attrLen < 2 || offset + attrLen > length) return null;
    if (type === ATTR.MESSAGE_AUTHENTICATOR && attrLen === 18) {
      const copy = Buffer.from(packet.subarray(0, length));
      copy.fill(0, offset + 2, offset + 18);
      const expected = createHmac("md5", Buffer.from(secret, "utf8")).update(copy).digest();
      return timingSafeEqual(expected, packet.subarray(offset + 2, offset + 18));
    }
    offset += attrLen;
  }
  return null;
}

/**
 * The NAS a signed packet really came from. A router's RADIUS normally arrives from the address
 * its heartbeat registered (RadiusNas.nasname), but on a mobile network (CGNAT) the address
 * changes, can differ between its HTTP and UDP traffic, and can land on an address an old router
 * still holds — and then the router's requests were dropped or answered with the wrong secret,
 * which customers see as "Already authorizing, retry later". A signature proves the sender, so:
 * when the address is unknown, or its row's secret doesn't verify, find the router whose secret
 * does and move its registration to this address.
 */
async function resolveNas(
  sourceAddress: string,
  verify: (secret: string) => boolean | null
): Promise<{ secret: string; tenantId: string } | null> {
  const byAddress = await getNas(sourceAddress);
  // Verified, or nothing to prove the sender with (a RouterOS 6 Access-Request): trust the address.
  if (byAddress && verify(byAddress.secret) !== false) return byAddress;

  const candidates = await prisma.radiusNas.findMany({
    where: { nasname: { not: sourceAddress } },
    select: { id: true, secret: true, tenantId: true, routerId: true, nasname: true },
    take: 2000,
  });
  const owner = candidates.find((c) => verify(c.secret) === true);
  if (!owner) return null;

  // This address now belongs to the router that signed. A row still holding it (an old router,
  // or this router's previous address) gives way; the signer's row moves here.
  await prisma.$transaction([
    prisma.radiusNas.deleteMany({ where: { nasname: sourceAddress } }),
    prisma.radiusNas.update({ where: { id: owner.id }, data: { nasname: sourceAddress } }),
  ]);
  console.log(`[radius] router ${owner.routerId ?? owner.id} now sends RADIUS from ${sourceAddress} (was ${owner.nasname}); registration moved`);
  return { secret: owner.secret, tenantId: owner.tenantId };
}

async function checkCredentials(username: string, password: string): Promise<boolean> {
  const check = await prisma.radCheck.findFirst({
    where: { username, attribute: "Cleartext-Password" },
  });
  if (!check) return false;
  // op is always "==" for the Cleartext-Password rows this platform writes (voucher.service.ts,
  // radius-user provisioning) — a plain equality check matches what those rows actually mean,
  // but must still be constant-time: a `===` here leaks how many leading characters matched
  // through response-time differences, letting repeated Access-Requests narrow down a voucher
  // code character by character (the same class of oracle hotspot-account-login.service.ts is
  // deliberately hardened against with this same helper).
  const matches = timingSafeStringEqual(check.value, password);

  if (matches) {
    // The clock starts HERE — the router is asking to let this device on, which is the first
    // moment the customer is actually getting service. Starting it when the portal validated the
    // code instead meant a failed hand-off silently burned time the customer had paid for.
    // Idempotent: activateVoucher no-ops once the voucher has left UNUSED, so the many
    // Access-Requests of a normal session do not restart or extend anything.
    activateVoucherOnFirstAuth(username).catch((err) =>
      console.error(`[radius] could not activate voucher for "${username}":`, err)
    );
  }

  return matches;
}

/** Starts a voucher's validity window the first time its code authenticates. A username that is
 *  not a voucher (a PPPoE subscriber, say) simply has no row to update. */
async function activateVoucherOnFirstAuth(username: string): Promise<void> {
  const voucher = await prisma.hotspotVoucher.findFirst({
    where: { code: username, status: "UNUSED" },
    select: { id: true, durationMinutes: true },
  });
  if (!voucher) return;

  const now = new Date();
  await prisma.hotspotVoucher.updateMany({
    // Guarded on UNUSED so two simultaneous Access-Requests cannot both reset the window.
    where: { id: voucher.id, status: "UNUSED" },
    data: {
      status: "ACTIVE",
      activatedAt: now,
      expiresAt: voucher.durationMinutes
        ? new Date(now.getTime() + voucher.durationMinutes * 60_000)
        : null,
    },
  });
}

const MIKROTIK_VENDOR_ID = 14988;
const MIKROTIK_RATE_LIMIT_SUBTYPE = 8;
const MIKROTIK_TOTAL_LIMIT_SUBTYPE = 17;
const MIKROTIK_TOTAL_LIMIT_GIGAWORDS_SUBTYPE = 18;
const SESSION_TIMEOUT_TYPE = 27;
const VENDOR_SPECIFIC_TYPE = 26;
const U32_MAX_PLUS_ONE = 2 ** 32;

/** Splits a byte count that may exceed 32 bits into the (value, gigawords) pair RADIUS's
 *  32-bit counter attributes require — same convention RFC 2869's Acct-*-Gigawords uses for
 *  accounting octets, reused here since Mikrotik-Total-Limit is also a plain 32-bit integer. */
function encodeTotalLimitAttributes(totalBytes: number): RadiusAttribute[] {
  const remainder = totalBytes % U32_MAX_PLUS_ONE;
  const gigawords = Math.floor(totalBytes / U32_MAX_PLUS_ONE);
  const remainderBuf = Buffer.alloc(4);
  remainderBuf.writeUInt32BE(remainder, 0);
  const attributes = [encodeVendorSpecific(MIKROTIK_VENDOR_ID, MIKROTIK_TOTAL_LIMIT_SUBTYPE, remainderBuf)];
  if (gigawords > 0) {
    const gigawordsBuf = Buffer.alloc(4);
    gigawordsBuf.writeUInt32BE(gigawords, 0);
    attributes.push(encodeVendorSpecific(MIKROTIK_VENDOR_ID, MIKROTIK_TOTAL_LIMIT_GIGAWORDS_SUBTYPE, gigawordsBuf));
  }
  return attributes;
}

/** RFC 2865 §5.26 — a Vendor-Specific attribute wraps a 4-byte Vendor-Id followed by the
 *  vendor's own sub-attribute (its own type/length/value), all inside one outer type-26 TLV. */
function encodeVendorSpecific(vendorId: number, subType: number, value: Buffer): RadiusAttribute {
  const vendorIdBuf = Buffer.alloc(4);
  vendorIdBuf.writeUInt32BE(vendorId, 0);
  const subAttr = Buffer.concat([Buffer.from([subType, value.length + 2]), value]);
  return { type: VENDOR_SPECIFIC_TYPE, value: Buffer.concat([vendorIdBuf, subAttr]) };
}

/** Translates this username's `radreply` rows into real RADIUS reply attributes for the
 *  Access-Accept — see the module doc comment for exactly which attributes are supported and
 *  which are a known gap. */
async function buildReplyAttributes(username: string, remaining?: MacLogin): Promise<RadiusAttribute[]> {
  const replies = await prisma.radReply.findMany({ where: { username } });
  const attributes: RadiusAttribute[] = [];

  for (const reply of replies) {
    // A returning phone (login by MAC) gets the time and data left on its voucher instead.
    if (remaining && remaining.remainingSeconds !== null && reply.attribute === "Session-Timeout") continue;
    if (remaining && remaining.remainingBytes !== null && reply.attribute === "Mikrotik-Total-Limit") continue;
    if (reply.attribute === "Session-Timeout") {
      const seconds = Number(reply.value);
      if (Number.isFinite(seconds) && seconds > 0) {
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(Math.floor(seconds), 0);
        attributes.push({ type: SESSION_TIMEOUT_TYPE, value: buf });
      }
    } else if (reply.attribute === "Port-Limit") {
      const portLimit = Number(reply.value);
      if (Number.isFinite(portLimit) && portLimit > 0) {
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(Math.floor(portLimit), 0);
        attributes.push({ type: 62, value: buf }); // RFC 2865 Port-Limit
      }
    } else if (reply.attribute === "Mikrotik-Address-List") {
      // Vendor 14988, Subtype 19 = Mikrotik-Address-List
      attributes.push(
        encodeVendorSpecific(MIKROTIK_VENDOR_ID, 19, Buffer.from(reply.value, "utf8"))
      );
    } else if (reply.attribute === "Mikrotik-Rate-Limit") {
      attributes.push(
        encodeVendorSpecific(MIKROTIK_VENDOR_ID, MIKROTIK_RATE_LIMIT_SUBTYPE, Buffer.from(reply.value, "utf8"))
      );
    } else if (reply.attribute === "Mikrotik-Total-Limit") {
      const totalBytes = Number(reply.value);
      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        attributes.push(...encodeTotalLimitAttributes(Math.floor(totalBytes)));
      }
    } else {
      console.warn(
        `[radius] reply attribute "${reply.attribute}" for "${username}" is not yet forwarded by the embedded server (unimplemented encoding) — see radius-server.ts's doc comment`
      );
    }
  }
  if (remaining?.remainingSeconds != null) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(remaining.remainingSeconds, 0);
    attributes.push({ type: SESSION_TIMEOUT_TYPE, value: buf });
  }
  if (remaining?.remainingBytes != null) attributes.push(...encodeTotalLimitAttributes(remaining.remainingBytes));
  return attributes;
}

/** The actual data-cap enforcement path (see module doc comment): called on every
 *  Interim-Update/Stop accounting packet with that session's cumulative byte count. Looks up the
 *  same `Mikrotik-Total-Limit` radReply row the Access-Accept already sent, and — the moment
 *  usage reaches it — force-disconnects the session on the router directly, rather than trusting
 *  RouterOS to have acted on the attribute itself. */
async function enforceDataCap(voucherCode: string, username: string, nasAddress: string, totalBytes: number): Promise<void> {
  const cap = await prisma.radReply.findFirst({ where: { username: voucherCode, attribute: "Mikrotik-Total-Limit" } });
  if (!cap) return;
  const capBytes = Number(cap.value);
  if (!Number.isFinite(capBytes) || capBytes <= 0 || totalBytes < capBytes) return;

  // Resolve the router via its NAS registration first, and only fall back to matching on host.
  // `nasAddress` is where the accounting packet came FROM — the router's WAN address — while
  // `Router.host` becomes the WireGuard tunnel IP as soon as remote access is enabled. Matching
  // those two directly therefore finds nothing on exactly the routers most likely to be behind
  // CGNAT, and the cap silently stops being enforced (this function only warns). The RadiusNas
  // row is the mapping that is kept current for this purpose — completeRouterProvisioning
  // re-registers it from every heartbeat.
  const nas = await prisma.radiusNas.findFirst({
    where: { nasname: nasAddress },
    select: { routerId: true },
  });
  const router = nas?.routerId
    ? await prisma.router.findFirst({ where: { id: nas.routerId, deletedAt: null } })
    : await prisma.router.findFirst({ where: { host: nasAddress, deletedAt: null } });
  if (!router) {
    console.warn(
      `[radius] "${username}" exceeded its data cap (${totalBytes}/${capBytes} bytes) but no Router row matches NAS ${nasAddress} — cannot force-disconnect`
    );
    return;
  }

  const adapter = createAdapterForRouter({ ...router, host: router.host ?? nasAddress });
  try {
    await adapter.connect();
    await adapter.disconnectUser(username);
    console.log(
      `[radius] disconnected "${username}" from "${router.name}" — data cap exceeded (${totalBytes}/${capBytes} bytes)`
    );
  } catch (err) {
    console.error(`[radius] failed to force-disconnect "${username}" after its data cap was exceeded:`, err);
  } finally {
    await adapter.disconnect().catch(() => {});
  }
}

/** Persists the same accounting figure enforceDataCap already computed onto the matching
 *  voucher row, so "how much data has this customer used" is a plain DB read (for the staff
 *  purchases list, support tickets, etc.) instead of a live router round-trip that only works
 *  while the session is still active. A no-op for any username that isn't a voucher code (a
 *  PPPoE/account-login username, for instance) — those don't have a HotspotVoucher row to
 *  update, which is the normal, expected case for most accounting traffic. */
async function recordVoucherUsage(username: string, inputBytes: number, outputBytes: number): Promise<void> {
  await prisma.hotspotVoucher
    .updateMany({
      where: { code: username },
      data: { bytesIn: BigInt(inputBytes), bytesOut: BigInt(outputBytes), usageUpdatedAt: new Date() },
    })
    .catch((err) => console.error(`[radius] failed to record usage for "${username}":`, err));
}

/** Reads a string attribute, trimming the trailing NULs some NAS vendors pad with. */
function readStringAttr(packet: RadiusPacket, type: number): string | undefined {
  const buf = findAttr(packet, type);
  if (!buf) return undefined;
  // NUL bytes removed wherever they are, not just trailing padding: Postgres refuses text that
  // contains them, and one such field made every accounting row fail.
  const value = buf.toString("utf8").replace(/\0/g, "").trim();
  return value.length > 0 ? value : undefined;
}

const NAS_PORT_TYPE: Record<number, string> = { 0: "Async", 5: "Virtual", 15: "Ethernet", 19: "Wireless-802.11", 20: "Wireless-Other" };

/** NAS-Port-Type is an integer enum (RFC 2865 §5.41), not text. Read as text, its leading zero
 *  bytes made Postgres reject the whole accounting row. Stored by name; unknown values as numbers. */
function nasPortTypeName(packet: RadiusPacket): string | undefined {
  const buf = findAttr(packet, ATTR.NAS_PORT_TYPE);
  if (!buf || buf.length !== 4) return undefined;
  const code = buf.readUInt32BE(0);
  return NAS_PORT_TYPE[code] ?? String(code);
}

/** Dotted-quad out of a 4-byte address attribute. */
function readIpAttr(packet: RadiusPacket, type: number): string | undefined {
  const buf = findAttr(packet, type);
  if (!buf || buf.length !== 4) return undefined;
  return `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
}

/** RFC 2866 §5.5 — Acct-Terminate-Cause is an enum; store the name rather than the number so a
 *  report is readable without a lookup table. Unknown values keep their numeric form. */
const TERMINATE_CAUSE: Record<number, string> = {
  1: "User-Request", 2: "Lost-Carrier", 3: "Lost-Service", 4: "Idle-Timeout",
  5: "Session-Timeout", 6: "Admin-Reset", 7: "Admin-Reboot", 8: "Port-Error",
  9: "NAS-Error", 10: "NAS-Request", 11: "NAS-Reboot", 12: "Port-Unneeded",
  13: "Port-Preempted", 14: "Port-Suspended", 15: "Service-Unavailable",
  16: "Callback", 17: "User-Error", 18: "Host-Request",
};

/** Persists one Accounting-Request into `radacct` — the table every bandwidth and session
 *  report reads (see bandwidth-report.service.ts).
 *
 *  This is what makes usage real. Previously the accounting handler dropped Accounting-Start
 *  outright and only ever fed the octet counters to enforceDataCap/recordVoucherUsage, so
 *  nothing was ever written here: `radacct` stayed permanently empty and every bandwidth
 *  report rendered zeroes no matter how much traffic the network actually carried.
 *
 *  Keyed by acctUniqueId. FreeRADIUS synthesises that column the same way — a hash over the
 *  session id, the NAS and the user — because Acct-Session-Id is only unique per NAS, so two
 *  routers can and do issue the same one. Hashing all three is what keeps a START and its
 *  later INTERIM/STOP updating ONE row instead of accumulating duplicates. */
async function recordAccounting(
  packet: RadiusPacket,
  nasIpAddress: string,
  tenantId: string,
  statusType: number,
  username: string,
  inputBytes: number,
  outputBytes: number
): Promise<void> {
  const acctSessionId = readStringAttr(packet, ATTR.ACCT_SESSION_ID);
  if (!acctSessionId) return; // Nothing identifies the session; a row would be unattributable.

  const acctUniqueId = createHash("md5")
    .update(`${acctSessionId}|${nasIpAddress}|${username}`)
    .digest("hex");

  const now = new Date();
  const sessionTime = readUInt32Attr(packet, ATTR.ACCT_SESSION_TIME) || null;
  const terminateCauseCode = readUInt32Attr(packet, ATTR.ACCT_TERMINATE_CAUSE);

  const common = {
    acctUpdateTime: now,
    acctSessionTime: sessionTime,
    acctInputOctets: BigInt(inputBytes),
    acctOutputOctets: BigInt(outputBytes),
    framedIpAddress: readIpAttr(packet, ATTR.FRAMED_IP_ADDRESS),
    callingStationId: readStringAttr(packet, ATTR.CALLING_STATION_ID),
    calledStationId: readStringAttr(packet, ATTR.CALLED_STATION_ID),
    nasPortId: readStringAttr(packet, ATTR.NAS_PORT_ID),
    nasPortType: nasPortTypeName(packet),
  };

  const isStop = statusType === ACCT_STATUS_TYPE.STOP;
  const stopFields = isStop
    ? {
        acctStopTime: now,
        acctTerminateCause:
          terminateCauseCode > 0
            ? TERMINATE_CAUSE[terminateCauseCode] ?? String(terminateCauseCode)
            : null,
      }
    : {};

  await prisma.radAcct.upsert({
    where: { acctUniqueId },
    // An INTERIM or STOP whose START was missed (server restart, lost packet) still creates the
    // row: a session with slightly late start data beats a session that never appears at all.
    create: {
      tenantId,
      acctSessionId,
      acctUniqueId,
      username,
      nasIpAddress,
      acctStartTime: now,
      ...common,
      ...stopFields,
    },
    update: { ...common, ...stopFields },
  });
}

export interface RadiusServerHandle {
  close: () => Promise<void>;
}

/** Starts the auth (1812) and accounting (1813) UDP listeners. Every Accounting-Request gets an
 *  immediate Accounting-Response first (the NAS only needs the ack to stop retrying — that must
 *  never block on cap enforcement), then Interim-Update/Stop packets are checked against the
 *  session's data cap in the background (enforceDataCap). */
export function startRadiusServer(options: { authPort?: number; acctPort?: number } = {}): RadiusServerHandle {
  const authPort = options.authPort ?? 1812;
  const acctPort = options.acctPort ?? 1813;

  const authSocket: Socket = createSocket("udp4");
  authSocket.on("message", (msg, rinfo) => {
    void (async () => {
      const packet = parsePacket(msg);
      if (!packet || packet.code !== RADIUS_CODE.ACCESS_REQUEST) return;

      const nas = await resolveNas(rinfo.address, (secret) => verifyRequestMessageAuthenticator(msg, secret));
      if (!nas) {
        console.warn(`[radius] Access-Request from unknown NAS ${rinfo.address} — no matching RadiusNas row, and no router's secret signs it`);
        return;
      }
      const secret = nas.secret;

      try {
        const usernameBuf = findAttr(packet, ATTR.USER_NAME);
        const passwordBuf = findAttr(packet, ATTR.USER_PASSWORD);
        const username = usernameBuf?.toString("utf8") ?? "(missing)";
        const callingStationId = readStringAttr(packet, ATTR.CALLING_STATION_ID);
        let valid =
          usernameBuf && passwordBuf
            ? await checkCredentials(username, decodePapPassword(passwordBuf, secret, packet.authenticator))
            : false;

        // Login by MAC: the router asks with the phone's MAC as the username. Accepted only when
        // that phone last logged in with a voucher that still has time and data left, and only
        // for the phone actually asking (User-Name and Calling-Station-Id must be the same MAC).
        let macLogin: MacLogin | null = null;
        const usernameMac = normalizeMac(username);
        if (!valid && usernameMac && usernameMac === normalizeMac(callingStationId)) {
          macLogin = await findMacLogin(nas.tenantId, usernameMac);
          valid = macLogin !== null;
        }
        const voucherCode = macLogin?.voucherCode ?? username;

        // If credentials are valid, enforce simultaneous active devices limit if configured
        let rejectReason: string | null = null;
        if (valid) {
          const simCheck = await prisma.radCheck.findFirst({
            where: { username: voucherCode, attribute: "Simultaneous-Use" },
          });
          if (simCheck) {
            const maxDevices = parseInt(simCheck.value, 10);
            if (Number.isFinite(maxDevices) && maxDevices > 0) {
              // A voucher's sessions run under its code or under the MACs logged back in with it.
              const otherDevicesActive = await prisma.radAcct.count({
                where: {
                  username: { in: await sessionNamesForVoucher(nas.tenantId, voucherCode) },
                  acctStopTime: null,
                  ...(callingStationId ? { NOT: { callingStationId } } : {}),
                },
              });
              if (otherDevicesActive >= maxDevices) {
                console.warn(
                  `[radius] device limit reached for "${username}" (${otherDevicesActive}/${maxDevices} active sessions from other devices) — rejecting Access-Request`
                );
                valid = false;
                rejectReason = `Another device is already connected with this voucher (Limit: ${maxDevices} device${maxDevices > 1 ? "s" : ""}).`;
              }
            }
          }
        }

        const replyCode = valid ? RADIUS_CODE.ACCESS_ACCEPT : RADIUS_CODE.ACCESS_REJECT;
        const replyAttributes = valid
          ? await buildReplyAttributes(voucherCode, macLogin ?? undefined)
          : rejectReason
            ? [{ type: ATTR.REPLY_MESSAGE, value: Buffer.from(rejectReason, "utf8") }]
            : [];
        // A code login teaches us this phone, so its next reconnect can skip the sign-in page.
        if (valid && !macLogin) {
          rememberDevice(nas.tenantId, callingStationId, username).catch((err) =>
            console.error(`[radius] could not remember the device for "${username}":`, err)
          );
        }
        const response = buildResponse(replyCode, packet.identifier, packet.authenticator, secret, replyAttributes);
        authSocket.send(response, rinfo.port, rinfo.address);
        console.log(
          `[radius] ${valid ? "Access-Accept" : "Access-Reject"} for "${username}"${macLogin ? ` (returning phone, voucher ${macLogin.voucherCode})` : ""} from ${rinfo.address}`
        );
      } catch (err) {
        console.error("[radius] error handling Access-Request:", err);
      }
    })();
  });
  authSocket.bind(authPort, "0.0.0.0");

  const acctSocket: Socket = createSocket("udp4");
  acctSocket.on("message", (msg, rinfo) => {
    void (async () => {
      const packet = parsePacket(msg);
      if (!packet || packet.code !== RADIUS_CODE.ACCOUNTING_REQUEST) return;

      // Accounting is always signed with the secret (RFC 2866), so the sender is proven even on
      // RouterOS 6 — and an address change is picked up from it too.
      const nas = await resolveNas(rinfo.address, (secret) => verifyAccountingRequest(msg, secret));
      if (!nas) {
        console.warn(`[radius] Accounting-Request from ${rinfo.address} that no router's secret signs — dropped`);
        return;
      }
      const secret = nas.secret;

      const response = buildResponse(RADIUS_CODE.ACCOUNTING_RESPONSE, packet.identifier, packet.authenticator, secret, []);
      acctSocket.send(response, rinfo.port, rinfo.address);

      const statusType = readUInt32Attr(packet, ATTR.ACCT_STATUS_TYPE);

      const username = findAttr(packet, ATTR.USER_NAME)?.toString("utf8");
      if (!username) return;

      const inputBytes =
        readUInt32Attr(packet, ATTR.ACCT_INPUT_GIGAWORDS) * U32_MAX_PLUS_ONE +
        readUInt32Attr(packet, ATTR.ACCT_INPUT_OCTETS);
      const outputBytes =
        readUInt32Attr(packet, ATTR.ACCT_OUTPUT_GIGAWORDS) * U32_MAX_PLUS_ONE +
        readUInt32Attr(packet, ATTR.ACCT_OUTPUT_OCTETS);

      // Persist EVERY status type, Start included. Start is what makes a session visible while
      // it is still running; dropping it (as this handler used to) means a session only ever
      // appears once it is already over, and never at all if the client simply walks out of
      // range without the NAS sending a Stop.
      recordAccounting(packet, rinfo.address, nas.tenantId, statusType, username, inputBytes, outputBytes).catch(
        (err) => console.error(`[radius] error recording accounting for "${username}":`, err)
      );

      // Cap enforcement and voucher usage only make sense once counters exist — a Start carries
      // zeroes, and acting on those would reset a voucher's recorded usage to nothing.
      if (statusType !== ACCT_STATUS_TYPE.INTERIM_UPDATE && statusType !== ACCT_STATUS_TYPE.STOP) return;

      // Usage and caps belong to the voucher; its total is the device's starting usage plus this
      // session's own counters (see hotspot-device.service.ts).
      const usage = await voucherUsageForSession(nas.tenantId, username, readStringAttr(packet, ATTR.CALLING_STATION_ID), inputBytes, outputBytes);
      enforceDataCap(usage.voucherCode, username, rinfo.address, usage.bytesIn + usage.bytesOut).catch((err) =>
        console.error(`[radius] error enforcing data cap for "${username}":`, err)
      );
      recordVoucherUsage(usage.voucherCode, usage.bytesIn, usage.bytesOut).catch((err) =>
        console.error(`[radius] error recording usage for "${username}":`, err)
      );
    })().catch((err) => console.error("[radius] error handling Accounting-Request:", err));
  });
  acctSocket.bind(acctPort, "0.0.0.0");

  console.log(`[radius] embedded RADIUS server listening: auth=${authPort} acct=${acctPort}`);

  return {
    close: () =>
      Promise.all([
        new Promise<void>((resolve) => authSocket.close(() => resolve())),
        new Promise<void>((resolve) => acctSocket.close(() => resolve())),
      ]).then(() => undefined),
  };
}
