/**
 * Standalone pairing/smoke-test entry point — run this directly (`pnpm --filter
 * @mashupkgrid/whatsapp connect`) to link this machine to a real WhatsApp account and confirm
 * the connection actually works. Not part of the worker app's normal startup: pairing needs a
 * human present to scan the QR code, so it can't happen unattended the way the worker's other
 * background services do.
 *
 * First run: prints a QR code in this terminal. Open WhatsApp on your phone -> Settings (or the
 * ⋮ menu) -> Linked Devices -> Link a Device, and scan it. Once paired, the session is saved to
 * WHATSAPP_AUTH_STATE_PATH (packages/config) and every future run reconnects automatically with
 * no QR code needed, until that folder is deleted or the phone unlinks the device.
 *
 * Sends a "connected" confirmation message to WHATSAPP_TEST_RECIPIENT (your own number, in
 * E.164 — e.g. +2547XXXXXXXX) if that env var is set, then leaves the connection open so you can
 * watch incoming messages logged to the console. Ctrl+C to stop.
 */
import { env } from "@mashupkgrid/config";
import qrcode from "qrcode-terminal";
import { connectWhatsApp, sendWhatsAppMessage } from "./client.js";

async function main() {
  console.log(`[whatsapp] connecting (auth state: ${env.WHATSAPP_AUTH_STATE_PATH}) ...`);

  // Tracks whichever socket is *currently* live — right after a first-time pairing, WhatsApp's
  // servers commonly cycle the connection once more while finishing multi-device sync, and
  // connectWhatsApp() transparently reconnects with a brand new WASocket instance when that
  // happens. Closing over the socket connectWhatsApp() originally returned instead of tracking
  // the current one is what caused the first attempt here to fail with "Connection Closed" —
  // sendWhatsAppMessage was called on the already-dead original socket, not the reconnected one.
  let currentSock: Awaited<ReturnType<typeof connectWhatsApp>> | undefined;
  let testMessageSent = false;

  currentSock = await connectWhatsApp({
    authStatePath: env.WHATSAPP_AUTH_STATE_PATH,
    // Supplying onQr overrides client.ts's own default QR-drawing (see its doc comment), so this
    // must actually render the code itself, not just print instructions around it.
    onQr: (qr) => {
      console.log("\n[whatsapp] scan this QR code from your phone: WhatsApp > Linked Devices > Link a Device\n");
      qrcode.generate(qr, { small: true });
    },
    onReady: (sock) => {
      currentSock = sock;
      console.log("[whatsapp] connected! session saved — future runs will reconnect without a QR scan.");
      const testRecipient = process.env["WHATSAPP_TEST_RECIPIENT"];
      if (!testRecipient) {
        console.log(
          '[whatsapp] set WHATSAPP_TEST_RECIPIENT="+2547XXXXXXXX" in .env to auto-send a test message next run.'
        );
        return;
      }
      if (testMessageSent) return; // already delivered on an earlier "open" — don't resend on every reconnect
      sendWhatsAppMessage(sock, testRecipient, "✅ Suntech Billing WhatsApp bot is connected.")
        .then(() => {
          testMessageSent = true;
          console.log(`[whatsapp] test message sent to ${testRecipient}`);
        })
        .catch((err) =>
          console.error(
            "[whatsapp] failed to send test message (will retry automatically on the next stable reconnect):",
            err
          )
        );
    },
    onMessage: (from, text) => {
      console.log(`[whatsapp] message from ${from}: ${text}`);
    },
  });

  process.on("SIGINT", () => {
    console.log("\n[whatsapp] shutting down...");
    currentSock?.end(undefined);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[whatsapp] fatal error:", err);
  process.exitCode = 1;
});
