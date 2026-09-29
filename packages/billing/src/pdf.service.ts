import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@mashupkgrid/database";
import { NotFoundError } from "@mashupkgrid/shared";
import { getStampedPaymentReceipt } from "./reports.service.js";

/**
 * Invoice and receipt PDFs, drawn directly with pdf-lib: no headless browser, no fonts to ship,
 * fast enough to render inside an email job. A4, black on white, the ISP's name at the top.
 *
 * The standard PDF fonts only cover Latin-1, so every string passes through `safe()` first; a
 * character they cannot draw (an emoji in a customer's name, say) becomes "?" instead of making
 * the whole document fail.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.87, 0.89, 0.92);

const PUNCTUATION: Record<string, string> = {
  "\u2014": "-", "\u2013": "-", "\u2012": "-", "\u2011": "-", "\u2010": "-",
  "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"', "\u2026": "...", "\u2022": "*",
  "\u00A0": " ", "\u202F": " ", "\u2009": " ",
};

function safe(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u2010-\u2014\u2018\u2019\u201C\u201D\u2026\u2022\u00A0\u202F\u2009]/g, (c) => PUNCTUATION[c] ?? c).replace(/[^\x20-\x7E\xA1-\xFF]/gu, "?");
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function date(value: Date | string, timeZone = "Africa/Nairobi"): string {
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone });
}

interface Pen {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
}

function text(pen: Pen, value: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? pen.bold : pen.regular;
  const s = safe(value);
  const drawX = opts.align === "right" ? x - font.widthOfTextAtSize(s, size) : x;
  pen.page.drawText(s, { x: drawX, y, size, font, color: opts.color ?? INK });
}

function rule(pen: Pen, y: number) {
  pen.page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.75, color: RULE });
}

/** Truncates to fit a column rather than overflowing into the next one. */
function fit(font: PDFFont, value: string, size: number, maxWidth: number): string {
  let s = safe(value);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}...`;
}

async function newDocument(title: string): Promise<{ doc: PDFDocument; pen: Pen }> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(title));
  doc.setCreator("Suntech");
  const page = doc.addPage([A4.width, A4.height]);
  const pen = { page, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, pen };
}

function header(pen: Pen, ispName: string, docTitle: string, number: string, lines: string[]): number {
  const top = A4.height - MARGIN;
  text(pen, ispName, MARGIN, top - 4, { size: 18, bold: true });
  text(pen, docTitle, A4.width - MARGIN, top - 4, { size: 18, bold: true, align: "right" });
  text(pen, number, A4.width - MARGIN, top - 22, { size: 10, color: MUTED, align: "right" });
  let y = top - 38;
  for (const line of lines) {
    text(pen, line, A4.width - MARGIN, y, { size: 9, color: MUTED, align: "right" });
    y -= 13;
  }
  const bottom = Math.min(y, top - 38) - 8;
  rule(pen, bottom);
  return bottom - 24;
}

function footer(pen: Pen, note: string) {
  rule(pen, MARGIN + 24);
  text(pen, note, MARGIN, MARGIN + 10, { size: 8, color: MUTED });
}

export async function renderInvoicePdf(tenantId: string, invoiceId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      items: true,
      customer: { select: { fullName: true, customerNumber: true, phone: true, email: true, address: true } },
      tenant: { select: { name: true, timezone: true } },
    },
  });
  if (!invoice) throw new NotFoundError("Invoice");
  const tz = invoice.tenant.timezone || "Africa/Nairobi";
  const { doc, pen } = await newDocument(`Invoice ${invoice.invoiceNumber}`);
  const balance = invoice.totalMinor - invoice.amountPaidMinor;

  let y = header(pen, invoice.tenant.name, "INVOICE", invoice.invoiceNumber, [
    `Issued ${date(invoice.issuedAt, tz)}`,
    `Due ${date(invoice.dueDate, tz)}`,
    `Status: ${invoice.status.replace("_", " ").toLowerCase()}`,
  ]);

  text(pen, "BILL TO", MARGIN, y, { size: 8, bold: true, color: MUTED });
  y -= 15;
  for (const line of [invoice.customer.fullName, `Account ${invoice.customer.customerNumber}`, invoice.customer.phone, invoice.customer.email, invoice.customer.address].filter(Boolean) as string[]) {
    text(pen, line, MARGIN, y, { size: 10, bold: line === invoice.customer.fullName });
    y -= 14;
  }

  y -= 16;
  const cols = { desc: MARGIN, qty: A4.width - MARGIN - 190, unit: A4.width - MARGIN - 95, total: A4.width - MARGIN };
  text(pen, "DESCRIPTION", cols.desc, y, { size: 8, bold: true, color: MUTED });
  text(pen, "QTY", cols.qty, y, { size: 8, bold: true, color: MUTED, align: "right" });
  text(pen, "UNIT PRICE", cols.unit, y, { size: 8, bold: true, color: MUTED, align: "right" });
  text(pen, "AMOUNT", cols.total, y, { size: 8, bold: true, color: MUTED, align: "right" });
  y -= 8;
  rule(pen, y);
  y -= 16;
  for (const item of invoice.items) {
    text(pen, fit(pen.regular, item.description, 10, cols.qty - cols.desc - 40), cols.desc, y);
    text(pen, String(item.quantity), cols.qty, y, { align: "right" });
    text(pen, money(item.unitPriceMinor, invoice.currency), cols.unit, y, { align: "right" });
    text(pen, money(item.totalMinor, invoice.currency), cols.total, y, { align: "right" });
    y -= 18;
    if (y < MARGIN + 160) break;
  }
  rule(pen, y + 6);
  y -= 14;

  const totals: [string, string, boolean][] = [
    ["Subtotal", money(invoice.subtotalMinor, invoice.currency), false],
    ["Tax", money(invoice.taxMinor, invoice.currency), false],
    ["Total", money(invoice.totalMinor, invoice.currency), true],
    ["Paid", money(invoice.amountPaidMinor, invoice.currency), false],
    ["Balance due", money(Math.max(0, balance), invoice.currency), true],
  ];
  for (const [label, value, strong] of totals) {
    text(pen, label, cols.unit, y, { align: "right", bold: strong, color: strong ? INK : MUTED });
    text(pen, value, cols.total, y, { align: "right", bold: strong });
    y -= 16;
  }

  if (balance > 0) {
    y -= 12;
    text(pen, `Please pay by ${date(invoice.dueDate, tz)}, quoting ${invoice.invoiceNumber} or account ${invoice.customer.customerNumber} as the reference.`, MARGIN, y, { size: 9, color: MUTED });
  }

  footer(pen, `${invoice.tenant.name} · Invoice ${invoice.invoiceNumber} · Generated ${date(new Date(), tz)}`);
  return { filename: `${invoice.invoiceNumber}.pdf`, bytes: await doc.save() };
}

export async function renderReceiptPdf(tenantId: string, paymentId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const r = await getStampedPaymentReceipt(tenantId, paymentId);
  const { doc, pen } = await newDocument(`Receipt ${r.receiptNumber}`);
  const tz = r.tenant.timezone;

  let y = header(pen, r.tenant.name, "RECEIPT", r.receiptNumber, [`Paid ${date(r.payment.paidAt, tz)}`, `Reference ${r.payment.reference}`]);

  text(pen, "RECEIVED FROM", MARGIN, y, { size: 8, bold: true, color: MUTED });
  y -= 15;
  for (const line of [r.customer.fullName, r.customer.customerNumber !== "GUEST" ? `Account ${r.customer.customerNumber}` : null, r.customer.phone !== "—" ? r.customer.phone : null, r.customer.email].filter(Boolean) as string[]) {
    text(pen, line, MARGIN, y, { size: 10, bold: line === r.customer.fullName });
    y -= 14;
  }

  y -= 20;
  const rows: [string, string][] = [
    ["For", r.invoice?.invoiceNumber ? `${r.invoice.description} (invoice ${r.invoice.invoiceNumber})` : r.invoice?.description ?? "Payment"],
    ["Method", r.payment.method.replace("_", " ").toLowerCase()],
    ["Reference", r.payment.reference],
    ["Status", r.payment.status.toLowerCase()],
  ];
  for (const [label, value] of rows) {
    text(pen, label, MARGIN, y, { color: MUTED });
    text(pen, fit(pen.regular, value, 10, A4.width - MARGIN * 2 - 120), MARGIN + 120, y);
    y -= 18;
  }
  y -= 8;
  rule(pen, y);
  y -= 26;
  text(pen, "Amount paid", MARGIN, y, { size: 12, bold: true });
  text(pen, money(r.payment.amountMinor, r.payment.currency), A4.width - MARGIN, y, { size: 16, bold: true, align: "right" });

  footer(pen, `${r.tenant.name} · Receipt ${r.receiptNumber} · Thank you for your payment.`);
  return { filename: `${r.receiptNumber}.pdf`, bytes: await doc.save() };
}

/** The payment a gateway reference points at, for jobs that only carry the reference. */
export async function findPaymentIdByReference(tenantId: string, reference: string): Promise<string | null> {
  if (!reference) return null;
  const payment = await prisma.payment.findFirst({
    where: {
      tenantId,
      OR: [
        { reference },
        { mpesaStkRequest: { mpesaReceiptNumber: reference } },
        { mpesaC2BTxn: { transactionId: reference } },
        { gatewayTransaction: { providerReference: reference } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return payment?.id ?? null;
}

/** Exposed for the unit test only. */
export const __safeForTest = safe;
