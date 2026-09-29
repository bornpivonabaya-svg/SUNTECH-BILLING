import { prisma, type MpesaC2BTransaction, type Prisma } from "@mashupkgrid/database";
import { topUpWalletWithDb, recordPaymentForInvoiceWithDb, restoreServiceAfterPayment } from "@mashupkgrid/billing";
import { ConflictError, NotFoundError, ValidationError } from "@mashupkgrid/shared";
import { getMpesaCredentials } from "./config.service.js";
import { getPlatformMpesaCredentials } from "./platform-config.service.js";
import { recordPlatformCollection } from "../gateway/collection.service.js";
import { looksLikeReference } from "../gateway/payment-reference.service.js";

export interface C2BPayload {
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  MSISDN?: string;
}

export interface C2BResult {
  ResultCode: string;
  ResultDesc: string;
}

/**
 * C2B Validation webhook — Safaricom asks "should I let this payment through?" before crediting
 * the paybill. Accepts every validation request (no per-account gatekeeping) — rejecting here would
 * need account-number rules a tenant hasn't configured yet. Confirmation (below) is where
 * reconciliation actually happens.
 */
export function handleC2BValidation(_tenantId: string | null, _rawPayload: unknown): C2BResult {
  return { ResultCode: "0", ResultDesc: "Accepted" };
}

