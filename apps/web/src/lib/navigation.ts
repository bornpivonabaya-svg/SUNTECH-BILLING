import type { CurrentUser } from "@/lib/auth-context";

/**
 * The dashboard's map: every destination, grouped the way an ISP works through a day. The
 * sidebar, the command palette (Ctrl/⌘ K) and the header breadcrumb all render from this one
 * list, so a page cannot be reachable from one and missing from another.
 *
 * Icons are named, not rendered, so this file stays plain data that can be searched and tested
 * without React.
 */

export type NavIcon =
  | "badge-percent"
  | "banknote"
  | "bell"
  | "bell-ring"
  | "building"
  | "calendar-clock"
  | "chart"
  | "clipboard"
  | "cloud-download"
  | "coins"
  | "credit-card"
  | "dashboard"
  | "file-text"
  | "gauge"
  | "sheet"
  | "user-plus"
  | "megaphone"
  | "handshake"
  | "zap"
  | "gift"
  | "globe"
  | "hand-coins"
  | "hard-drive"
  | "hard-hat"
  | "heart-pulse"
  | "history"
  | "key"
  | "landmark"
  | "layers"
  | "lifebuoy"
  | "lock"
  | "map"
  | "message"
  | "messages"
  | "monitor"
  | "network"
  | "package"
  | "palette"
  | "receipt"
  | "router"
  | "scale"
  | "scroll"
  | "settings"
  | "shield"
  | "smartphone"
  | "store"
  | "ticket"
  | "trending-up"
  | "users"
  | "wallet"
  | "webhook"
  | "wifi"
  | "workflow"
  | "wrench";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Extra words the palette should match on ("M-Pesa" for "Getting paid", say). */
  keywords?: string;
  /** Active only on this exact path, for section roots like /payments. */
  exact?: boolean;
  /** Opens in a new tab (the hardware store is a separate, public surface). */
  external?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** A shortcut to something you do, rather than somewhere you go. Palette only. */
export interface NavAction {
  id: string;
  label: string;
  href: string;
  hint: string;
}

type Has = (permission: string) => boolean;

