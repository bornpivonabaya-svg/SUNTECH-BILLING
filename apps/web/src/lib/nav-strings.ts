import type { NavAction, NavSection } from "./navigation";
import type { PortalLanguage } from "./portal-strings";

/**
 * Kiswahili for the navigation catalog. The catalog itself stays plain English data; this maps
 * each label, section title and action to its translation, so the sidebar, the command palette
 * and the breadcrumb all switch together. Keywords stay English so a search in either language
 * still finds the page.
 */
const LABELS_SW: Record<string, string> = {
  Dashboard: "Dashibodi",
  Notifications: "Arifa",
  Customers: "Wateja",
  "Online now": "Walio mtandaoni",
  "Plan upgrades": "Kuongeza vifurushi",
  "Referrals": "Rufaa",
  "VAT report": "Ripoti ya VAT",
  "Router updates": "Masasisho ya ruta",
  "Router backups": "Nakala za ruta",
  "Router health": "Afya ya ruta",
  "Planned maintenance": "Matengenezo yaliyopangwa",
  "Internet plans": "Vifurushi vya intaneti",
  "Add-ons": "Nyongeza",
  "Accounting export": "Kuhamisha kwa uhasibu",
  "Signup requests": "Maombi ya kuunganishwa",
  "Campaigns": "Kampeni",
  "Agents": "Mawakala",
  "Win-back offers": "Ofa za kuwarudisha wateja",
  Invoices: "Ankara",
  "Support tickets": "Tiketi za msaada",
  Hotspot: "Hotspot",
  "Purchase attempts": "Majaribio ya ununuzi",
  "Portal designer": "Mbunifu wa portali",
  Network: "Mtandao",
  Routers: "Ruta",
  VLANs: "VLAN",
  "IP pools": "Hifadhi za IP",
  "Bandwidth usage": "Matumizi ya data",
  "Network map": "Ramani ya mtandao",
  Analytics: "Takwimu",
  "Field work": "Kazi za uwanjani",
  Money: "Fedha",
  Payments: "Malipo",
  Transactions: "Miamala",
  Balance: "Salio",
  Settlements: "Malipo ya mauzo",
  "Getting paid": "Kupokea malipo",
  Account: "Akaunti",
  Settings: "Mipangilio",
  Automation: "Otomatiki",
  "SMS gateway": "Lango la SMS",
  "Customer mobile app": "Programu ya wateja",
  "Hardware store": "Duka la vifaa",
  "Audit log": "Kumbukumbu ya ukaguzi",
  "My sessions": "Vikao vyangu",
  Platform: "Jukwaa",
  Tenants: "ISP",
  "Subscription plans": "Mipango ya usajili",
  "Maintenance mode": "Hali ya matengenezo",
  "Walled garden": "Tovuti zinazoruhusiwa",
  "VLAN manual": "Mwongozo wa VLAN",
  Overview: "Muhtasari",
  Reconciliation: "Ulinganisho",
  "Payment gateway": "Lango la malipo",
  Fees: "Ada",
  Webhooks: "Webhooks",
  Store: "Duka",
  "Hardware & pricing": "Vifaa na bei",
  "Hardware orders": "Oda za vifaa",
  Website: "Tovuti",
  "Landing page": "Ukurasa wa mbele",
  Testimonials: "Ushuhuda",
  Integrations: "Miunganisho",
  "Platform M-Pesa": "M-Pesa ya jukwaa",
  "Google sign-in": "Kuingia kwa Google",
  "Platform WhatsApp": "WhatsApp ya jukwaa",
  // Actions
  "Add an ISP": "Ongeza ISP",
  "Schedule maintenance": "Panga matengenezo",
  "Add a customer": "Ongeza mteja",
  "Link a router": "Unganisha ruta",
  "See overdue invoices": "Ona ankara zilizochelewa",
  "Print hotspot vouchers": "Chapisha vocha za hotspot",
};

export function navLabel(label: string, lang: PortalLanguage): string {
  return lang === "sw" ? LABELS_SW[label] ?? label : label;
}

export function localizeNavSections(sections: NavSection[], lang: PortalLanguage): NavSection[] {
  if (lang === "en") return sections;
  return sections.map((section) => ({
    title: section.title ? navLabel(section.title, lang) : section.title,
    items: section.items.map((item) => ({ ...item, label: navLabel(item.label, lang), keywords: `${item.keywords ?? ""} ${item.label}`.trim() })),
  }));
}

export function localizeNavActions(actions: NavAction[], lang: PortalLanguage): NavAction[] {
  if (lang === "en") return actions;
  return actions.map((a) => ({ ...a, label: navLabel(a.label, lang), hint: navLabel(a.hint, lang) }));
}