function parseTransTime(transTime: string | undefined): Date {
  // Safaricom sends "YYYYMMDDHHmmss" with no separators, in Africa/Nairobi local time (EAT,
  // UTC+3, no DST) — the explicit +03:00 offset is required so this parses correctly regardless of
  // the server's own timezone.
  if (!transTime || !/^\d{14}$/.test(transTime)) return new Date();
  const y = transTime.slice(0, 4);
  const mo = transTime.slice(4, 6);
  const d = transTime.slice(6, 8);
  const h = transTime.slice(8, 10);
  const mi = transTime.slice(10, 12);
  const s = transTime.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+03:00`);
}

interface ParsedC2B {
  transId: string;
  shortcode: string;
  amountMinor: number;
  billRef: string | null;
  msisdn: string;
  transactionTime: Date;
}

function parseC2B(rawPayload: unknown): ParsedC2B {
  const payload = rawPayload as C2BPayload;
  if (!payload.TransID || !payload.BusinessShortCode || payload.TransAmount === undefined) {
    throw new ValidationError("Malformed C2B confirmation payload");
  }
  const amount = Number(payload.TransAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("Malformed C2B amount");
  return {
    transId: payload.TransID,
    shortcode: payload.BusinessShortCode,
    // Daraja reports shillings, possibly with decimals as a string; to integer cents.
    amountMinor: Math.round(amount * 100),
    billRef: payload.BillRefNumber?.trim() || null,
    msisdn: payload.MSISDN ?? "",
    transactionTime: parseTransTime(payload.TransTime),
  };
}

/**
 * Matches one C2B payment to a tenant invoice (by invoice number) or customer (by customer number
 * or payment reference) and records it. Returns nulls when nothing matched — the payment is still
 * stored by the caller, unreconciled, for manual matching.
 */
async function applyC2BToTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  c2b: ParsedC2B,
  target: { invoiceId?: string | null; customerId?: string | null } = {}
): Promise<{ customerId: string | null; paymentId: string | null; invoiceId: string | null }> {
  const common = {
    method: "MPESA" as const,
    amountMinor: c2b.amountMinor,
    reference: c2b.transId,
    idempotencyKey: c2b.transId,
  };

  // Only an invoice that still needs paying: a payment that arrives for one already paid (or
  // voided) is real money and must still be recorded — it falls through to the customer's wallet.
  const payable = { in: ["PENDING", "PARTIALLY_PAID", "OVERDUE"] as ("PENDING" | "PARTIALLY_PAID" | "OVERDUE")[] };
  let invoice = target.invoiceId
    ? await tx.invoice.findFirst({ where: { id: target.invoiceId, tenantId, status: payable } })
    : null;
  const fallbackCustomerId =
    target.customerId ??
    (target.invoiceId
      ? (await tx.invoice.findFirst({ where: { id: target.invoiceId, tenantId }, select: { customerId: true } }))?.customerId ?? null
      : null);
  if (!invoice && !target.customerId && !target.invoiceId && c2b.billRef) {
    invoice = await tx.invoice.findFirst({ where: { tenantId, invoiceNumber: c2b.billRef, status: payable } });
  }
  if (invoice) {
    const result = await recordPaymentForInvoiceWithDb(tx, tenantId, {
      ...common,
      invoiceId: invoice.id,
      // Safaricom already credited the paybill — rejecting for exceeding the invoice's remaining
      // balance would roll back the whole transaction and lose the audit row.
      allowOverpayment: true,
    });
    return { customerId: invoice.customerId, paymentId: result.payment.id, invoiceId: invoice.id };
  }

  const customer = fallbackCustomerId
    ? await tx.customer.findFirst({ where: { id: fallbackCustomerId, tenantId, deletedAt: null } })
    : c2b.billRef
      ? await tx.customer.findFirst({ where: { tenantId, customerNumber: c2b.billRef, deletedAt: null } })
      : null;
  if (customer) {
    const result = await topUpWalletWithDb(tx, tenantId, { ...common, customerId: customer.id });
    return { customerId: customer.id, paymentId: result.payment.id, invoiceId: null };
  }
  return { customerId: null, paymentId: null, invoiceId: null };
}

export interface C2BOutcome {
  transaction: MpesaC2BTransaction;
  duplicate: boolean;
}

/**
 * C2B Confirmation for a tenant's OWN paybill — the payment has already happened on Safaricom's
 * side; we record it and try to reconcile it by BillRefNumber. Money on a tenant's own paybill is
 * theirs, so nothing is credited to the platform ledger.
 */
export async function handleC2BConfirmation(tenantId: string, rawPayload: unknown): Promise<C2BOutcome> {
  const c2b = parseC2B(rawPayload);

  const existing = await prisma.mpesaC2BTransaction.findUnique({ where: { transactionId: c2b.transId } });
  if (existing) return { transaction: existing, duplicate: true };

  // Defense in depth against forged confirmations (Daraja's C2B webhook is unsigned): a genuine
  // confirmation for this tenant always carries their own shortcode.
  const credentials = await getMpesaCredentials(tenantId);
  if (c2b.shortcode !== credentials.shortcode) {
    throw new ValidationError("BusinessShortCode does not match this tenant's configured paybill");
  }

  const transaction = await prisma.$transaction(async (tx) => {
    const matched = await applyC2BToTenant(tx, tenantId, c2b);
    return tx.mpesaC2BTransaction.create({
      data: {
        tenantId,
        transactionId: c2b.transId,
        shortcode: c2b.shortcode,
        amountMinor: c2b.amountMinor,
        msisdn: c2b.msisdn,
        billRefNumber: c2b.billRef,
        transactionTime: c2b.transactionTime,
        matchedCustomerId: matched.customerId,
        paymentId: matched.paymentId,
        rawPayload: rawPayload as Prisma.InputJsonValue,
        reconciled: Boolean(matched.paymentId),
        collectedBy: "OWN",
      },
    });
  });
  // An unmatched platform-paybill payment has no tenant yet; nothing to restore until it is assigned.
  if (transaction.tenantId) await restoreServiceAfterPayment(transaction.tenantId, transaction.matchedCustomerId);
  return { transaction, duplicate: false };
}

/**
 * C2B Confirmation for the PLATFORM paybill (the Suntech Payment Gateway).
 *
 * The account number the customer typed must be a payment reference (MH…): that — never the
 * payer's phone number — decides which tenant the money belongs to. A matched payment is recorded
 * for the tenant and credited to their ledger less the platform fee, in one transaction. A payment
 * whose reference matches nothing is still stored (the money is in the platform paybill), with no
 * tenant, for a super admin to assign from the reconciliation screen.
 */
export async function handlePlatformC2BConfirmation(rawPayload: unknown): Promise<C2BOutcome> {
  const c2b = parseC2B(rawPayload);

  const existing = await prisma.mpesaC2BTransaction.findUnique({ where: { transactionId: c2b.transId } });
  if (existing) return { transaction: existing, duplicate: true };

  const platform = await getPlatformMpesaCredentials();
  if (c2b.shortcode !== platform.shortcode) {
    throw new ValidationError("BusinessShortCode does not match the platform paybill");
  }

  const reference =
    c2b.billRef && looksLikeReference(c2b.billRef)
      ? await prisma.paymentReference.findUnique({
          where: { reference: c2b.billRef.toUpperCase().replace(/[\s-]/g, "") },
          include: { tenant: { select: { deletedAt: true } } },
        })
      : null;

  const transaction = await prisma.$transaction(async (tx) => {
    if (!reference || reference.tenant.deletedAt) {
      return tx.mpesaC2BTransaction.create({
        data: {
          tenantId: null,
          transactionId: c2b.transId,
          shortcode: c2b.shortcode,
          amountMinor: c2b.amountMinor,
          msisdn: c2b.msisdn,
          billRefNumber: c2b.billRef,
          transactionTime: c2b.transactionTime,
          rawPayload: rawPayload as Prisma.InputJsonValue,
          reconciled: false,
          collectedBy: "PLATFORM",
        },
      });
    }

    const matched = await applyC2BToTenant(tx, reference.tenantId, c2b, {
      invoiceId: reference.invoiceId,
      customerId: reference.customerId,
    });
    if (matched.paymentId) {
      await recordPlatformCollection(tx, {
        tenantId: reference.tenantId,
        paymentId: matched.paymentId,
        grossMinor: c2b.amountMinor,
        currency: "KES",
        channel: "MPESA_C2B",
        providerReference: c2b.transId,
        payerPhone: c2b.msisdn || null,
        customerId: matched.customerId,
        invoiceId: matched.invoiceId,
        paymentReferenceId: reference.id,
        description: matched.invoiceId ? "Paybill invoice payment" : "Paybill account top-up",
      });
    }
    return tx.mpesaC2BTransaction.create({
      data: {
        tenantId: reference.tenantId,
        transactionId: c2b.transId,
        shortcode: c2b.shortcode,
        amountMinor: c2b.amountMinor,
        msisdn: c2b.msisdn,
        billRefNumber: c2b.billRef,
        transactionTime: c2b.transactionTime,
        matchedCustomerId: matched.customerId,
        paymentId: matched.paymentId,
        rawPayload: rawPayload as Prisma.InputJsonValue,
        reconciled: Boolean(matched.paymentId),
        collectedBy: "PLATFORM",
      },
    });
  });
  // An unmatched platform-paybill payment has no tenant yet; nothing to restore until it is assigned.
  if (transaction.tenantId) await restoreServiceAfterPayment(transaction.tenantId, transaction.matchedCustomerId);
  return { transaction, duplicate: false };
}

/** Manual reconciliation by a tenant's staff: match an unreconciled C2B transaction on their OWN
 *  paybill to a customer/invoice. */
export async function manuallyReconcileC2BTransaction(
  tenantId: string,
  transactionId: string,
  target: { invoiceId?: string; customerId?: string }
): Promise<MpesaC2BTransaction> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "mpesa_c2b_transactions" WHERE "transactionId" = ${transactionId} FOR UPDATE`;
    const transaction = await tx.mpesaC2BTransaction.findFirst({ where: { tenantId, transactionId } });
    if (!transaction) throw new ValidationError("Unknown C2B transaction");
    if (transaction.reconciled) throw new ValidationError("Transaction is already reconciled");
    if (!target.invoiceId && !target.customerId) {
      throw new ValidationError("Provide either invoiceId or customerId to reconcile against");
    }

    const matched = await applyC2BToTenant(tx, tenantId, toParsed(transaction), target);
    if (!matched.paymentId) throw new NotFoundError(target.invoiceId ? "Invoice" : "Customer");
    // A platform-paybill payment that a tenant matches by hand is still platform money.
    if (transaction.collectedBy === "PLATFORM") {
      await recordPlatformCollection(tx, {
        tenantId,
        paymentId: matched.paymentId,
        grossMinor: transaction.amountMinor,
        currency: "KES",
        channel: "MPESA_C2B",
        providerReference: transaction.transactionId,
        payerPhone: transaction.msisdn || null,
        customerId: matched.customerId,
        invoiceId: matched.invoiceId,
        description: "Paybill payment (matched manually)",
      });
    }

    return tx.mpesaC2BTransaction.update({
      where: { id: transaction.id },
      data: { matchedCustomerId: matched.customerId, paymentId: matched.paymentId, reconciled: true },
    });
  });
}