function tenantSections(has: Has): NavSection[] {
  return [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard", keywords: "home overview" },
        { href: "/notifications", label: "Notifications", icon: "bell", keywords: "inbox announcements" },
      ],
    },
    {
      title: "Customers",
      items: [
        ...(has("customers.read") ? [{ href: "/customers", label: "Customers", icon: "users", keywords: "subscribers pppoe" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/online-users", label: "Online now", icon: "wifi", keywords: "sessions active users hotspot pppoe who is connected tracking" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/customers/upgrades", label: "Plan upgrades", icon: "trending-up", keywords: "upgrade data cap fup bigger plan suggestions" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/customers/referrals", label: "Referrals", icon: "gift", keywords: "refer neighbour reward code free days" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/customers/leads", label: "Signup requests", icon: "user-plus", keywords: "leads coverage new customers connect installation request" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/customers/campaigns", label: "Campaigns", icon: "megaphone", keywords: "bulk sms whatsapp broadcast message announce" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/customers/win-back", label: "Win-back offers", icon: "hand-coins", keywords: "churn at risk leaving come back discount offer sms" } as NavItem] : []),
        ...(has("packages.read") ? [{ href: "/packages", label: "Internet plans", icon: "package", keywords: "packages rate plans speed" } as NavItem] : []),
        ...(has("packages.read") ? [{ href: "/packages/addons", label: "Add-ons", icon: "zap", keywords: "speed boost extra data top up bundle prepaid" } as NavItem] : []),
        ...(has("billing.read") ? [{ href: "/invoices", label: "Invoices", icon: "file-text", keywords: "billing bills" } as NavItem] : []),
        ...(has("tickets.read") ? [{ href: "/tickets", label: "Support tickets", icon: "lifebuoy", keywords: "helpdesk complaints" } as NavItem] : []),
      ],
    },
    {
      title: "Hotspot",
      items: [
        ...(has("radius.manage") ? [{ href: "/vouchers", label: "Hotspot", icon: "ticket", keywords: "vouchers captive portal wifi" } as NavItem] : []),
        ...(has("payments.read") ? [{ href: "/purchase-attempts", label: "Purchase attempts", icon: "history", keywords: "hotspot checkout failed" } as NavItem] : []),
        ...(has("radius.manage") ? [{ href: "/captive-customizer", label: "Portal designer", icon: "palette", keywords: "captive portal theme login page" } as NavItem] : []),
      ],
    },
    {
      title: "Network",
      items: [
        ...(has("routers.read") ? [{ href: "/routers", label: "Routers", icon: "router", keywords: "mikrotik nas" } as NavItem] : []),
        ...(has("routers.manage") ? [{ href: "/routers/updates", label: "Router updates", icon: "cloud-download", keywords: "ota firmware routeros upgrade push script features fleet reboot" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/routers/health", label: "Router health", icon: "heart-pulse", keywords: "cpu memory temperature uptime reboot graphs" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/routers/walled-garden", label: "Walled garden", icon: "shield", keywords: "hotspot allowed sites before login paywall website" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/routers/backups", label: "Router backups", icon: "hard-drive", keywords: "backup restore export config rollback" } as NavItem] : []),
        ...(has("vlans.read") ? [{ href: "/vlans", label: "VLANs", icon: "layers", keywords: "segments tagging" } as NavItem] : []),
        ...(has("vlans.read") ? [{ href: "/vlans/guide", label: "VLAN manual", icon: "scroll", keywords: "patch switch trunk access port hotspot pppoe guide how to" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/ip-pools", label: "IP pools", icon: "network", keywords: "addresses dhcp" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/network-map", label: "Network map", icon: "map", keywords: "sites map coverage where routers are" } as NavItem] : []),
        ...(has("routers.read") ? [{ href: "/network-maintenance", label: "Planned maintenance", icon: "calendar-clock", keywords: "outage downtime notify customers sms scheduled work" } as NavItem] : []),
        ...(has("reports.read") ? [{ href: "/reports", label: "Bandwidth usage", icon: "gauge", keywords: "reports traffic revenue export" } as NavItem] : []),
        ...(has("reports.read") ? [{ href: "/analytics", label: "Analytics", icon: "chart", keywords: "growth revenue churn busiest hours packages sell" } as NavItem] : []),
        ...(has("reports.read") ? [{ href: "/reports/vat", label: "VAT report", icon: "receipt", keywords: "tax kra itax vat return pin monthly" } as NavItem] : []),
      ],
    },
    {
      // The MashupHost gateway, collections, balance and settlements: money held on a tenant's
      // behalf is the platform's largest liability, so it stays one clear group.
      title: "Money",
      items: [
        ...(has("payments.read")
          ? ([
              { href: "/payments", label: "Payments", icon: "wallet", exact: true, keywords: "collections gateway" },
              { href: "/payments/transactions", label: "Transactions", icon: "credit-card", keywords: "payments history" },
              { href: "/payments/balance", label: "Balance", icon: "coins", keywords: "wallet available" },
              { href: "/payments/settlements", label: "Settlements", icon: "landmark", keywords: "payouts withdraw" },
            ] as NavItem[])
          : []),
        ...(has("billing.read") ? [{ href: "/accounting", label: "Accounting export", icon: "sheet", keywords: "xero quickbooks accountant csv books import" } as NavItem] : []),
        ...(has("payments.read") ? [{ href: "/agents", label: "Agents", icon: "handshake", keywords: "shops resellers vouchers commission cash collect" } as NavItem] : []),
        ...(has("payments.reconcile") ? [{ href: "/payments/reconciliation", label: "Reconciliation", icon: "scale", keywords: "unmatched payments apply invoice m-pesa" } as NavItem] : []),
        ...(has("settings.manage") || has("payments.reconcile")
          ? // One entry, not four: M-Pesa, Paystack and Pesapal answer one question for an operator.
            [{ href: "/payments-setup", label: "Getting paid", icon: "hand-coins", keywords: "m-pesa paystack pesapal till paybill" } as NavItem]
          : []),
      ],
    },
    {
      title: "Account",
      items: [
        ...(has("settings.manage") ? [{ href: "/settings", label: "Settings", icon: "settings", keywords: "branding domain billing" } as NavItem] : []),
        ...(has("settings.manage") ? [{ href: "/automation", label: "Automation", icon: "workflow", keywords: "jobs scheduler worker billing cycle dunning" } as NavItem] : []),
        ...(has("settings.manage") ? [{ href: "/sms", label: "SMS gateway", icon: "message", keywords: "communications" } as NavItem] : []),
        ...(has("customers.read") ? [{ href: "/field", label: "Field work", icon: "hard-hat", keywords: "technician installer installs visits phone" } as NavItem] : []),
        { href: "/app", label: "Customer mobile app", icon: "smartphone", keywords: "phone app install home screen pay bills" },
        { href: "/shop", label: "Hardware store", icon: "store", keywords: "buy routers antennas", external: true },
        ...(has("audit_logs.read") ? [{ href: "/audit-log", label: "Audit log", icon: "scroll", keywords: "history who changed" } as NavItem] : []),
        { href: "/sessions", label: "My sessions", icon: "monitor", keywords: "devices sign out" },
      ],
    },
  ];
}

function platformSections(has: Has): NavSection[] {
  return [
    {
      items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", keywords: "home overview" }],
    },
    {
      title: "Platform",
      items: [
        ...(has("tenants.read") ? [{ href: "/tenants", label: "Tenants", icon: "building", keywords: "isps customers accounts" } as NavItem] : []),
        ...(has("tenants.update") ? [{ href: "/admin/notifications", label: "Notifications", icon: "bell-ring", keywords: "announce broadcast" } as NavItem] : []),
        ...(has("plans.manage") ? [{ href: "/plans", label: "Subscription plans", icon: "layers", keywords: "pricing tiers" } as NavItem] : []),
        ...(has("maintenance.manage") ? [{ href: "/maintenance", label: "Maintenance mode", icon: "wrench", keywords: "downtime" } as NavItem] : []),
        ...(has("maintenance.manage") ? [{ href: "/automation", label: "Automation", icon: "workflow", keywords: "jobs scheduler worker queues" } as NavItem] : []),
        ...(has("maintenance.manage") ? [{ href: "/admin/walled-garden", label: "Walled garden", icon: "shield", keywords: "hotspot allowed hosts before login paywall" } as NavItem] : []),
      ],
    },
    {
      title: "Payments",
      items: has("platform_payments.read")
        ? [
            { href: "/admin/payments", label: "Overview", icon: "wallet", exact: true, keywords: "gateway collections" },
            { href: "/admin/payments/transactions", label: "Transactions", icon: "credit-card" },
            { href: "/admin/payments/settlements", label: "Settlements", icon: "landmark", keywords: "payouts" },
            { href: "/admin/payments/reconciliation", label: "Reconciliation", icon: "scale", keywords: "unmatched" },
            { href: "/admin/payments/gateway", label: "Payment gateway", icon: "lock" },
            { href: "/admin/payments/fees", label: "Fees", icon: "badge-percent", keywords: "commission settlement policy" },
            { href: "/admin/payments/webhooks", label: "Webhooks", icon: "webhook" },
          ]
        : [],
    },
    {
      title: "Store",
      items: has("tenants.read")
        ? [
            { href: "/admin/products", label: "Hardware & pricing", icon: "package", keywords: "store catalog" },
            { href: "/admin/orders", label: "Hardware orders", icon: "clipboard" },
          ]
        : [],
    },
    {
      title: "Website",
      items: has("maintenance.manage")
        ? [
            { href: "/landing-editor", label: "Landing page", icon: "globe", keywords: "homepage marketing" },
            { href: "/testimonials", label: "Testimonials", icon: "messages" },
          ]
        : [],
    },
    {
      title: "Integrations",
      items: has("tenants.create")
        ? [
            { href: "/platform-mpesa", label: "Platform M-Pesa", icon: "banknote", keywords: "daraja" },
            { href: "/platform-google-signin", label: "Google sign-in", icon: "key", keywords: "oauth" },
            { href: "/platform-whatsapp", label: "Platform WhatsApp", icon: "message" },
          ]
        : [],
    },
    { title: "Account", items: [{ href: "/sessions", label: "My sessions", icon: "monitor", keywords: "devices sign out" }] },
  ];
}

/** Only the sections and items this user may see. Empty sections are dropped. */
export function buildNavSections(user: Pick<CurrentUser, "tenantId" | "permissions">): NavSection[] {
  const has: Has = (permission) => user.permissions.includes(permission);
  const sections = user.tenantId === null ? platformSections(has) : tenantSections(has);
  return sections.filter((section) => section.items.length > 0);
}

/** Things worth a shortcut: each is a page plus the intent that takes you there. */
export function buildNavActions(user: Pick<CurrentUser, "tenantId" | "permissions">): NavAction[] {
  const has: Has = (permission) => user.permissions.includes(permission);
  if (user.tenantId === null) {
    return [
      ...(has("tenants.create") ? [{ id: "new-tenant", label: "Add an ISP", href: "/tenants", hint: "Tenants" }] : []),
      ...(has("maintenance.manage") ? [{ id: "maintenance", label: "Schedule maintenance", href: "/maintenance", hint: "Maintenance mode" }] : []),
    ];
  }
  return [
    ...(has("customers.create") ? [{ id: "new-customer", label: "Add a customer", href: "/customers", hint: "Customers" }] : []),
    ...(has("routers.manage") ? [{ id: "new-router", label: "Link a router", href: "/routers/new", hint: "Network" }] : []),
    ...(has("billing.read") ? [{ id: "overdue", label: "See overdue invoices", href: "/invoices", hint: "Invoices" }] : []),
    ...(has("radius.manage") ? [{ id: "vouchers", label: "Print hotspot vouchers", href: "/vouchers", hint: "Hotspot" }] : []),
  ];
}

export function isNavItemActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The section and item the current URL belongs to, for the breadcrumb. Prefers the longest
 *  matching href so /payments/balance resolves to "Balance", not the "/payments" root. */
export function findCurrentNav(sections: NavSection[], pathname: string | null): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (!isNavItemActive(item, pathname)) continue;
      if (!best || item.href.length > best.item.href.length) best = { section, item };
    }
  }
  return best;
}

/**
 * Ranks items against what someone typed. Every word must match somewhere (label, section title
 * or keywords); a match at the start of the label outranks one buried in the keywords, so "in"
 * puts "Internet plans" and "Invoices" above "Getting paid (m-pesa ... paybill)".
 */
export function scoreNavMatch(query: string, item: NavItem, sectionTitle?: string): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const label = item.label.toLowerCase();
  const haystack = `${label} ${sectionTitle?.toLowerCase() ?? ""} ${item.keywords?.toLowerCase() ?? ""}`;
  let score = 0;
  for (const word of words) {
    if (label.startsWith(word)) score += 3;
    else if (label.split(/\s+/).some((part) => part.startsWith(word))) score += 2;
    else if (haystack.includes(word)) score += 1;
    else return 0;
  }
  return score;
}
