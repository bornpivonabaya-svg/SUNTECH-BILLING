import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueue = vi.fn();
let queueDown = false;
// A plain function for the failure: a vi.fn that rejects leaves vitest's own copy of the
// promise unhandled, which fails the test even though the code under test caught it.
vi.mock("../queue.js", () => ({
  enqueueSendHotspotVoucherEmail: async (...a: unknown[]) => {
    if (queueDown) throw new Error("redis down");
    return enqueue(...a);
  },
}));

import { emailHotspotVoucherOnce, isRealBuyerEmail } from "../hotspot-voucher-email.js";

describe("emailing a purchased voucher", () => {
  beforeEach(() => {
    enqueue.mockReset();
    queueDown = false;
  });

  it("queues one email per voucher and address", async () => {
    await emailHotspotVoucherOnce("t1", "Jane@Example.com", "AB12CD");
    expect(enqueue).toHaveBeenCalledWith({ tenantId: "t1", email: "Jane@Example.com", voucherCode: "AB12CD" }, "AB12CD-jane@example.com");
  });

  it("skips purchases without a voucher or a real email", async () => {
    await emailHotspotVoucherOnce("t1", null, "AB12CD");
    await emailHotspotVoucherOnce("t1", "guest-254712345678@hotspot.local", "AB12CD");
    await emailHotspotVoucherOnce("t1", "jane@example.com", null);
    expect(enqueue).not.toHaveBeenCalled();
    expect(isRealBuyerEmail("guest-1@HOTSPOT.local")).toBe(false);
  });

  it("never throws when the queue is down", async () => {
    queueDown = true;
    await expect(emailHotspotVoucherOnce("t1", "jane@example.com", "AB12CD")).resolves.toBeUndefined();
  });
});
