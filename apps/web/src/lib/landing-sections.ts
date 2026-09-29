/**
 * The homepage's section lists (features, steps, customer and Kenya points, plan contents).
 * They live here, as plain data with icons named by string, so the homepage can take them from
 * Sanity when it's configured and fall back to these when it isn't (see lib/sanity.ts).
 * Every capability named below exists in this codebase.
 */

export type LandingIcon = "router" | "mpesa" | "growth" | "shield" | "ticket" | "users" | "whatsapp" | "invoice" | "lock" | "message" | "globe";

export const LANDING_ICONS: LandingIcon[] = ["router", "mpesa", "growth", "shield", "ticket", "users", "whatsapp", "invoice", "lock", "message", "globe"];

export interface LandingSections {
  heroTicks: string[];
  featureGroups: { title: string; body: string; icon: LandingIcon; mpesa?: boolean; bullets: string[] }[];
  network: { eyebrow: string; title: string; body: string; bullets: string[] };
  showcasePoints: string[];
  steps: { title: string; body: string }[];
  planIncludes: string[];
  customerPoints: { title: string; body: string; icon: LandingIcon; bullets: string[] }[];
  operatorPoints: { title: string; body: string; icon: LandingIcon }[];
}

export const DEFAULT_LANDING_SECTIONS: LandingSections = {
  heroTicks: ["English & Kiswahili", "Works behind any SIM or NAT", "No per-router fees"],
  network: {
    eyebrow: "For your network team",
    title: "Remote WinBox and VLANs, without the site visit",
    body: "Each router dials out to Suntech over its own encrypted tunnel, so you can open it in WinBox from anywhere — even on a SIM behind carrier NAT. Add a VLAN in the dashboard and the router gets its own hotspot or PPPoE server on it, set up for you.",
    bullets: [
      "WinBox from your office or phone, with no public IP and no port forwarding",
      "Hotspot on one VLAN and PPPoE on another, each running on its own",
      "A router that was offline finishes its setup the moment it's back",
      "Step-by-step VLAN and PPPoE manual, in English and Kiswahili",
    ],
  },
  /** The platform in four groups, so a visitor sees everything without scrolling past a card
   *  per feature. Every bullet is a shipped feature (routes in apps/api, pages in apps/web). */
  featureGroups: [
    {
      title: "Your network, from anywhere",
      body: "Link a MikroTik with one script and run it from the dashboard — even behind a Safaricom, Airtel or Faiba SIM.",
      icon: "router",
      bullets: [
        "One setup script for RouterOS v6 or v7",
        "Remote WinBox through the platform, no public IP needed",
        "VLANs set up for you: hotspot and PPPoE each on their own",
        "Config backups with one-click restore",
        "Scheduled RouterOS updates, health graphs and down alerts",
        "Walled garden for your own site and payment pages",
      ],
    },
    {
      title: "Billing that runs itself",
      body: "Invoices, reminders, suspension and reconnection happen on schedule, and M-Pesa payments land on the right account.",
      icon: "mpesa",
      mpesa: true,
      bullets: [
        "M-Pesa STK Push, Paybill and Till — into your own account",
        "Service back on within a minute of paying",
        "Prepaid add-ons: speed boosts and extra data",
        "Pause a plan for travel, family and business accounts",
        "KRA VAT report and Xero / QuickBooks export",
        "Hotspot vouchers, printed or sent by WhatsApp",
      ],
    },
    {
      title: "Tools to grow",
      body: "Win new customers and keep the ones you have, without a separate marketing tool.",
      icon: "growth",
      bullets: [
        "Agents and resellers selling vouchers on commission",
        "Bulk SMS and WhatsApp campaigns",
        "Win-back offers for customers about to leave",
        "Referral rewards and plan-upgrade suggestions",
        "Coverage check and signup requests from your website",
        "Revenue, usage and online-users reports",
      ],
    },
    {
      title: "Run your team",
      body: "Everyone gets the access they need and nothing more, and every change is on record.",
      icon: "shield",
      bullets: [
        "Staff roles for admins, cashiers and technicians",
        "Two-step login for staff accounts",
        "Field job cards for installs and repairs",
        "Audit log of who changed what, and when",
        "Automation page showing every background job",
        "Dashboard in English and Kiswahili, on any phone",
      ],
    },
  ],


  showcasePoints: [
    "See who is online now, what they paid and what they owe",
    "Hotspot and PPPoE customers in one list",
    "Suspend, reconnect or pause a customer in one click",
    "Your own logo, colours and domain — set up with your domain company detected for you",
    "Works on a phone as well as a laptop",
  ],


  steps: [
    { title: "Connect Your Network", body: "Paste one setup script into your MikroTik to link it to Suntech." },
    { title: "Add Subscribers", body: "Create customer accounts for PPPoE and hotspot users." },
    { title: "Set Packages", body: "Define speeds, prices and billing cycles for what you sell." },
    { title: "Automate Billing", body: "Invoices, reminders and suspensions run on their own." },
    { title: "Get Paid & Grow", body: "Collect through M-Pesa and track revenue as it lands." },
  ],


  planIncludes: [
    "Subscriber and package management",
    "Automated invoicing, reminders and reconnection",
    "M-Pesa STK Push, Paybill and Till",
    "MikroTik, RADIUS and remote WinBox",
    "Hotspot captive portal and vouchers",
    "Customer app, AI assistant and WhatsApp messages",
  ],


  /** What a subscriber gets. Every item is a shipped surface: apps/web/src/app/hotspot (captive
   *  portal), components/customer-portal.tsx (bills + M-Pesa self-pay), the worker's invoice and
   *  dunning emails, packages/whatsapp (service status messages). */
  customerPoints: [
    {
      title: "Branded captive portal",
      body: "Walk-in customers connect to your Wi-Fi, pick a package and pay by M-Pesa — online in seconds, no voucher paper needed.",
      icon: "ticket",
      bullets: ["Your logo, colours and support number", "Reconnects the same phone automatically", "Works on a MikroTik you already own"],
    },
    {
      title: "Customer portal",
      body: "Monthly subscribers sign in to see whether their internet is on, what they owe, and pay it from their phone.",
      icon: "users",
      bullets: ["Installs on their phone like an app", "Pay with one M-Pesa prompt; back online within a minute", "Pause the plan, buy add-ons, add family members"],
    },
    {
      title: "Help that answers",
      body: "Reminders and service updates go out by SMS, email and WhatsApp, and an assistant answers questions about bills and connections day and night.",
      icon: "whatsapp",
      bullets: ["Due-soon, overdue and reconnection notices", "Check balance and pay on WhatsApp", "AI assistant in English and Kiswahili, hands over to your team"],
    },
  ],


  operatorPoints: [
    {
      title: "Your money, your choice",
      body: "Collect straight into your own Paybill or Till, or let Suntech collect and settle to you.",
      icon: "mpesa",
    },
    {
      title: "Works on any connection",
      body: "Routers reach the platform over their own VPN, so a SIM or fibre line behind carrier NAT is fine. No proprietary hardware.",
      icon: "router",
    },
    {
      title: "In English and Kiswahili",
      body: "The dashboard, customer app, captive portal and assistant all switch language with one tap.",
      icon: "message",
    },
    {
      title: "Kenyan tax and books",
      body: "A KRA VAT report every month, and invoices and payments exported for Xero or QuickBooks.",
      icon: "invoice",
    },
    {
      title: "Security built in",
      body: "Two-step login for staff, and M-Pesa and gateway credentials encrypted at rest.",
      icon: "lock",
    },
    {
      title: "Your brand, your domain",
      body: "Your logo and colours on every portal. Type your domain and we detect Namecheap, GoDaddy, Hostinger or Cloudflare and show you exactly what to add.",
      icon: "globe",
    },
  ],
};
