import { buildApp, getPort } from "./app.js";
import { env } from "@mashupkgrid/config";
import { syncWireguardPeersFromDatabase } from "@mashupkgrid/network";
import { ensureDefaultPlans } from "./lib/default-plans.js";

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: getPort(), host: env.API_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // The WireGuard peer table is kernel state on an interface this container creates at startup,
  // so it comes up empty on every deploy. Replay it from the database or every VPN-linked router
  // silently loses remote access after a routine restart. Deliberately after listen() and never
  // awaited into the startup path: it is best-effort and must not delay or block serving.
  syncWireguardPeersFromDatabase()
    .then((restored) => {
      if (restored > 0) app.log.info(`Restored ${restored} WireGuard peer(s) from the database`);
    })
    .catch((err) => app.log.warn({ err }, "WireGuard peer replay failed; remote access may need re-registering"));

  // ISPs can upgrade from day one: a platform with no subscription plans gets a starting set.
  ensureDefaultPlans()
    .then((created) => {
      if (created > 0) app.log.info(`Created ${created} default subscription plan(s): edit them under Subscription plans`);
    })
    .catch((err) => app.log.warn({ err }, "Could not create the default subscription plans"));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully`);
      await app.close();
      process.exit(0);
    });
  }
}

main();
