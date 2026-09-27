import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class APIError extends Error {
    status = 500;
  }
  const create = vi.fn();
  class Anthropic {
    static APIError = APIError;
    beta = { messages: { create } };
  }
  return {
    create,
    Anthropic,
    prisma: {
      supportChat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
      supportChatMessage: { create: vi.fn(), findMany: vi.fn() },
      tenant: { findUniqueOrThrow: vi.fn() },
      paymentProviderConfig: { findFirst: vi.fn() },
      customer: { findFirstOrThrow: vi.fn(), findUniqueOrThrow: vi.fn() },
      payment: { findMany: vi.fn() },
      networkMaintenance: { findMany: vi.fn() },
    },
    support: { createTicket: vi.fn(), addTicketMessage: vi.fn() },
    getKey: vi.fn(),
  };
});

vi.mock("@anthropic-ai/sdk", () => ({ default: h.Anthropic }));
vi.mock("@mashupkgrid/database", () => ({ prisma: h.prisma }));
vi.mock("@mashupkgrid/support", () => h.support);
vi.mock("../config.service.js", () => ({ getAiAssistantApiKey: h.getKey }));

import { answerSupportMessage } from "../support-assistant.service.js";

const TENANT = "t1";
const CUSTOMER = "c1";
const chat = { id: "chat1", tenantId: TENANT, customerId: CUSTOMER, channel: "APP", status: "OPEN", ticketId: null };
const toolUse = (name: string, input: object = {}) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu-${name}`, name, input }] });
const text = (t: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

describe("answerSupportMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getKey.mockResolvedValue("sk-test");
    h.prisma.supportChat.findFirst.mockResolvedValue(chat);
    h.prisma.supportChat.findUniqueOrThrow.mockResolvedValue({ ticketId: "ticket-abcdef12-xyz" });
    h.prisma.supportChatMessage.findMany.mockResolvedValue([{ role: "user", content: "Mbona internet haiko?" }]);
    h.prisma.tenant.findUniqueOrThrow.mockResolvedValue({ name: "Demo ISP" });
    h.prisma.paymentProviderConfig.findFirst.mockResolvedValue({ shortcode: "123456" });
    h.prisma.customer.findFirstOrThrow.mockResolvedValue({
      fullName: "Jane Wanjiku",
      customerNumber: "CUS-000001",
      services: [{ status: "SUSPENDED", pausedUntil: null, priceOverrideMinor: null, nextBillingAt: new Date("2026-10-26"), package: { name: "Home 10", downloadKbps: 10000, uploadKbps: 5000, priceMinor: 100000, currency: "KES", billingCycle: "MONTHLY" } }],
      wallet: { balanceMinor: 0 },
      invoices: [{ invoiceNumber: "INV-1", totalMinor: 116000, amountPaidMinor: 0, dueDate: new Date("2026-09-20"), status: "OVERDUE", currency: "KES" }],
    });
    h.prisma.customer.findUniqueOrThrow.mockResolvedValue({ fullName: "Jane Wanjiku", phone: "+254700000001" });
    h.support.createTicket.mockResolvedValue({ id: "abcdef12-3456" });
    h.support.addTicketMessage.mockResolvedValue({});
  });

  it("looks up the customer's own account, then answers", async () => {
    h.create.mockResolvedValueOnce(toolUse("get_account")).mockResolvedValueOnce(text("Huduma yako imesimamishwa kwa sababu ya bili ya KES 1,160."));
    const res = await answerSupportMessage({ tenantId: TENANT, customerId: CUSTOMER, channel: "APP", message: "Mbona internet haiko?" });
    expect(res).toMatchObject({ chatId: "chat1", handedOver: false, reply: expect.stringContaining("KES 1,160") });
    // The lookup is pinned to this customer in this ISP.
    expect(h.prisma.customer.findFirstOrThrow.mock.calls[0]![0].where).toEqual({ id: CUSTOMER, tenantId: TENANT });
    // The account came back to the model as a tool result.
    const second = h.create.mock.calls[1]![0];
    expect(JSON.stringify(second.messages.at(-1))).toContain("INV-1");
    // Request shape: current model, refusal fallback, cached system prompt with the paybill.
    expect(second).toMatchObject({ model: "claude-opus-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(second.system[0].text).toContain("Paybill 123456");
    expect(second.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(h.prisma.supportChatMessage.create).toHaveBeenLastCalledWith({ data: { chatId: "chat1", role: "assistant", content: expect.stringContaining("KES 1,160") } });
  });

  it("hands over to staff with the conversation on the ticket", async () => {
    h.prisma.supportChat.findFirst.mockResolvedValue({ ...chat, channel: "WHATSAPP" });
    h.create.mockResolvedValueOnce(toolUse("hand_over_to_staff", { subject: "No internet", summary: "Paid but still off", urgent: true })).mockResolvedValueOnce(text("A person will reply soon. Ticket ABCDEF12."));
    h.prisma.supportChatMessage.findMany.mockResolvedValueOnce([{ role: "user", content: "I paid!" }]).mockResolvedValueOnce([{ role: "user", content: "I paid!", createdAt: new Date() }]);
    const res = await answerSupportMessage({ tenantId: TENANT, customerId: CUSTOMER, channel: "WHATSAPP", message: "I paid!" });
    expect(res).toMatchObject({ handedOver: true, ticketNumber: "ABCDEF12" });
    const ticket = h.support.createTicket.mock.calls[0]![1];
    expect(ticket).toMatchObject({ customerId: CUSTOMER, subject: "No internet", priority: "HIGH", source: "WHATSAPP" });
    expect(ticket.body).toContain("Customer: I paid!");
    expect(h.prisma.supportChat.update).toHaveBeenCalledWith({ where: { id: "chat1" }, data: { status: "HANDED_OVER", ticketId: "abcdef12-3456" } });
  });

  it("hands over when the model declines, instead of leaving the customer with nothing", async () => {
    h.create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    const res = await answerSupportMessage({ tenantId: TENANT, customerId: CUSTOMER, channel: "APP", message: "..." });
    expect(res.handedOver).toBe(true);
    expect(res.reply).toContain("ABCDEF12");
  });

  it("sends messages to the ticket once a person has the conversation", async () => {
    h.prisma.supportChat.findFirst.mockResolvedValue({ ...chat, status: "HANDED_OVER", ticketId: "abcdef12-3456" });
    const res = await answerSupportMessage({ tenantId: TENANT, customerId: CUSTOMER, channel: "APP", message: "Any update?", authorUserId: "u1" });
    expect(res).toMatchObject({ handedOver: true, reply: "", ticketNumber: "ABCDEF12" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.support.addTicketMessage).toHaveBeenCalledWith(TENANT, "abcdef12-3456", { body: "Any update?", authorUserId: "u1", authorLabel: null });
  });
});
