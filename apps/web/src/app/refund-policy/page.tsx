import { LegalShell } from "@/components/marketing/legal-shell";

export default function RefundPolicyPage() {
  return (
    <LegalShell
      active="/refund-policy"
      category="Telecom Billing Protection"
      effective="August 28, 2026"
      title="Refund & Billing Policy"
      intro={
        <>
          Transparent policies regarding ISP platform SaaS subscriptions, automated Safaricom M-Pesa payments, hotspot voucher purchases, and service outage credits.
        </>
      }
      notes={["M-Pesa STK Reversals Supported","Dispute SLA: &lt; 24 business hours","Automated Ledger Balancing"]}
      sections={[
        {
          title: "SaaS Subscription 14-Day Guarantee",
          body: (
            <>
              For newly registered ISPs purchasing a paid platform plan, we provide a 14-day full refund guarantee if the platform fails to integrate with your verified MikroTik hardware or Safaricom Daraja API credentials. Refund requests can be initiated directly from Settings &rarr; Billing.
            </>
          ),
        },
        {
          title: "End-Subscriber M-Pesa Double Deductions",
          body: (
            <>
              In rare events where a subscriber experiences duplicate Safaricom STK push prompts due to cellular network delays, our ledger engine automatically flags the duplicate transaction. The operator can authorize an instant M-Pesa B2C refund back to the subscriber&apos;s phone number or credit their internal wallet for next month&apos;s invoice.
            </>
          ),
        },
        {
          title: "Hotspot Vouchers Policy",
          body: (
            <>
              Hotspot access vouchers (1-Hour, 24-Hour, or Weekly passes) that have been successfully logged into and begun consumption of time or byte quota are non-refundable. Unused vouchers with verifiable zero bytes transferred may be revoked or re-issued by the hotspot venue administrator within 48 hours of purchase.
            </>
          ),
        },
        {
          title: "Service Downtime & Fiber Cut Credits",
          body: (
            <>
              If the Mashupkgrid FreeRADIUS cloud cluster experiences unscheduled downtime exceeding our 99.98% monthly SLA, affected operators receive pro-rated billing credits automatically applied to their subsequent renewal invoice upon submitting an outage verification ticket.
            </>
          ),
        },
        {
          title: "Dispute Resolution & Inquiries",
          body: (
            <>
              To submit a billing inquiry or duplicate payment verification request, please email billing@mashupkgrid.com with the relevant Safaricom M-Pesa transaction code (e.g. SK########) and account reference.
            </>
          ),
        },
      ]}
    />
  );
}
