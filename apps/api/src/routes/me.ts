import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import { getOrCreateWallet, listWalletTransactions } from "@mashupkgrid/billing";
import {
  getRadiusUserByCustomerServiceOrThrow,
  getDecryptedRadiusPassword,
} from "@mashupkgrid/radius";
import { revokeAllSessionsForUser } from "@mashupkgrid/auth";
import { createTicket, listTickets, getCustomerVisibleMessages, addTicketMessage } from "@mashupkgrid/support";
import {
  successResponse,
  ConflictError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
} from "@mashupkgrid/shared";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { writeAuditLog } from "../lib/audit.js";
import { resolveAccountHolderOrThrow, resolveMyAccountOrThrow, resolveMyCustomerOrThrow, resolvePayingCustomerOrThrow } from "../lib/my-account.js";
import { answerSupportMessage, closeSupportChat, getAiAssistantConfigStatus, getSupportChat, requestHumanHandover, ticketRef } from "@mashupkgrid/ai";
import { initiateStkPushForCustomer, getStkRequestOrThrow, queryAndReconcileStkRequest } from "@mashupkgrid/payments";
import { getReferralSummary, getPauseAllowance, pauseSubscription, resumeSubscription, listAddOns, listPurchasesForCustomer, buyAddOn, activatePaidAddOns, cancelUnstartedPurchase } from "@mashupkgrid/billing";

const preHandler = [authenticate, resolveTenant, checkMaintenance] as const;

