import { describe, expect, it } from "vitest";
import { isStkRequestOpen, isStkStillProcessing, STK_STILL_PROCESSING } from "../callback.service.js";

describe("an STK push still waiting for the customer's PIN", () => {
  it("reads Safaricom's 4999 'still under processing' as keep waiting, not a failure", () => {
    expect(isStkStillProcessing(STK_STILL_PROCESSING, "The transaction is still under processing")).toBe(true);
    expect(isStkStillProcessing(500, "The transaction is being processed")).toBe(true);
    expect(isStkStillProcessing(1032, "Request cancelled by user")).toBe(false);
    expect(isStkStillProcessing(1, "The balance is insufficient for the transaction")).toBe(false);
  });

  it("keeps a request marked failed on 'still under processing' open, so it is checked again", () => {
    expect(isStkRequestOpen({ status: "PENDING", resultCode: null, resultDesc: null })).toBe(true);
    expect(isStkRequestOpen({ status: "FAILED", resultCode: 4999, resultDesc: "The transaction is still under processing" })).toBe(true);
    expect(isStkRequestOpen({ status: "FAILED", resultCode: 1, resultDesc: "The balance is insufficient" })).toBe(false);
    expect(isStkRequestOpen({ status: "CANCELLED", resultCode: 1032, resultDesc: "Request cancelled by user" })).toBe(false);
    expect(isStkRequestOpen({ status: "COMPLETED", resultCode: 0, resultDesc: "ok" })).toBe(false);
  });
});
