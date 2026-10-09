import fs from "node:fs";
import path from "node:path";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  DisconnectReason,
  Browsers,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import { isBotSentMessage, isSelfChat, extractMessageText } from "./client.js";

/**
 * Runs one WhatsApp session per tenant, so every ISP messages its customers from its own number.
 *
 * This replaced a single platform-wide account shared by every tenant, which had two problems it
 * could not solve: an inbound message carried nothing identifying which ISP the sender was a
 * customer of (the bot had to literally ask), and every ISP's outbound messages appeared to come
 * from the same unrelated number. With a session per tenant both fall away — the socket a message
 * arrives on *is* the tenant.
 *
 * Session keys are persisted per tenant under `<baseAuthPath>/<tenantId>` via Baileys'
 * useMultiFileAuthState, so a worker restart silently reconnects every previously-paired tenant
 * without anyone rescanning a QR code.
 */

const silentLogger = pino({ level: "silent" });

export interface SessionManagerEvents {
  /** A fresh QR code needs scanning for this tenant (first pair, or after a logout). */
  onQr?: (tenantId: string, qr: string) => void;
  /** Session is authenticated and usable. `phoneNumber` is the linked WhatsApp account. */
  onReady?: (tenantId: string, phoneNumber: string) => void;
  /** `reconnecting` is the ordinary transient drop this manager recovers from on its own;
   *  `logged_out` means the phone unlinked the device and the saved keys are now dead. */
  onDisconnected?: (tenantId: string, reason: "reconnecting" | "logged_out") => void;
  /** `senderPhoneJid` is the sender's `<digits>@s.whatsapp.net`, or null when WhatsApp addressed
   *  them by a LID it wouldn't map to a number. */
  onMessage?: (tenantId: string, fromJid: string, text: string, senderPhoneJid: string | null) => void;
  /** An 8-character code the operator types into WhatsApp under Link with phone number, the
   *  alternative to scanning a QR. Emitted once per pairing attempt. */
  onPairingCode?: (tenantId: string, code: string) => void;
}

interface TenantSession {
  socket: WASocket | null;
  /** Set while a deliberate stop() is in flight, so the resulting "close" event is not treated as
   *  a dropped connection to reconnect from — otherwise disconnecting from the dashboard would
   *  immediately reconnect itself. */
  stopping: boolean;
}

const PHONE_JID = /^\d+@s\.whatsapp\.net$/;

/** The sender's phone-number JID. WhatsApp addresses many chats by a LID (a hidden id, not a
 *  number); the bot needs the real number to look up balances and send M-Pesa prompts, so a LID
 *  is mapped back through the message itself or Baileys' LID store. */
async function senderPhoneJid(sock: WASocket, msg: { key: { remoteJidAlt?: string | null } }, from: string, isSelf: boolean): Promise<string | null> {
  const bare = (jid: string) => `${jid.split("@")[0]!.split(":")[0]}@s.whatsapp.net`;
  if (from.endsWith("@s.whatsapp.net")) return bare(from);
  if (isSelf) {
    const me = sock.user?.id ?? (sock.authState?.creds?.me as { id?: string } | undefined)?.id;
    return me ? bare(me) : null;
  }
  const alt = msg.key.remoteJidAlt;
  if (alt && alt.endsWith("@s.whatsapp.net")) return bare(alt);
  try {
    const pn = await sock.signalRepository.lidMapping.getPNForLID(from);
    if (pn && pn.includes("@s.whatsapp.net")) {
      const jid = bare(pn);
      return PHONE_JID.test(jid) ? jid : null;
    }
  } catch {
    // No mapping stored yet — reported as unknown below.
  }
  return null;
}

/** Baileys wraps disconnect reasons as Boom errors whose HTTP-style status is a DisconnectReason.
 *  Reading it through a narrow type guard avoids depending on @hapi/boom for one field. */
function disconnectStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "output" in err) {
    const output = (err as { output?: { statusCode?: unknown } }).output;
    if (output && typeof output.statusCode === "number") return output.statusCode;
  }
  return undefined;
}

/** `sock.user.id` looks like "254703605266:12@s.whatsapp.net" — the digits before the colon are
 *  the linked account's actual number. */
function phoneFromSocket(sock: WASocket): string {
  const raw = sock.user?.id ?? "";
  const digits = raw.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits ? `+${digits}` : "";
}

export const PLATFORM_SESSION_ID = "platform";

export function normalizeSessionId(tenantId: string | null | undefined): string {
  return tenantId ?? PLATFORM_SESSION_ID;
}

export class WhatsAppSessionManager {
  private sessions = new Map<string, TenantSession>();

  constructor(
    private readonly baseAuthPath: string,
    private readonly events: SessionManagerEvents = {}
  ) {}

  /** Currently-usable socket for a tenant (or platform if null), or null if it isn't connected right now.
   *  Callers must re-read this per send rather than caching it: reconnects replace the socket instance. */
  get(tenantId: string | null | undefined): WASocket | null {
    const id = normalizeSessionId(tenantId);
    return this.sessions.get(id)?.socket ?? null;
  }

  isConnected(tenantId: string | null | undefined): boolean {
    return this.get(tenantId) !== null;
  }

