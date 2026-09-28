import { beforeEach, describe, expect, it } from "vitest";
import { resetWinboxRelayHostCache, winboxRelayHost } from "../winbox-relay-host.js";

const dns = (records: Record<string, string[]>) => async (host: string) => {
  if (!records[host]) throw new Error(`ENOTFOUND ${host}`);
  return records[host]!;
};
const opts = { apiUrl: "https://api.mashuphost.tech", fallback: "68.210.187.104" };

describe("the remote WinBox address", () => {
  beforeEach(() => resetWinboxRelayHostCache());

  it("is winbox.<domain> when that name already points at the API's server (the * record)", async () => {
    const lookup = dns({ "api.mashuphost.tech": ["68.210.187.104"], "winbox.mashuphost.tech": ["68.210.187.104"] });
    expect(await winboxRelayHost(opts, lookup)).toBe("winbox.mashuphost.tech");
  });

  it("is the API's name when winbox.<domain> doesn't exist or points elsewhere (e.g. through a proxy)", async () => {
    expect(await winboxRelayHost(opts, dns({ "api.mashuphost.tech": ["68.210.187.104"] }))).toBe("api.mashuphost.tech");
    resetWinboxRelayHostCache();
    const proxied = dns({ "api.mashuphost.tech": ["68.210.187.104"], "winbox.mashuphost.tech": ["104.21.3.4"] });
    expect(await winboxRelayHost(opts, proxied)).toBe("api.mashuphost.tech");
  });

  it("uses an explicit setting, and the endpoint when there is no API name", async () => {
    expect(await winboxRelayHost({ ...opts, override: "wb.example.com" }, dns({}))).toBe("wb.example.com");
    expect(await winboxRelayHost({ apiUrl: "http://192.168.1.183:4000", fallback: "192.168.1.183" }, dns({}))).toBe("192.168.1.183");
  });

  it("works for a two-part domain suffix (api.acme.co.ke → winbox.acme.co.ke)", async () => {
    const lookup = dns({ "api.acme.co.ke": ["1.2.3.4"], "winbox.acme.co.ke": ["1.2.3.4"] });
    expect(await winboxRelayHost({ apiUrl: "https://api.acme.co.ke", fallback: "1.2.3.4" }, lookup)).toBe("winbox.acme.co.ke");
  });
});
