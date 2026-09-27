import { describe, expect, it, vi } from "vitest";

vi.mock("@mashupkgrid/database", () => ({ prisma: {} }));

import { isTrialExemptPath } from "../tenant.js";

describe("what an expired-trial tenant can still reach", () => {
  it("lets them see and pay for their subscription", () => {
    expect(isTrialExemptPath("/api/v1/billing")).toBe(true);
    expect(isTrialExemptPath("/api/v1/billing?x=1")).toBe(true);
    expect(isTrialExemptPath("/api/v1/billing/renew")).toBe(true);
    expect(isTrialExemptPath("/api/v1/auth/me")).toBe(true);
    expect(isTrialExemptPath("/api/v1/notifications")).toBe(true);
  });

  it("blocks everything else, including look-alike paths", () => {
    expect(isTrialExemptPath("/api/v1/customers")).toBe(false);
    expect(isTrialExemptPath("/api/v1/routers/abc")).toBe(false);
    expect(isTrialExemptPath("/api/v1/billing-export")).toBe(false);
    expect(isTrialExemptPath("/api/v1/authx")).toBe(false);
  });
});