const subscriptionIdParamsSchema = z.object({ subscriptionId: z.string().uuid() });
const ticketIdParamsSchema = z.object({ ticketId: z.string().uuid() });
const createMyTicketSchema = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) });
const replyToMyTicketSchema = z.object({ body: z.string().min(1).max(5000) });

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customer", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const { customer, role, canPay, name } = await resolveMyAccountOrThrow(request);
    reply.send(successResponse({ ...customer, access: { role, canPay, name } }, request.id));
  });

  app.get("/subscriptions", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const subscriptions = await prisma.customerService.findMany({
      where: { customerId: customer.id },
      include: { package: true },
      orderBy: { createdAt: "desc" },
    });
    reply.send(successResponse(subscriptions, request.id));
  });

  app.get("/invoices", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const invoices = await prisma.invoice.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    reply.send(successResponse(invoices, request.id));
  });

  /**
   * Self-service payment: an M-Pesa prompt to the customer's phone for one of their own open
   * invoices. The amount is always the invoice's remaining balance — never client-supplied —
   * and the invoice must belong to the caller, so the only thing a customer can choose is which
   * phone gets the prompt.
   */
  app.post(
    "/invoices/:invoiceId/pay",
    { config: { audience: "customer", maintenanceCategory: "payment" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const customer = await resolvePayingCustomerOrThrow(request);
      const { invoiceId } = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
      const { phone } = z.object({ phone: z.string().trim().min(9).max(15).optional() }).parse(request.body ?? {});
      const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, customerId: customer.id, tenantId: customer.tenantId } });
      if (!invoice) throw new NotFoundError("Invoice");
      const remaining = invoice.totalMinor - invoice.amountPaidMinor;
      if (!["PENDING", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status) || remaining <= 0) {
        throw new ConflictError("This invoice has nothing left to pay");
      }
      const stkRequest = await initiateStkPushForCustomer(customer.tenantId, {
        customerId: customer.id,
        invoiceId: invoice.id,
        phone: phone || customer.phone,
        amountMinor: remaining,
        initiatedByUserId: request.user!.id,
      });
      await writeAuditLog({
        tenantId: customer.tenantId,
        actorUserId: request.user!.id,
        action: "mpesa.stk_push_initiated",
        resourceType: "MpesaStkRequest",
        resourceId: stkRequest.id,
        after: { invoiceId: invoice.id, amountMinor: remaining, selfService: true },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.status(201).send(successResponse({ checkoutRequestId: stkRequest.checkoutRequestId, amountMinor: remaining }, request.id));
    }
  );

  /** How many pause days the customer has left on a plan this year. */
  app.get("/subscriptions/:subscriptionId/pause", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const { subscriptionId } = subscriptionIdParamsSchema.parse(request.params);
    if (!(await prisma.customerService.findFirst({ where: { id: subscriptionId, customerId: customer.id } }))) throw new NotFoundError("Subscription");
    reply.send(successResponse(await getPauseAllowance(customer.tenantId, subscriptionId), request.id));
  });

  app.post("/subscriptions/:subscriptionId/pause", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveAccountHolderOrThrow(request);
    const { subscriptionId } = subscriptionIdParamsSchema.parse(request.params);
    const { days } = z.object({ days: z.number().int().min(1).max(180) }).parse(request.body);
    if (!(await prisma.customerService.findFirst({ where: { id: subscriptionId, customerId: customer.id } }))) throw new NotFoundError("Subscription");
    const updated = await pauseSubscription(customer.tenantId, subscriptionId, days, "customer");
    await writeAuditLog({ tenantId: customer.tenantId, actorUserId: request.user!.id, action: "subscription.paused", resourceType: "CustomerService", resourceId: subscriptionId, after: { days, until: updated.pausedUntil }, ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null });
    reply.send(successResponse(updated, request.id));
  });

  app.post("/subscriptions/:subscriptionId/resume", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveAccountHolderOrThrow(request);
    const { subscriptionId } = subscriptionIdParamsSchema.parse(request.params);
    if (!(await prisma.customerService.findFirst({ where: { id: subscriptionId, customerId: customer.id } }))) throw new NotFoundError("Subscription");
    const updated = await resumeSubscription(customer.tenantId, subscriptionId);
    await writeAuditLog({ tenantId: customer.tenantId, actorUserId: request.user!.id, action: "subscription.resumed", resourceType: "CustomerService", resourceId: subscriptionId, ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null });
    reply.send(successResponse(updated, request.id));
  });

  /** Add-ons on offer, and the ones this account bought. Only PPPoE plans can take them. */
  app.get("/addons", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const eligible = await prisma.customerService.count({ where: { customerId: customer.id, status: "ACTIVE", radiusUser: { isNot: null } } });
    const [catalog, purchases] = await Promise.all([eligible ? listAddOns(customer.tenantId, true) : [], listPurchasesForCustomer(customer.id)]);
    reply.send(successResponse({ catalog, purchases }, request.id));
  });

  /** Buys an add-on for one of the account's plans: makes its invoice and sends the M-Pesa
   *  prompt in one step. The add-on starts as soon as the payment lands. */
  app.post(
    "/subscriptions/:subscriptionId/addons",
    { config: { audience: "customer", maintenanceCategory: "payment" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const customer = await resolvePayingCustomerOrThrow(request);
      const { subscriptionId } = subscriptionIdParamsSchema.parse(request.params);
      const body = z.object({ addOnId: z.string().uuid(), phone: z.string().trim().min(9).max(15).optional() }).parse(request.body);
      if (!(await prisma.customerService.findFirst({ where: { id: subscriptionId, customerId: customer.id } }))) throw new NotFoundError("Subscription");
      const { purchase, invoice } = await buyAddOn(customer.tenantId, subscriptionId, body.addOnId, "customer");
      const amountMinor = invoice.totalMinor - invoice.amountPaidMinor;
      const stkRequest = await initiateStkPushForCustomer(customer.tenantId, {
        customerId: customer.id,
        invoiceId: invoice.id,
        phone: body.phone || customer.phone,
        amountMinor,
        initiatedByUserId: request.user!.id,
      }).catch(async (err) => {
        await cancelUnstartedPurchase(purchase.id);
        throw err;
      });
      await writeAuditLog({
        tenantId: customer.tenantId,
        actorUserId: request.user!.id,
        action: "addon.purchase_started",
        resourceType: "AddOnPurchase",
        resourceId: purchase.id,
        after: { addOnId: body.addOnId, invoiceId: invoice.id, amountMinor },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      reply.status(201).send(successResponse({ purchaseId: purchase.id, checkoutRequestId: stkRequest.checkoutRequestId, amountMinor }, request.id));
    }
  );

  // --- Support assistant: answers from the customer's own account; hands over to a ticket.

  app.get("/support-chat", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const [status, chat] = await Promise.all([getAiAssistantConfigStatus(customer.tenantId), getSupportChat(customer.tenantId, customer.id)]);
    reply.send(
      successResponse(
        {
          enabled: status.configured && status.isActive,
          status: chat?.status ?? null,
          ticketRef: chat?.ticketId ? ticketRef(chat.ticketId) : null,
          messages: (chat?.messages ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
        },
        request.id
      )
    );
  });

  app.post("/support-chat", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(request.body);
    const result = await answerSupportMessage({ tenantId: customer.tenantId, customerId: customer.id, channel: "APP", message, authorUserId: request.user!.id });
    reply.send(successResponse(result, request.id));
  });

  app.post("/support-chat/human", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    reply.send(successResponse(await requestHumanHandover(customer.tenantId, customer.id, "APP"), request.id));
  });

  app.post("/support-chat/new", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    await closeSupportChat(customer.tenantId, customer.id, "APP");
    reply.send(successResponse({ closed: true }, request.id));
  });

  /** The signed-in customer's own referral code and what it has earned them. */
  app.get("/referral", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const [summary, tenant] = await Promise.all([
      getReferralSummary(customer.tenantId, customer.id),
      prisma.tenant.findUnique({ where: { id: customer.tenantId }, select: { name: true } }),
    ]);
    // Names of people they referred stay first-name-only: the referrer knows who they are.
    reply.send(
      successResponse({ ...summary, isp: tenant?.name ?? "", referred: summary.referred.map((r) => ({ ...r, fullName: r.fullName.split(/\s+/)[0] ?? r.fullName, id: undefined })) }, request.id)
    );
  });

  /** Where that prompt got to. Only the customer's own requests are visible. */
  app.get("/payments/:checkoutRequestId", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const { checkoutRequestId } = z.object({ checkoutRequestId: z.string().min(1) }).parse(request.params);
    const current = await getStkRequestOrThrow(customer.tenantId, checkoutRequestId);
    if (current.customerId !== customer.id) throw new NotFoundError("Payment request");
    const latest = current.status === "PENDING" ? (await queryAndReconcileStkRequest(customer.tenantId, checkoutRequestId)).request : current;
    // A paid add-on starts right away rather than waiting for the worker's next sweep.
    if (latest.status === "COMPLETED") await activatePaidAddOns({ customerId: customer.id }).catch(() => []);
    reply.send(
      successResponse(
        { checkoutRequestId, status: latest.status, resultDesc: latest.resultDesc, mpesaReceiptNumber: latest.mpesaReceiptNumber, amountMinor: latest.amountMinor },
        request.id
      )
    );
  });

  app.get("/wallet", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const [wallet, transactions] = await Promise.all([
      getOrCreateWallet(prisma, customer.id),
      listWalletTransactions(customer.id),
    ]);
    reply.send(successResponse({ wallet, transactions }, request.id));
  });

  /** Same one-time-reveal, audit-logged pattern as the staff route
   *  (/api/v1/radius/users/:id/reveal-password) — just scoped to a subscription the caller
   *  actually owns instead of any subscription in the tenant. */
  app.post(
    "/subscriptions/:subscriptionId/reveal-pppoe-password",
    { config: { audience: "customer" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const customer = await resolveAccountHolderOrThrow(request);
      const { subscriptionId } = subscriptionIdParamsSchema.parse(request.params);

      const subscription = await prisma.customerService.findFirst({
        where: { id: subscriptionId, customerId: customer.id },
      });
      if (!subscription) throw new NotFoundError("Subscription");

      const radiusUser = await getRadiusUserByCustomerServiceOrThrow(
        request.user!.tenantId!,
        subscriptionId
      );
      const plaintextPassword = await getDecryptedRadiusPassword(radiusUser);

      await writeAuditLog({
        tenantId: request.user!.tenantId!,
        actorUserId: request.user!.id,
        action: "radius_user.password_revealed_self_service",
        resourceType: "RadiusUser",
        resourceId: radiusUser.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ username: radiusUser.username, password: plaintextPassword }, request.id));
    }
  );

  app.get("/profile", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { id: true, email: true, phone: true, createdAt: true },
    });
    if (!user) throw new NotFoundError("User");
    reply.send(successResponse(user, request.id));
  });

  /** Requires the current password (not just an active session) before setting a new one — the
   *  same "prove you still are who you say you are" bar as any other credential change. Every
   *  session (including the one making this request) is revoked afterward, same as a token-based
   *  reset: a stolen access token that got the attacker this far should not keep working once the
   *  real owner regains control. */
  app.post(
    "/change-password",
    { config: { audience: "customer" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const body = z
        .object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) })
        .parse(request.body);

      const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user) throw new NotFoundError("User");

      const currentValid = await verifyPassword(user.passwordHash, body.currentPassword);
      if (!currentValid) throw new UnauthorizedError("Current password is incorrect");

      if (!isPasswordStrongEnough(body.newPassword)) {
        throw new ValidationError("New password must be at least 10 characters and include a letter and a digit or symbol");
      }

      const newHash = await hashPassword(body.newPassword);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
      await revokeAllSessionsForUser(user.id, "password_changed_self_service");

      await writeAuditLog({
        tenantId: request.user!.tenantId,
        actorUserId: user.id,
        action: "user.password_changed_self_service",
        resourceType: "User",
        resourceId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.send(successResponse({ loggedOutEverywhere: true }, request.id));
    }
  );

  // --- Support tickets: same scoping-is-the-security-boundary pattern as every other route in
  // this file — a customer only ever sees tickets tied to *their own* customerId, resolved from
  // the caller's own user id, never a client-supplied one.

  app.get("/tickets", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const tickets = await listTickets(request.user!.tenantId!, { customerId: customer.id });
    reply.send(successResponse(tickets, request.id));
  });

  app.post("/tickets", { config: { audience: "customer" }, preHandler: [...preHandler] }, async (request, reply) => {
    const customer = await resolveMyCustomerOrThrow(request);
    const body = createMyTicketSchema.parse(request.body);
    const ticket = await createTicket(request.user!.tenantId!, {
      ...body,
      customerId: customer.id,
      source: "CUSTOMER_PORTAL",
      createdByUserId: request.user!.id,
    });
    reply.status(201).send(successResponse(ticket, request.id));
  });

  app.get(
    "/tickets/:ticketId",
    { config: { audience: "customer" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const customer = await resolveMyCustomerOrThrow(request);
      const { ticketId } = ticketIdParamsSchema.parse(request.params);
      const { ticket, messages } = await getCustomerVisibleMessages(request.user!.tenantId!, ticketId, customer.id);
      reply.send(successResponse({ ...ticket, messages }, request.id));
    }
  );

  app.post(
    "/tickets/:ticketId/messages",
    { config: { audience: "customer" }, preHandler: [...preHandler] },
    async (request, reply) => {
      const customer = await resolveMyCustomerOrThrow(request);
      const { ticketId } = ticketIdParamsSchema.parse(request.params);
      const body = replyToMyTicketSchema.parse(request.body);
      // getCustomerVisibleMessages throws NotFoundError unless this ticket is actually the
      // caller's own — that ownership check is what makes it safe to let them post to it at all.
      await getCustomerVisibleMessages(request.user!.tenantId!, ticketId, customer.id);
      const message = await addTicketMessage(request.user!.tenantId!, ticketId, {
        ...body,
        authorUserId: request.user!.id,
      });
      reply.status(201).send(successResponse(message, request.id));
    }
  );
}
