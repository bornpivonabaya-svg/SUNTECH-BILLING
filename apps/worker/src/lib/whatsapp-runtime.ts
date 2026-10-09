import * as fs from "node:fs";
import path from "node:path";
import { env } from "@mashupkgrid/config";
import { prisma } from "@mashupkgrid/database";
import {
  WhatsAppSessionManager,
  publishPairingQr,
  publishPairingCode,
  clearPairingQr,
  setConnectionStatus,
  listTenantsToRestore,
  sendWhatsAppMessage,
  type WASocket,
} from "@mashupkgrid/whatsapp";
import { handleIncomingWhatsAppMessage } from "./whatsapp-bot.js";

/**
 * Owns every WhatsApp session this worker holds, and is the only place the rest of the worker
 * asks "which socket do I send this on".
 *
 * Two kinds of session live here:
 *  - One per tenant, linked by that ISP from their own dashboard. Everything customer-facing goes
 *    out on these, so each ISP's messages come from its own number.
 *  - A single "platform" session, for the handful of messages that belong to no tenant yet —
 *    an ISP-registration OTP and the welcome that follows are both sent *before* the tenant has
 *    had any chance to link an account of their own.
 */

/** Reserved session id for the platform's own line. Not a tenant id — real ones are UUIDs, so
 *  this can never collide with a tenant's directory. */
export const PLATFORM_SESSION_ID = "platform";

/** The session manager keys the platform line by PLATFORM_SESSION_ID; the connection service
 *  keys it by a null tenantId, matching the database row. This maps between the two. */
function toScope(sessionId: string): string | null {
  return sessionId === PLATFORM_SESSION_ID ? null : sessionId;
}

/**
 * The platform session originally lived directly in WHATSAPP_AUTH_STATE_PATH, before sessions
 * were per-tenant subdirectories. Moving those files into the "platform" subdirectory on first
 * boot keeps an already-paired line working instead of silently demanding a fresh QR scan for a
 * connection the operator had already set up.
 */
function migrateLegacyPlatformSession(basePath: string): void {
  const legacyCreds = path.join(basePath, "creds.json");
  const targetDir = path.join(basePath, PLATFORM_SESSION_ID);
  if (!fs.existsSync(legacyCreds) || fs.existsSync(path.join(targetDir, "creds.json"))) return;

  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    fs.renameSync(path.join(basePath, entry.name), path.join(targetDir, entry.name));
  }
  console.log(`[whatsapp] migrated existing platform session into ${targetDir}`);
}

let manager: WhatsAppSessionManager | null = null;

export function getManager(): WhatsAppSessionManager | null {
  return manager;
}

/**
 * Resolves the socket a message should go out on. A null tenantId means "platform-level". A
 * tenant that has not linked its own account falls back to the platform line rather than failing
 * outright — an ISP that has not finished setup should still get its customers' vouchers
 * delivered, from whatever line is available.
 */
export function resolveSocket(tenantId: string | null): WASocket | null {
  if (!manager) return null;
  if (tenantId) {
    const tenantSocket = manager.get(tenantId);
    if (tenantSocket) return tenantSocket;
  }
  return manager.get(PLATFORM_SESSION_ID);
}

