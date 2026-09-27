import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRequestMessageAuthenticator } from "../radius-server.js";

/** An Access-Request as RouterOS 7 sends it: User-Name, then a Message-Authenticator. */
function request(secret: string | null): Buffer {
  const user = Buffer.from("AA:BB:CC:DD:EE:01");
  const attrs = [Buffer.from([1, user.length + 2]), user];
  if (secret !== null) attrs.push(Buffer.from([80, 18]), Buffer.alloc(16));
  const body = Buffer.concat(attrs);
  const packet = Buffer.concat([Buffer.from([1, 7, 0, 20 + body.length]), Buffer.alloc(16, 9), body]);
  if (secret !== null) createHmac("md5", secret).update(packet).digest().copy(packet, packet.length - 16);
  return packet;
}

describe("proving which router sent a RADIUS request", () => {
  it("verifies RouterOS 7's Message-Authenticator against the right secret only", () => {
    expect(verifyRequestMessageAuthenticator(request("router-secret"), "router-secret")).toBe(true);
    expect(verifyRequestMessageAuthenticator(request("router-secret"), "another-router")).toBe(false);
  });

  it("can't tell without one (RouterOS 6) and doesn't choke on junk", () => {
    expect(verifyRequestMessageAuthenticator(request(null), "router-secret")).toBeNull();
    expect(verifyRequestMessageAuthenticator(Buffer.from([1, 2, 3]), "x")).toBeNull();
  });
});
