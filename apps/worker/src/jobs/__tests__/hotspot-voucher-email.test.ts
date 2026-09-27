import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const sendEmail = vi.fn();
vi.mock("@mashupkgrid/database", () => ({ prisma: { hotspotVoucher: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("../../lib/email.js", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

import { handleSendHotspotVoucherEmail } from "../send-hotspot-voucher-email.js";

const TENANT = "3f1c2b4a-1111-4222-8333-944455556666";

describe("hotspot voucher email", () => {
  beforeEach(() => {
    findUnique.mockReset();
    sendEmail.mockReset();
  });

  it("sends the code, the plan and how to use it, under the ISP's name", async () => {
    findUnique.mockResolvedValue({
      code: "AB12CD",
      durationMinutes: 1440,
      dataCapMb: null,
      expiresAt: null,
      tenant: { name: "Kona <Wi-Fi>", slug: "kona" },
      hotspotPackage: { name: "Daily", priceMinor: 5000, currency: "KES", durationMinutes: 1440, dataCapMb: null },
    });
    await handleSendHotspotVoucherEmail({ tenantId: TENANT, email: "jane@example.com", voucherCode: "AB12CD" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_code: { tenantId: TENANT, code: "AB12CD" } } }));
    const mail = sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe("jane@example.com");
    expect(mail.subject).toContain("AB12CD");
    expect(mail.text).toContain("Code: AB12CD");
    expect(mail.text).toContain("Plan: Daily");
    expect(mail.text).toContain("Valid for: 1 day");
    expect(mail.text).toContain("/hotspot/kona");
    expect(mail.html).toContain("Kona &lt;Wi-Fi&gt;");
    expect(mail.html).not.toContain("<Wi-Fi>");
  });

  it("sends nothing for a voucher that does not exist", async () => {
    findUnique.mockResolvedValue(null);
    await handleSendHotspotVoucherEmail({ tenantId: TENANT, email: "jane@example.com", voucherCode: "NOPE" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a job without a valid email", async () => {
    await expect(handleSendHotspotVoucherEmail({ tenantId: TENANT, email: "not-an-email", voucherCode: "AB12CD" })).rejects.toThrow();
  });
});
