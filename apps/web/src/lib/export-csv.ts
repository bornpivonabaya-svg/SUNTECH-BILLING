/**
 * Utility to download CSV files with UTF-8 BOM so Microsoft Excel and other
 * spreadsheet readers display all currency symbols, names, and timestamps cleanly.
 */
export function downloadCsv(filename: string, content: string): void {
  // UTF-8 BOM \uFEFF ensures Excel reads UTF-8 correctly
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export interface RevenueCsvReportData {
  tenantName: string;
  periodLabel: string;
  stampedAt: string;
  stampHash: string;
  totalRevenueKes: string;
  paymentCount: number;
  uniqueClientsCount: number;
  averageSpendKes: string;
  records: Array<{
    receiptNumber: string;
    stampedDate: string;
    customerName: string;
    customerNumber: string;
    customerPhone: string;
    serviceOrPurpose: string;
    method: string;
    reference: string;
    amountKes: string;
    status: string;
  }>;
}

export function generateRevenueCsv(data: RevenueCsvReportData): string {
  const lines: string[] = [];

  // Header metadata block
  lines.push(`${escapeCsvCell("SUNTECH BILLING — OFFICIAL REVENUE & FINANCIAL REPORT")}`);
  lines.push(`${escapeCsvCell("ISP / Tenant")},${escapeCsvCell(data.tenantName)}`);
  lines.push(`${escapeCsvCell("Reporting Period")},${escapeCsvCell(data.periodLabel)}`);
  lines.push(`${escapeCsvCell("Stamped Generation Date")},${escapeCsvCell(data.stampedAt)}`);
  lines.push(`${escapeCsvCell("Official Stamp Hash")},${escapeCsvCell(data.stampHash)}`);
  lines.push("");
  lines.push(`${escapeCsvCell("--- SUMMARY TOTALS ---")}`);
  lines.push(`${escapeCsvCell("Gross Revenue")},${escapeCsvCell(`KES ${data.totalRevenueKes}`)}`);
  lines.push(`${escapeCsvCell("Total Completed Transactions")},${escapeCsvCell(data.paymentCount)}`);
  lines.push(`${escapeCsvCell("Unique Paying Clients")},${escapeCsvCell(data.uniqueClientsCount)}`);
  lines.push(`${escapeCsvCell("Average Spend Per Client")},${escapeCsvCell(`KES ${data.averageSpendKes}`)}`);
  lines.push("");

  // Column headers
  const columns = [
    "Receipt #",
    "Paid Date & Time",
    "Client Name",
    "Account / Cust #",
    "Phone Number",
    "Service / Package / Purpose",
    "Payment Method",
    "Reference / M-Pesa Code",
    "Amount (KES)",
    "Payment Status",
  ];
  lines.push(columns.map(escapeCsvCell).join(","));

  // Rows
  for (const r of data.records) {
    lines.push(
      [
        r.receiptNumber,
        r.stampedDate,
        r.customerName,
        r.customerNumber,
        r.customerPhone,
        r.serviceOrPurpose,
        r.method,
        r.reference,
        r.amountKes,
        r.status,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  return lines.join("\r\n");
}

export interface ClientsCsvReportData {
  tenantName: string;
  stampedAt: string;
  stampHash: string;
  totalClients: number;
  activeClients: number;
  totalSpendKes: string;
  averageSpendKes: string;
  clients: Array<{
    customerNumber: string;
    fullName: string;
    phone: string;
    email: string | null;
    status: string;
    joinedDateFormatted: string;
    totalSpendKes: string;
    paymentCount: number;
    activePackages: string;
    latestReceiptNumber: string | null;
    lastPaymentDateFormatted: string | null;
  }>;
}

export function generateClientsCsv(data: ClientsCsvReportData): string {
  const lines: string[] = [];

  // Header metadata block
  lines.push(`${escapeCsvCell("Suntech Billing — CLIENTS JOINED & SPENDING REPORT")}`);
  lines.push(`${escapeCsvCell("ISP / Tenant")},${escapeCsvCell(data.tenantName)}`);
  lines.push(`${escapeCsvCell("Stamped Generation Date")},${escapeCsvCell(data.stampedAt)}`);
  lines.push(`${escapeCsvCell("Official Stamp Hash")},${escapeCsvCell(data.stampHash)}`);
  lines.push("");
  lines.push(`${escapeCsvCell("--- SUMMARY TOTALS ---")}`);
  lines.push(`${escapeCsvCell("Total Registered Clients")},${escapeCsvCell(data.totalClients)}`);
  lines.push(`${escapeCsvCell("Active Subscribers")},${escapeCsvCell(data.activeClients)}`);
  lines.push(`${escapeCsvCell("Total Cumulative Spends")},${escapeCsvCell(`KES ${data.totalSpendKes}`)}`);
  lines.push(`${escapeCsvCell("Average Client Spend (LTV)")},${escapeCsvCell(`KES ${data.averageSpendKes}`)}`);
  lines.push("");

  // Column headers
  const columns = [
    "Account / Cust #",
    "Client Full Name",
    "Phone Number",
    "Email Address",
    "Account Status",
    "Joined When (Registration Date)",
    "Total Spends (KES)",
    "Completed Payments Count",
    "Active Subscriptions / Packages",
    "Latest Receipt #",
    "Latest Payment Date",
  ];
  lines.push(columns.map(escapeCsvCell).join(","));

  for (const c of data.clients) {
    lines.push(
      [
        c.customerNumber,
        c.fullName,
        c.phone,
        c.email ?? "—",
        c.status,
        c.joinedDateFormatted,
        c.totalSpendKes,
        c.paymentCount,
        c.activePackages,
        c.latestReceiptNumber ?? "None",
        c.lastPaymentDateFormatted ?? "Never",
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }

  return lines.join("\r\n");
}