/**
 * Super admin: attribute a platform-paybill payment that matched no reference to a tenant's
 * customer (and optionally invoice), then record and credit it exactly as if it had matched.
 */
export async function assignPlatformC2BTransaction(
  transactionId: string,
  target: { tenantId: string; customerId: string; invoiceId?: string | null },
  userId: string
): Promise<MpesaC2BTransaction> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "mpesa_c2b_transactions" WHERE "transactionId" = ${transactionId} FOR UPDATE`;
    const transaction = await tx.mpesaC2BTransaction.findUnique({ where: { transactionId } });
    if (!transaction || transaction.collectedBy !== "PLATFORM") throw new NotFoundError("Platform paybill payment");
    if (transaction.reconciled) throw new ConflictError("This payment has already been assigned.");

    const matched = await applyC2BToTenant(tx, target.tenantId, toParsed(transaction), {
      customerId: target.customerId,
      invoiceId: target.invoiceId ?? null,
    });
    if (!matched.paymentId) throw new NotFoundError("Customer");
    await recordPlatformCollection(tx, {
      tenantId: target.tenantId,
      paymentId: matched.paymentId,
      grossMinor: transaction.amountMinor,
      currency: "KES",
      channel: "MPESA_C2B",
      providerReference: transaction.transactionId,
      payerPhone: transaction.msisdn || null,
      customerId: matched.customerId,
      invoiceId: matched.invoiceId,
      description: "Paybill payment (assigned by administrator)",
    });
    return tx.mpesaC2BTransaction.update({
      where: { id: transaction.id },
      data: {
        tenantId: target.tenantId,
        matchedCustomerId: matched.customerId,
        paymentId: matched.paymentId,
        reconciled: true,
        assignedByUserId: userId,
      },
    });
  });
}

function toParsed(t: MpesaC2BTransaction): ParsedC2B {
  return {
    transId: t.transactionId,
    shortcode: t.shortcode,
    amountMinor: t.amountMinor,
    billRef: t.billRefNumber,
    msisdn: t.msisdn,
    transactionTime: t.transactionTime,
  };
}