export async function startWhatsAppRuntime(): Promise<WhatsAppSessionManager> {
  const basePath = env.WHATSAPP_AUTH_STATE_PATH;
  fs.mkdirSync(basePath, { recursive: true });
  migrateLegacyPlatformSession(basePath);

  manager = new WhatsAppSessionManager(basePath, {
    onPairingCode: (sessionId, code) => {
      console.log(`[whatsapp] pairing code issued for ${sessionId}`);
      void publishPairingCode(toScope(sessionId), code).catch((err) =>
        console.error(`[whatsapp] failed to publish pairing code for ${sessionId}:`, err)
      );
    },

    onQr: (sessionId, qr) => {
      // The platform QR is now published exactly like a tenant's, so the super-admin page can
      // render it. It used to be suppressed here, which left the connect script over SSH as the
      // only way to pair the platform line -- nobody without shell access could restore it.
      void publishPairingQr(toScope(sessionId), qr).catch((err) =>
        console.error(`[whatsapp] failed to publish QR for ${sessionId}:`, err)
      );
    },

    onReady: (sessionId, phoneNumber) => {
      console.log(`[whatsapp] connected: ${sessionId}${phoneNumber ? ` (${phoneNumber})` : ""}`);
      const scope = toScope(sessionId);
      void clearPairingQr(scope).catch(() => {});
      void setConnectionStatus(scope, "CONNECTED", { phoneNumber }).catch((err) =>
        console.error(`[whatsapp] failed to record CONNECTED for ${sessionId}:`, err)
      );
    },

    onDisconnected: (sessionId, reason) => {
      console.log(`[whatsapp] ${sessionId} disconnected (${reason})`);
      // A transient drop keeps the row CONNECTING (the manager is already reconnecting behind
      // it); a logout is terminal until someone re-pairs, and says so.
      const status = reason === "logged_out" ? "LOGGED_OUT" : "CONNECTING";
      const lastError =
        reason === "logged_out"
          ? "This device was unlinked from WhatsApp - pair it again to reconnect."
          : null;
      void setConnectionStatus(toScope(sessionId), status, { lastError }).catch((err) =>
        console.error(`[whatsapp] failed to record disconnect for ${sessionId}:`, err)
      );
    },

    onMessage: async (tenantId, fromJid, text, senderPhoneJid) => {
      if (fromJid === "status@broadcast" || fromJid.endsWith("@broadcast") || fromJid.endsWith("@g.us") || fromJid.endsWith("@newsletter")) return;

      // If message arrives on the platform session, route to the default/first active ISP tenant
      // so operators and customers still get interactive bot responses, or send platform greeting.
      if (tenantId === PLATFORM_SESSION_ID) {
        console.log(`[whatsapp] (platform) message from ${fromJid}: ${text}`);
        try {
          const activeTenant = await prisma.tenant.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          if (activeTenant) {
            handleIncomingWhatsAppMessage(
              manager?.get(PLATFORM_SESSION_ID) ?? null,
              activeTenant.id,
              fromJid,
              text,
              senderPhoneJid
            ).catch((err) =>
              console.error("[whatsapp] failed to handle platform-routed message:", err)
            );
            return;
          }
        } catch (err) {
          console.error("[whatsapp] failed to route platform message to active tenant:", err);
        }

        const sock = manager?.get(PLATFORM_SESSION_ID);
        if (sock) {
          void sendWhatsAppMessage(
            sock,
            fromJid,
            "✅ *MashupKgrid Platform WhatsApp is online.*\n\nReply \"menu\" to start, or configure your ISP tenant in the dashboard."
          ).catch((err) => console.error("[whatsapp] failed to send platform reply:", err));
        }
        return;
      }
      void handleIncomingWhatsAppMessage(manager?.get(tenantId) ?? null, tenantId, fromJid, text, senderPhoneJid);
    },
  });

  // Bring back the platform session if enabled OR if it was already connected in DB or has auth keys
  const platformRow = await prisma.whatsappConnection
    .findFirst({
      where: { tenantId: null, status: { in: ["CONNECTED", "CONNECTING"] } },
    })
    .catch(() => null);

  const hasPlatformCreds = fs.existsSync(path.join(basePath, PLATFORM_SESSION_ID, "creds.json"));

  if (env.ENABLE_WHATSAPP_BOT || platformRow || hasPlatformCreds) {
    console.log("[whatsapp] starting platform WhatsApp session on worker boot");
    try {
      await manager.start(PLATFORM_SESSION_ID);
    } catch (err) {
      console.error("[whatsapp] failed to start platform WhatsApp session:", err);
    }
  }

  // Restore every tenant that was linked or has saved credentials on disk
  const restoreTenants = new Set(await listTenantsToRestore());
  try {
    if (fs.existsSync(basePath)) {
      for (const ent of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (ent.isDirectory() && ent.name !== PLATFORM_SESSION_ID) {
          if (fs.existsSync(path.join(basePath, ent.name, "creds.json"))) {
            restoreTenants.add(ent.name);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[whatsapp] failed to scan saved sessions for restore:", err);
  }

  for (const tenantId of restoreTenants) {
    try {
      console.log(`[whatsapp] restoring session for tenant ${tenantId}`);
      await manager.start(tenantId);
    } catch (err) {
      console.error(`[whatsapp] failed to restore session for tenant ${tenantId}:`, err);
    }
  }

  return manager;
}
