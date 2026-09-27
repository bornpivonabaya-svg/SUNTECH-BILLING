import { describe, expect, it } from "vitest";
import { isPaidStkCallback } from "../poll.service.js";

const callback = (resultCode: number, receipt?: string) => ({
  Body: {
    stkCallback: {
      CheckoutRequestID: "ws_CO_1",
      ResultCode: resultCode,
      ResultDesc: "x",
      ...(receipt ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: 10 }, { Name: "MpesaReceiptNumber", Value: receipt }] } } : {}),
    },
  },
});

describe("which stored Safaricom callbacks prove a payment", () => {
  it("only a success with a receipt", () => {
    expect(isPaidStkCallback(callback(0, "UJR1234567"))).toBe(true);
    expect(isPaidStkCallback(callback(0))).toBe(false);
    expect(isPaidStkCallback(callback(1032))).toBe(false);
    expect(isPaidStkCallback(callback(4999))).toBe(false);
    expect(isPaidStkCallback({ nonsense: true })).toBe(false);
    expect(isPaidStkCallback(null)).toBe(false);
  });
});