  connectedTenantIds(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.socket !== null).map(([id]) => id);
  }

  /**
   * Starts (or restarts) a tenant's session (or platform session if null). Safe to call when one is
   * already live — that's a no-op rather than a second competing socket for the same account.
   *
   * @param options.forceClean  When true, wipes any stored auth keys before connecting so a fresh
   *   QR is emitted. Only user-initiated "Connect" should set this — auto-reconnects after a
   *   transient drop must NOT, otherwise every network blip destroys the pairing.
   */
  async start(
    tenantId: string | null | undefined,
    options: { pairWithPhoneNumber?: string; forceClean?: boolean } = {}
  ): Promise<void> {
    const id = normalizeSessionId(tenantId);
    const existing = this.sessions.get(id);

    // Only an ALREADY-PAIRED session is left alone. Bailing out on the mere presence of a socket
    // is what made re-pairing impossible: an unauthenticated socket from a previous attempt is
    // still a socket, so once its QR expired (60s in Redis) every subsequent "Connect" returned
    // here instantly — no new QR was ever published, and requestPairingCode below never ran
    // either, so phone-number linking failed the same silent way. The only recovery was
    // restarting the worker. A half-open or dead socket is now torn down and replaced.
    if (existing?.socket?.authState?.creds?.registered) {
      // Re-assert CONNECTED rather than just returning. The API flips the row to CONNECTING the
      // moment the button is pressed, so a silent return on an already-paired line leaves the
      // dashboard reading "Waiting for scan" for a session that is in fact working.
      this.events.onReady?.(id, phoneFromSocket(existing.socket));
      return;
    }
    if (existing?.socket) await this.stop(tenantId);

    const sessionDir = path.join(this.baseAuthPath, id);
    // Only wipe auth when explicitly asked (user pressed "Connect" in the dashboard).
    // Auto-reconnects after transient drops must NOT wipe — doing so destroys the pairing
    // and forces a new QR scan on every network blip.
    if (options.forceClean) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[whatsapp] failed to clear auth for ${id}:`, err);
      }
    }

    const session: TenantSession = { socket: null, stopping: false };
    session.stopping = false;
    this.sessions.set(id, session);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestWaWebVersion({});

    const sock = makeWASocket({
      version,
      auth: state,
      logger: silentLogger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: false,
    });
    sock.ev.on("creds.update", saveCreds);

    // Phone-number pairing is an alternative to the QR, not an addition to it: WhatsApp issues
    // one or the other per attempt. It is only valid on an unregistered session -- asking for a
    // code on an already-linked one throws -- and Baileys requires the number as bare digits
    // with no "+" or separators.
    if (options.pairWithPhoneNumber && !sock.authState.creds.registered) {
      const digits = options.pairWithPhoneNumber.replace(/\D/g, "");
      try {
        // Allow the socket handshake to initialize before requesting the code
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const code = await sock.requestPairingCode(digits);
        this.events.onPairingCode?.(id, code);
      } catch (err) {
        // Surfaced as a normal disconnect so the dashboard shows why instead of hanging on
        // "connecting" forever with no explanation.
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[whatsapp] pairing code request failed for ${id}:`, message);
        this.events.onDisconnected?.(id, "reconnecting");
        throw err;
      }
    }

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // When pairing with phone number, ignore QR emissions so the pairing code is not clobbered
      if (qr && !options.pairWithPhoneNumber) this.events.onQr?.(id, qr);

      if (connection === "open") {
        session.socket = sock;
        this.events.onReady?.(id, phoneFromSocket(sock));
      }

      if (connection === "close") {
        session.socket = null;
        if (session.stopping) return; // deliberate stop() — do not resurrect it

        const loggedOut = disconnectStatusCode(lastDisconnect?.error) === DisconnectReason.loggedOut;
        if (loggedOut) {
          this.events.onDisconnected?.(id, "logged_out");
          this.sessions.delete(id);
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          } catch (err) {
            console.warn(`[whatsapp] failed to clear auth for ${id} after logout:`, err);
          }
          return;
        }
        this.events.onDisconnected?.(id, "reconnecting");
        void this.start(id).catch((err) =>
          console.error(`[whatsapp] reconnect failed for ${id}:`, err)
        );
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if ((type !== "notify" && type !== "append") || !this.events.onMessage) return;
      for (const msg of messages) {
        const from = msg.key.remoteJid;
        const text = extractMessageText(msg);
        if (!from || !text) continue;
        if (from === "status@broadcast" || from.endsWith("@broadcast") || from.endsWith("@g.us") || from.endsWith("@newsletter")) continue;

        const isSelf = isSelfChat(sock, from);
        const fromMe = Boolean(msg.key.fromMe);

        console.log(`[whatsapp] [${id}] message: from=${from} fromMe=${fromMe} isSelf=${isSelf} text="${text.slice(0, 30)}"`);

        // Discard messages generated by the bot itself to prevent infinite loops
        if (isBotSentMessage(msg.key.id, text)) {
          console.log(`[whatsapp] [${id}] ignoring bot-generated message id=${msg.key.id}`);
          continue;
        }

        // Allow messages from outside, or messages typed to oneself from the paired device
        if (!fromMe || isSelf) {
          const onMessage = this.events.onMessage;
          void senderPhoneJid(sock, msg, from, isSelf).then((phoneJid) => onMessage(id, from, text, phoneJid));
        }
      }
    });
  }

  /** Closes a tenant's session without reconnecting. Can optionally delete the stored keys. */
  async stop(tenantId: string | null | undefined, options: { deleteAuth?: boolean } = {}): Promise<void> {
    const id = normalizeSessionId(tenantId);
    const session = this.sessions.get(id);
    if (session) {
      session.stopping = true;
      try {
        session.socket?.end(undefined);
      } catch {
        // Already dead — nothing to close.
      }
      session.socket = null;
      this.sessions.delete(id);
    }
    if (options.deleteAuth) {
      try {
        fs.rmSync(path.join(this.baseAuthPath, id), { recursive: true, force: true });
      } catch (err) {
        console.warn(`[whatsapp] failed to delete auth for ${id}:`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }
}
