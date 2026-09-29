import type { PortalLanguage } from "./portal-strings";

/** Text for the Customers, Invoices, Routers and Settings pages, in English and Kiswahili. */
export interface PageStrings {
  common: {
    cancel: string;
    close: string;
    send: string;
    sending: string;
    saving: string;
    saved: string;
    saveChanges: string;
    loading: string;
    copy: string;
    dismiss: string;
    due: (date: string) => string;
    subject: string;
    email: string;
    sms: string;
    status: string;
    username: string;
    ipAddress: string;
    uptime: string;
    optional: string;
  };
  customers: {
    title: string;
    description: string;
    exportCustomers: string;
    exportPayments: string;
    reports: string;
    newSubscriber: string;
    registerTitle: string;
    fullName: string;
    phoneMpesa: string;
    emailOptional: string;
    registering: string;
    createAccount: string;
    loadingSubscribers: string;
    joined: string;
    noSubscribers: string;
    addFirst: string;
    createFailed: string;
    exportFailed: string;
    searchPlaceholder: string;
    allStatuses: string;
    statusActive: string;
    statusSuspended: string;
    statusInactive: string;
    matching: (n: number) => string;
    allBranches: string;
    noBranch: string;
    branch: string;
    // detail
    loadingDetails: string;
    account: string;
    portalLinked: string;
    loginEmailPlaceholder: string;
    linking: string;
    link: string;
    linkLogin: string;
    assignSubscription: string;
    selectTier: string;
    assigning: string;
    subscribeCustomer: string;
    messageCustomer: string;
    sentBy: (email: string | null, phone: string) => string;
    yourMessage: string;
    activeSubscriptions: string;
    nextBilling: (date: string) => string;
    extendDays: string;
    showCredentials: string;
    usernameLabel: string;
    passwordLabel: string;
    noSubscriptions: string;
    invoices: string;
    noInvoicesYet: string;
    wallet: string;
    walletHint: string;
    recordTopUp: string;
    recording: string;
    recordTopUpButton: string;
    failedSubscribe: string;
    failedReveal: string;
    failedLink: string;
    failedExtend: string;
    failedSend: string;
    failedTopUp: string;
  };
  invoices: {
    title: string;
    description: string;
    loadingInvoices: string;
    noInvoices: string;
    noInvoicesHint: string;
    exportCsv: string;
    searchPlaceholder: string;
    allStatuses: string;
    statusPending: string;
    statusPartlyPaid: string;
    statusOverdue: string;
    statusPaid: string;
    statusCancelled: string;
    sortNewest: string;
    sortDueSoonest: string;
    sortLargest: string;
    loadingInvoice: string;
    emailInvoice: string;
    downloadPdf: string;
    billedItems: string;
    subtotal: string;
    tax: string;
    totalInvoiced: string;
    amountPaid: string;
    balanceDue: string;
    onlinePayment: string;
    onlinePaymentHint: string;
    mpesaPhone: string;
    triggering: string;
    payViaMpesa: (amount: string) => string;
    connecting: string;
    payViaPaystack: string;
    promptDispatched: string;
    paymentConfirmed: string;
    paymentFailed: (reason: string) => string;
    pinCancelled: string;
    subscriberCancelled: string;
    recordManual: string;
    amountPaidKes: string;
    paymentMethod: string;
    recording: string;
    recordPayment: string;
    ledger: string;
    noPayments: string;
    couldNotEmail: string;
    failedRecord: string;
    failedStk: string;
    failedPaystack: string;
  };
  routers: {
    title: string;
    description: string;
    linkRouter: string;
    loadingRouters: string;
    noRouters: string;
    linkFirst: string;
    linkingExplain: string;
    online: string;
    degraded: string;
    offline: string;
    notChecked: string;
    change: string;
    addressPrompt: string;
    waitingCheckIn: string;
    testing: string;
    testConnection: string;
    sessions: string;
    accessPoints: string;
    winboxAccess: string;
    tools: string;
    removing: string;
    remove: string;
    confirmRemove: (name: string) => string;
    lastError: string;
    found: (n: number) => string;
    scanning: string;
    rescan: string;
    apiUnreachable: string;
    apListFailed: string;
    apiCheck: string;
    unnamedAp: string;
    signal: string;
    openAdmin: string;
    noAps: string;
    activeSessions: string;
    refreshing: string;
    sessionsFailed: string;
    callerId: string;
    noSessions: string;
    connectWith: (name: string) => string;
    remoteAddress: string;
    openInWinbox: string;
    relayExplain: string;
    sameNetwork: string;
    sameNetworkHint: string;
    ifNoConnect: string;
    pasteScript: string;
    routerTools: string;
    appliedTo: (name: string) => string;
    pcqTitle: string;
    pcqDesc: string;
    applying: string;
    enable: string;
    dnsTitle: string;
    dnsDesc: string;
    standard: string;
    tunnelTitle: string;
    tunnelDesc: string;
    turnOn: string;
    turnOff: string;
    speedTitle: string;
    speedDesc: string;
    routerOsVersion: string;
    checking: string;
    checkUpdates: string;
    installed: string;
    latest: string;
    confirmUpgrade: string;
    upgrading: string;
    upgradeTo: (v: string) => string;
    noNewer: string;
    couldNotRemove: string;
    couldNotUpdateAddress: string;
    notAccepted: string;
    applyingNote: string;
    removingNote: string;
    relayOff: string;
    vpnNotConnected: string;
    portAssigning: string;
  };
  settings: {
    heading: string;
    groupGeneral: string;
    branding: string;
    brandingHint: string;
    domains: string;
    domainsHint: string;
    mySubscription: string;
    mySubscriptionHint: string;
    groupNetwork: string;
    routers: string;
    routersHint: string;
    hotspot: string;
    hotspotHint: string;
    groupBilling: string;
    gettingPaid: string;
    gettingPaidHint: string;
    communications: string;
    communicationsHint: string;
    groupIntegrations: string;
    aiAssistant: string;
    aiAssistantHint: string;
    developer: string;
    developerHint: string;
    whatsapp: string;
    whatsappHint: string;
    liveChat: string;
    liveChatHint: string;
    groupAccount: string;
    reminders: string;
    remindersHint: string;
    branches: string;
    alerts: string;
    alertsHint: string;
    branchesHint: string;
    staff: string;
    staffHint: string;
    password: string;
    passwordHint: string;
    // organization page
    loadingSettings: string;
    organization: string;
    organizationDesc: string;
    plan: string;
    currentPlan: string;
    noActivePlan: string;
    renewWithMpesa: string;
    subscribers: string;
    subscribersHint: string;
    routersUsage: string;
    routersUsageHint: string;
    of: (n: number) => string;
    noLimit: string;
    webAddress: string;
    copyWebAddress: string;
    ownDomain: string;
    domainManagement: string;
    businessName: string;
    tenantSlug: string;
    slugHint: string;
    timezone: string;
    defaultCurrency: string;
    currencyHint: string;
    brandingSection: string;
    brandColor: string;
    brandColorHint: string;
    logoUrl: string;
    logoHint: string;
    portalSection: string;
    portalSectionHint: string;
    helplinePhone: string;
    helplineHint: string;
    supportPhone: string;
    supportHint: string;
    welcomeTitle: string;
    bannerSubtitle: string;
    renewBadge: string;
    renewTitle: string;
    amount: string;
    mpesaPhone: string;
    stkHint: string;
    stkSent: string;
    sendingStk: string;
    sendStk: string;
    failedSave: string;
    failedRenew: string;
  };
}

const EN: PageStrings = {
  common: {
    cancel: "Cancel",
    close: "Close",
    send: "Send",
    sending: "Sending…",
    saving: "Saving…",
    saved: "Saved",
    saveChanges: "Save changes",
    loading: "Loading…",
    copy: "Copy",
    dismiss: "Dismiss",
    due: (d) => `Due ${d}`,
    subject: "Subject",
    email: "Email",
    sms: "SMS",
    status: "Status",
    username: "Username",
    ipAddress: "IP address",
    uptime: "Uptime",
    optional: "(optional)",
  },
  customers: {
    title: "Customers",
    description: "Your broadband subscribers, their PPPoE logins, subscriptions, joined dates, and spending.",
    exportCustomers: "Export customers (CSV)",
    exportPayments: "Export all payments (CSV)",
    reports: "Reports",
    newSubscriber: "+ New subscriber",
    registerTitle: "Register a new subscriber",
    fullName: "Full name",
    phoneMpesa: "Phone number (M-Pesa)",
    emailOptional: "Email address (optional)",
    registering: "Registering…",
    createAccount: "Create subscriber account",
    loadingSubscribers: "Loading subscribers…",
    joined: "Joined",
    noSubscribers: "No subscribers registered yet",
    addFirst: "Add your first subscriber using the button above.",
    createFailed: "Failed to create customer",
    exportFailed: "Export failed",
    searchPlaceholder: "Name, phone, email or account number",
    allStatuses: "All statuses",
    statusActive: "Active",
    statusSuspended: "Suspended",
    statusInactive: "Inactive",
    matching: (n) => `${n} matching`,
    allBranches: "All branches",
    noBranch: "No branch",
    branch: "Branch",
    loadingDetails: "Loading subscriber details…",
    account: "Account",
    portalLinked: "Self-service portal linked",
    loginEmailPlaceholder: "customer's login email",
    linking: "Linking…",
    link: "Link",
    linkLogin: "Link self-service login",
    assignSubscription: "Assign broadband subscription",
    selectTier: "Select an active bandwidth tier…",
    assigning: "Assigning and provisioning…",
    subscribeCustomer: "Subscribe customer",
    messageCustomer: "Message this customer",
    sentBy: (email, phone) => `Sent by email${email ? ` (${email})` : " (no address on file)"} and SMS (${phone}). Delivery is recorded in the audit log.`,
    yourMessage: "Your message…",
    activeSubscriptions: "Active PPPoE subscriptions",
    nextBilling: (d) => `Next billing date: ${d}`,
    extendDays: "Extend days",
    showCredentials: "Show PPPoE credentials",
    usernameLabel: "Username",
    passwordLabel: "Password",
    noSubscriptions: "No active subscriptions on this subscriber account.",
    invoices: "Invoices",
    noInvoicesYet: "No invoices generated yet.",
    wallet: "Customer wallet",
    walletHint: "Prepaid balance for auto-renewals",
    recordTopUp: "Record cash / manual top-up",
    recording: "Recording…",
    recordTopUpButton: "Record top-up",
    failedSubscribe: "Failed to subscribe",
    failedReveal: "Failed to reveal password",
    failedLink: "Failed to link account",
    failedExtend: "Failed to extend",
    failedSend: "Failed to send",
    failedTopUp: "Failed to top up wallet",
  },
  invoices: {
    title: "Invoices",
    description: "Bills sent to your subscribers, and whether they’re paid.",
    loadingInvoices: "Loading invoices…",
    noInvoices: "No invoices found",
    noInvoicesHint: "Invoices will appear when subscribers are billed.",
    exportCsv: "Export CSV",
    searchPlaceholder: "Invoice number, customer or phone",
    allStatuses: "All statuses",
    statusPending: "Pending",
    statusPartlyPaid: "Partly paid",
    statusOverdue: "Overdue",
    statusPaid: "Paid",
    statusCancelled: "Cancelled",
    sortNewest: "Newest first",
    sortDueSoonest: "Due soonest",
    sortLargest: "Largest first",
    loadingInvoice: "Loading invoice…",
    emailInvoice: "Email invoice to customer",
    downloadPdf: "Download PDF",
    billedItems: "Billed items",
    subtotal: "Subtotal",
    tax: "Tax (16% VAT)",
    totalInvoiced: "Total invoiced",
    amountPaid: "Amount paid",
    balanceDue: "Balance due",
    onlinePayment: "Instant online payment",
    onlinePaymentHint: "Collect payment via M-Pesa STK push or Paystack (cards, Apple Pay, bank transfer).",
    mpesaPhone: "M-Pesa phone number",
    triggering: "Triggering…",
    payViaMpesa: (a) => `Pay ${a} via M-Pesa`,
    connecting: "Connecting…",
    payViaPaystack: "Pay via Paystack",
    promptDispatched: "Prompt sent. Waiting for the subscriber to enter their M-Pesa PIN…",
    paymentConfirmed: "Payment confirmed. Invoice reconciled and service restored.",
    paymentFailed: (r) => `Payment failed: ${r}`,
    pinCancelled: "Subscriber PIN cancelled or insufficient funds.",
    subscriberCancelled: "The subscriber cancelled the prompt.",
    recordManual: "Record manual payment",
    amountPaidKes: "Amount paid (KES)",
    paymentMethod: "Payment method",
    recording: "Recording…",
    recordPayment: "Record payment",
    ledger: "Payment ledger",
    noPayments: "No payments recorded against this invoice yet.",
    couldNotEmail: "Could not email the invoice",
    failedRecord: "Failed to record payment",
    failedStk: "Failed to initiate M-Pesa push",
    failedPaystack: "Failed to initiate Paystack checkout",
  },
  routers: {
    title: "Routers",
    description: "MikroTik routers linked to your account. Their status is refreshed automatically.",
    linkRouter: "Link router",
    loadingRouters: "Loading routers…",
    noRouters: "No routers linked yet",
    linkFirst: "Link your first MikroTik",
    linkingExplain: "Linking gives you one command to paste into the router. It sets up RADIUS, the hotspot and the connection back to Suntech.",
    online: "Online",
    degraded: "Degraded",
    offline: "Offline",
    notChecked: "Not checked yet",
    change: "Change",
    addressPrompt: "Router address (IP or hostname):",
    waitingCheckIn: "Waiting for the router to check in",
    testing: "Testing…",
    testConnection: "Test connection",
    sessions: "Sessions",
    accessPoints: "Access points",
    winboxAccess: "WinBox access",
    tools: "Tools",
    removing: "Removing…",
    remove: "Remove",
    confirmRemove: (n) => `Remove router "${n}"? Customers on it will stop being able to log in.`,
    lastError: "Last error:",
    found: (n) => `${n} found`,
    scanning: "Scanning…",
    rescan: "Rescan",
    apiUnreachable: "Couldn’t reach the router’s API.",
    apListFailed: "The access point list didn’t load.",
    apiCheck: "Check that the router is online and that its setup command finished, since it creates the API user and the connection back to Suntech. Don’t open the API port (8728) to the internet to work around this.",
    unnamedAp: "Unnamed access point",
    signal: "Signal",
    openAdmin: "Open admin page ↗",
    noAps: "No access points found. Access points plugged into this router show up here through neighbour discovery and DHCP leases.",
    activeSessions: "Active PPPoE sessions",
    refreshing: "Refreshing…",
    sessionsFailed: "Sessions didn’t load.",
    callerId: "Caller ID",
    noSessions: "No active sessions right now.",
    connectWith: (n) => `Connect to ${n} with MikroTik’s WinBox app.`,
    remoteAddress: "Remote address, from anywhere",
    openInWinbox: "Open in WinBox",
    relayExplain: "WinBox connects to the Suntech server, which passes the connection to this router over its VPN. It works behind carrier NAT (Safaricom, Airtel and Faiba SIMs) and never opens WinBox on the router to the internet. Log in with the router’s own admin account.",
    sameNetwork: "On the same network as the router",
    sameNetworkHint: "Connect WinBox to 192.168.88.1, or pick the router from WinBox’s Neighbors tab.",
    ifNoConnect: "If remote WinBox won’t connect",
    pasteScript: "Paste this into the router’s terminal. It allows WinBox only from the Suntech server, its VPN and the router’s own LAN.",
    routerTools: "Router tools",
    appliedTo: (n) => `Changes are applied to ${n} straight away.`,
    pcqTitle: "Fair sharing (PCQ)",
    pcqDesc: "Shares the available bandwidth evenly between active devices, so one heavy download doesn’t slow everyone else down.",
    applying: "Applying…",
    enable: "Enable",
    dnsTitle: "Family-safe DNS",
    dnsDesc: "Points customers at Cloudflare for Families (1.1.1.3), which blocks malware and adult sites. “Standard” switches back to 8.8.8.8.",
    standard: "Standard",
    tunnelTitle: "Block tunnelling apps",
    tunnelDesc: "Stops phones that haven’t paid from getting online through SlowDNS, VPN and proxy tunnels before they log in. Customers who have logged in aren’t affected. Tunnels hidden inside encrypted traffic (like HA Tunnel) can only be limited, not fully blocked.",
    turnOn: "Turn on",
    turnOff: "Turn off",
    speedTitle: "Speed-test priority",
    speedDesc: "Gives Ookla and Fast.com speed tests priority up to 100 Mbps. Test results can then be higher than everyday browsing speeds.",
    routerOsVersion: "RouterOS version",
    checking: "Checking…",
    checkUpdates: "Check for updates",
    installed: "Installed",
    latest: "Latest",
    confirmUpgrade: "The router will download the new RouterOS version and reboot. Customers will be offline for a few minutes. Continue?",
    upgrading: "Upgrading…",
    upgradeTo: (v) => `Upgrade to ${v} and reboot`,
    noNewer: "No newer stable version found.",
    couldNotRemove: "Couldn’t remove the router.",
    couldNotUpdateAddress: "Couldn’t update the router address.",
    notAccepted: "The router didn’t accept the change.",
    applyingNote: "Applying on the router. Small routers take a minute or two.",
    removingNote: "Removing from the router. This can take a minute.",
    relayOff: "Remote WinBox isn’t switched on for this server yet (ENABLE_WINBOX_RELAY).",
    vpnNotConnected: "This router isn’t connected to the Suntech VPN yet. The VPN needs RouterOS 7: update the router, then run its setup command again.",
    portAssigning: "The remote port is being assigned. Check again in a minute.",
  },
  settings: {
    heading: "Settings",
    groupGeneral: "General",
    branding: "Branding",
    brandingHint: "Identity, logo, colours",
    domains: "Domain management",
    domainsHint: "Subdomain and custom domain",
    mySubscription: "My subscription",
    mySubscriptionHint: "Plan, usage and renewal",
    groupNetwork: "Network",
    routers: "Routers",
    routersHint: "MikroTik NAS devices",
    hotspot: "Hotspot",
    hotspotHint: "Packages, vouchers, portal",
    groupBilling: "Billing and messaging",
    gettingPaid: "Getting paid",
    gettingPaidHint: "Till, paybill, M-Pesa, cards",
    communications: "Communications",
    communicationsHint: "SMS gateway",
    groupIntegrations: "Integrations",
    aiAssistant: "AI assistant",
    aiAssistantHint: "Provider and API key",
    developer: "Developer",
    developerHint: "API tokens and webhooks",
    whatsapp: "WhatsApp",
    whatsappHint: "Link your number",
    liveChat: "Live chat",
    liveChatHint: "Tawk.to widget",
    groupAccount: "Account",
    reminders: "Reminders and tickets",
    branches: "Branches",
    alerts: "Alerts on this device",
    alertsHint: "Router down, large payments",
    branchesHint: "Towns or areas you run",
    remindersHint: "Payment reminders, response targets",
    staff: "Staff and roles",
    staffHint: "Who can sign in, and what they may do",
    password: "Password",
    passwordHint: "Sign-in security",
    loadingSettings: "Loading settings…",
    organization: "Organization",
    organizationDesc: "Your business details, branding, plan and web address.",
    plan: "Plan",
    currentPlan: "Current plan",
    noActivePlan: "No active plan",
    renewWithMpesa: "Renew with M-Pesa",
    subscribers: "Subscribers",
    subscribersHint: "PPPoE and hotspot accounts",
    routersUsage: "Routers",
    routersUsageHint: "MikroTik routers",
    of: (n) => `of ${n}`,
    noLimit: "· no limit",
    webAddress: "Your web address",
    copyWebAddress: "Copy web address",
    ownDomain: "Want your own domain, like wifi.yourisp.co.ke? Set it up in",
    domainManagement: "Domain management",
    businessName: "Business name",
    tenantSlug: "Tenant slug",
    slugHint: "Used in login and sign-up links. It cannot be changed here.",
    timezone: "Timezone",
    defaultCurrency: "Default currency",
    currencyHint: "New invoices and packages default to this currency.",
    brandingSection: "Branding",
    brandColor: "Brand colour",
    brandColorHint: "Used for buttons, active navigation, and accents across your console.",
    logoUrl: "Logo URL (optional)",
    logoHint: "Hosted image URL for invoices and captive portals.",
    portalSection: "Wi-Fi captive portal numbers and text",
    portalSectionHint: "These settings update your public Wi-Fi login screen and the numbers customers see.",
    helplinePhone: "Installation / helpline phone",
    helplineHint: "Shown on the banner as the number to call for installation.",
    supportPhone: "Customer support phone",
    supportHint: "Used for ticket support and WhatsApp inquiries.",
    welcomeTitle: "Welcome title",
    bannerSubtitle: "Banner subtitle",
    renewBadge: "M-Pesa STK push renewal",
    renewTitle: "Renew / upgrade plan",
    amount: "Amount",
    mpesaPhone: "M-Pesa phone number",
    stkHint: "You will receive an instant PIN prompt on your handset.",
    stkSent: "Check your phone and enter your M-Pesa PIN to complete the renewal.",
    sendingStk: "Sending…",
    sendStk: "Send M-Pesa prompt",
    failedSave: "Failed to save settings",
    failedRenew: "Failed to initiate M-Pesa renewal",
  },
};

const SW: PageStrings = {
  common: {
    cancel: "Ghairi",
    close: "Funga",
    send: "Tuma",
    sending: "Inatuma…",
    saving: "Inahifadhi…",
    saved: "Imehifadhiwa",
    saveChanges: "Hifadhi mabadiliko",
    loading: "Inapakia…",
    copy: "Nakili",
    dismiss: "Ondoa",
    due: (d) => `Inadaiwa ${d}`,
    subject: "Mada",
    email: "Barua pepe",
    sms: "SMS",
    status: "Hali",
    username: "Jina la mtumiaji",
    ipAddress: "Anwani ya IP",
    uptime: "Muda mtandaoni",
    optional: "(si lazima)",
  },
  customers: {
    title: "Wateja",
    description: "Wateja wako wa intaneti, akaunti zao za PPPoE, usajili, tarehe walizojiunga na matumizi yao.",
    exportCustomers: "Pakua wateja (CSV)",
    exportPayments: "Pakua malipo yote (CSV)",
    reports: "Ripoti",
    newSubscriber: "+ Mteja mpya",
    registerTitle: "Sajili mteja mpya",
    fullName: "Jina kamili",
    phoneMpesa: "Nambari ya simu (M-Pesa)",
    emailOptional: "Barua pepe (si lazima)",
    registering: "Inasajili…",
    createAccount: "Fungua akaunti ya mteja",
    loadingSubscribers: "Inapakia wateja…",
    joined: "Alijiunga",
    noSubscribers: "Hakuna wateja waliosajiliwa bado",
    addFirst: "Ongeza mteja wako wa kwanza kwa kitufe kilicho hapo juu.",
    createFailed: "Imeshindwa kuunda mteja",
    exportFailed: "Upakuaji umeshindwa",
    searchPlaceholder: "Jina, simu, barua pepe au nambari ya akaunti",
    allStatuses: "Hali zote",
    statusActive: "Inatumika",
    statusSuspended: "Imesimamishwa",
    statusInactive: "Haitumiki",
    matching: (n) => `${n} zinalingana`,
    allBranches: "Matawi yote",
    noBranch: "Bila tawi",
    branch: "Tawi",
    loadingDetails: "Inapakia maelezo ya mteja…",
    account: "Akaunti",
    portalLinked: "Akaunti ya kujihudumia imeunganishwa",
    loginEmailPlaceholder: "barua pepe ya kuingia ya mteja",
    linking: "Inaunganisha…",
    link: "Unganisha",
    linkLogin: "Unganisha akaunti ya kujihudumia",
    assignSubscription: "Weka kifurushi cha intaneti",
    selectTier: "Chagua kifurushi kinachotumika…",
    assigning: "Inaweka na kusanidi…",
    subscribeCustomer: "Sajili mteja",
    messageCustomer: "Tuma ujumbe kwa mteja huyu",
    sentBy: (email, phone) => `Hutumwa kwa barua pepe${email ? ` (${email})` : " (hakuna anwani)"} na SMS (${phone}). Utumaji hurekodiwa kwenye kumbukumbu ya ukaguzi.`,
    yourMessage: "Ujumbe wako…",
    activeSubscriptions: "Usajili wa PPPoE unaotumika",
    nextBilling: (d) => `Tarehe ya ankara ijayo: ${d}`,
    extendDays: "Ongeza siku",
    showCredentials: "Onyesha akaunti ya PPPoE",
    usernameLabel: "Jina la mtumiaji",
    passwordLabel: "Nenosiri",
    noSubscriptions: "Hakuna usajili unaotumika kwenye akaunti hii.",
    invoices: "Ankara",
    noInvoicesYet: "Hakuna ankara zilizotolewa bado.",
    wallet: "Pochi ya mteja",
    walletHint: "Salio la kulipia mapema kwa usasishaji wa kiotomatiki",
    recordTopUp: "Rekodi malipo ya pesa taslimu / mkono",
    recording: "Inarekodi…",
    recordTopUpButton: "Rekodi salio",
    failedSubscribe: "Imeshindwa kusajili",
    failedReveal: "Imeshindwa kuonyesha nenosiri",
    failedLink: "Imeshindwa kuunganisha akaunti",
    failedExtend: "Imeshindwa kuongeza",
    failedSend: "Imeshindwa kutuma",
    failedTopUp: "Imeshindwa kuongeza salio",
  },
  invoices: {
    title: "Ankara",
    description: "Ankara zilizotumwa kwa wateja wako, na kama zimelipwa.",
    loadingInvoices: "Inapakia ankara…",
    noInvoices: "Hakuna ankara",
    noInvoicesHint: "Ankara zitaonekana wateja wanapotozwa.",
    exportCsv: "Pakua CSV",
    searchPlaceholder: "Nambari ya ankara, mteja au simu",
    allStatuses: "Hali zote",
    statusPending: "Inasubiri",
    statusPartlyPaid: "Imelipwa kiasi",
    statusOverdue: "Imechelewa",
    statusPaid: "Imelipwa",
    statusCancelled: "Imeghairiwa",
    sortNewest: "Mpya kwanza",
    sortDueSoonest: "Zinazodaiwa hivi karibuni",
    sortLargest: "Kubwa kwanza",
    loadingInvoice: "Inapakia ankara…",
    emailInvoice: "Tuma ankara kwa barua pepe",
    downloadPdf: "Pakua PDF",
    billedItems: "Vipengee vilivyotozwa",
    subtotal: "Jumla ndogo",
    tax: "Kodi (VAT 16%)",
    totalInvoiced: "Jumla ya ankara",
    amountPaid: "Kiasi kilicholipwa",
    balanceDue: "Salio linalodaiwa",
    onlinePayment: "Malipo ya papo hapo mtandaoni",
    onlinePaymentHint: "Pokea malipo kupitia ombi la M-Pesa au Paystack (kadi, Apple Pay, uhamisho wa benki).",
    mpesaPhone: "Nambari ya simu ya M-Pesa",
    triggering: "Inatuma…",
    payViaMpesa: (a) => `Lipa ${a} kwa M-Pesa`,
    connecting: "Inaunganisha…",
    payViaPaystack: "Lipa kupitia Paystack",
    promptDispatched: "Ombi limetumwa. Tunasubiri mteja aweke PIN yake ya M-Pesa…",
    paymentConfirmed: "Malipo yamethibitishwa. Ankara imelinganishwa na huduma imerejeshwa.",
    paymentFailed: (r) => `Malipo hayakufaulu: ${r}`,
    pinCancelled: "PIN ya mteja ilighairiwa au salio halitoshi.",
    subscriberCancelled: "Mteja alighairi ombi.",
    recordManual: "Rekodi malipo ya mkono",
    amountPaidKes: "Kiasi kilicholipwa (KES)",
    paymentMethod: "Njia ya malipo",
    recording: "Inarekodi…",
    recordPayment: "Rekodi malipo",
    ledger: "Rekodi ya malipo",
    noPayments: "Hakuna malipo yaliyorekodiwa kwa ankara hii bado.",
    couldNotEmail: "Imeshindwa kutuma ankara kwa barua pepe",
    failedRecord: "Imeshindwa kurekodi malipo",
    failedStk: "Imeshindwa kuanzisha ombi la M-Pesa",
    failedPaystack: "Imeshindwa kuanzisha malipo ya Paystack",
  },
  routers: {
    title: "Ruta",
    description: "Ruta za MikroTik zilizounganishwa na akaunti yako. Hali yake inasasishwa yenyewe.",
    linkRouter: "Unganisha ruta",
    loadingRouters: "Inapakia ruta…",
    noRouters: "Hakuna ruta iliyounganishwa bado",
    linkFirst: "Unganisha MikroTik yako ya kwanza",
    linkingExplain: "Kuunganisha kunakupa amri moja ya kubandika kwenye ruta. Inasanidi RADIUS, hotspot na muunganisho wa kurudi Suntech.",
    online: "Mtandaoni",
    degraded: "Ina matatizo",
    offline: "Nje ya mtandao",
    notChecked: "Haijakaguliwa bado",
    change: "Badilisha",
    addressPrompt: "Anwani ya ruta (IP au jina la mwenyeji):",
    waitingCheckIn: "Inasubiri ruta iripoti",
    testing: "Inajaribu…",
    testConnection: "Jaribu muunganisho",
    sessions: "Vikao",
    accessPoints: "Vituo vya Wi-Fi",
    winboxAccess: "Ufikiaji wa WinBox",
    tools: "Zana",
    removing: "Inaondoa…",
    remove: "Ondoa",
    confirmRemove: (n) => `Ondoa ruta "${n}"? Wateja walio juu yake hawataweza kuingia tena.`,
    lastError: "Hitilafu ya mwisho:",
    found: (n) => `${n} zimepatikana`,
    scanning: "Inatafuta…",
    rescan: "Tafuta tena",
    apiUnreachable: "Imeshindwa kufikia API ya ruta.",
    apListFailed: "Orodha ya vituo vya Wi-Fi haikupakia.",
    apiCheck: "Hakikisha ruta iko mtandaoni na amri yake ya usanidi ilikamilika, kwa kuwa ndiyo huunda mtumiaji wa API na muunganisho wa kurudi Suntech. Usifungue bandari ya API (8728) kwa intaneti ili kukwepa hili.",
    unnamedAp: "Kituo cha Wi-Fi bila jina",
    signal: "Ishara",
    openAdmin: "Fungua ukurasa wa usimamizi ↗",
    noAps: "Hakuna vituo vya Wi-Fi vilivyopatikana. Vituo vilivyounganishwa kwenye ruta hii huonekana hapa kupitia ugunduzi wa majirani na DHCP.",
    activeSessions: "Vikao vya PPPoE vinavyotumika",
    refreshing: "Inasasisha…",
    sessionsFailed: "Vikao havikupakia.",
    callerId: "Kitambulisho cha kifaa",
    noSessions: "Hakuna vikao vinavyotumika kwa sasa.",
    connectWith: (n) => `Unganisha na ${n} kwa programu ya WinBox ya MikroTik.`,
    remoteAddress: "Anwani ya mbali, kutoka popote",
    openInWinbox: "Fungua kwenye WinBox",
    relayExplain: "WinBox huunganisha na seva ya Suntech, ambayo hupitisha muunganisho kwa ruta hii kupitia VPN yake. Inafanya kazi nyuma ya NAT ya mtandao wa simu (Safaricom, Airtel na Faiba) na haifungui WinBox ya ruta kwa intaneti kamwe. Ingia kwa akaunti ya msimamizi ya ruta yenyewe.",
    sameNetwork: "Kwenye mtandao mmoja na ruta",
    sameNetworkHint: "Unganisha WinBox na 192.168.88.1, au chagua ruta kutoka kichupo cha Neighbors cha WinBox.",
    ifNoConnect: "Ikiwa WinBox ya mbali haiunganishi",
    pasteScript: "Bandika hii kwenye terminal ya ruta. Inaruhusu WinBox kutoka seva ya Suntech, VPN yake na LAN ya ruta pekee.",
    routerTools: "Zana za ruta",
    appliedTo: (n) => `Mabadiliko yanatumika kwa ${n} mara moja.`,
    pcqTitle: "Kugawana sawa (PCQ)",
    pcqDesc: "Hugawa bandwidth iliyopo sawasawa kati ya vifaa vinavyotumika, ili upakuaji mmoja mkubwa usipunguze kasi ya wengine.",
    applying: "Inatumika…",
    enable: "Washa",
    dnsTitle: "DNS salama kwa familia",
    dnsDesc: "Huelekeza wateja kwa Cloudflare for Families (1.1.1.3), inayozuia programu hasidi na tovuti za watu wazima. “Kawaida” hurudisha 8.8.8.8.",
    standard: "Kawaida",
    tunnelTitle: "Zuia programu za tunnel",
    tunnelDesc: "Huzuia simu ambazo hazijalipa kuingia mtandaoni kupitia SlowDNS, VPN na proxy kabla ya kuingia. Wateja walioingia hawaathiriwi. Tunnel zilizofichwa ndani ya trafiki iliyosimbwa (kama HA Tunnel) zinaweza kupunguzwa tu, si kuzuiwa kabisa.",
    turnOn: "Washa",
    turnOff: "Zima",
    speedTitle: "Kipaumbele cha jaribio la kasi",
    speedDesc: "Hupa majaribio ya kasi ya Ookla na Fast.com kipaumbele hadi 100 Mbps. Matokeo yanaweza kuwa juu kuliko kasi ya kawaida ya kuvinjari.",
    routerOsVersion: "Toleo la RouterOS",
    checking: "Inakagua…",
    checkUpdates: "Kagua masasisho",
    installed: "Imesakinishwa",
    latest: "Ya hivi karibuni",
    confirmUpgrade: "Ruta itapakua toleo jipya la RouterOS na kuwasha upya. Wateja watakuwa nje ya mtandao kwa dakika chache. Endelea?",
    upgrading: "Inasasisha…",
    upgradeTo: (v) => `Sasisha hadi ${v} na uwashe upya`,
    noNewer: "Hakuna toleo jipya thabiti lililopatikana.",
    couldNotRemove: "Imeshindwa kuondoa ruta.",
    couldNotUpdateAddress: "Imeshindwa kubadilisha anwani ya ruta.",
    notAccepted: "Ruta haikukubali mabadiliko.",
    applyingNote: "Inatumika kwenye ruta. Ruta ndogo huchukua dakika moja au mbili.",
    removingNote: "Inaondolewa kwenye ruta. Hii inaweza kuchukua dakika.",
    relayOff: "WinBox ya mbali bado haijawashwa kwa seva hii (ENABLE_WINBOX_RELAY).",
    vpnNotConnected: "Ruta hii bado haijaunganishwa na VPN ya Suntech. VPN inahitaji RouterOS 7: sasisha ruta, kisha uendeshe amri yake ya usanidi tena.",
    portAssigning: "Bandari ya mbali inatengwa. Angalia tena baada ya dakika.",
  },
  settings: {
    heading: "Mipangilio",
    groupGeneral: "Jumla",
    branding: "Chapa",
    brandingHint: "Utambulisho, nembo, rangi",
    domains: "Usimamizi wa kikoa",
    domainsHint: "Kikoa kidogo na kikoa chako",
    mySubscription: "Usajili wangu",
    mySubscriptionHint: "Mpango, matumizi na usasishaji",
    groupNetwork: "Mtandao",
    routers: "Ruta",
    routersHint: "Vifaa vya MikroTik NAS",
    hotspot: "Hotspot",
    hotspotHint: "Vifurushi, vocha, portali",
    groupBilling: "Malipo na ujumbe",
    gettingPaid: "Kupokea malipo",
    gettingPaidHint: "Till, paybill, M-Pesa, kadi",
    communications: "Mawasiliano",
    communicationsHint: "Lango la SMS",
    groupIntegrations: "Miunganisho",
    aiAssistant: "Msaidizi wa AI",
    aiAssistantHint: "Mtoa huduma na ufunguo wa API",
    developer: "Msanidi programu",
    developerHint: "Tokeni za API na webhooks",
    whatsapp: "WhatsApp",
    whatsappHint: "Unganisha nambari yako",
    liveChat: "Gumzo la moja kwa moja",
    liveChatHint: "Wijeti ya Tawk.to",
    groupAccount: "Akaunti",
    reminders: "Vikumbusho na tiketi",
    branches: "Matawi",
    alerts: "Arifa kwenye kifaa hiki",
    alertsHint: "Ruta kuzimika, malipo makubwa",
    branchesHint: "Miji au maeneo mnayohudumia",
    remindersHint: "Vikumbusho vya malipo, muda wa majibu",
    staff: "Wafanyakazi na majukumu",
    staffHint: "Nani anaweza kuingia, na anaruhusiwa nini",
    password: "Nenosiri",
    passwordHint: "Usalama wa kuingia",
    loadingSettings: "Inapakia mipangilio…",
    organization: "Shirika",
    organizationDesc: "Maelezo ya biashara yako, chapa, mpango na anwani ya wavuti.",
    plan: "Mpango",
    currentPlan: "Mpango wa sasa",
    noActivePlan: "Hakuna mpango unaotumika",
    renewWithMpesa: "Sasisha kwa M-Pesa",
    subscribers: "Wateja",
    subscribersHint: "Akaunti za PPPoE na hotspot",
    routersUsage: "Ruta",
    routersUsageHint: "Ruta za MikroTik",
    of: (n) => `kati ya ${n}`,
    noLimit: "· bila kikomo",
    webAddress: "Anwani yako ya wavuti",
    copyWebAddress: "Nakili anwani ya wavuti",
    ownDomain: "Unataka kikoa chako, kama wifi.yourisp.co.ke? Kisanidi kwenye",
    domainManagement: "Usimamizi wa kikoa",
    businessName: "Jina la biashara",
    tenantSlug: "Kitambulisho cha ISP",
    slugHint: "Hutumika kwenye viungo vya kuingia na kujisajili. Hakiwezi kubadilishwa hapa.",
    timezone: "Saa za eneo",
    defaultCurrency: "Sarafu chaguomsingi",
    currencyHint: "Ankara na vifurushi vipya hutumia sarafu hii.",
    brandingSection: "Chapa",
    brandColor: "Rangi ya chapa",
    brandColorHint: "Hutumika kwa vitufe, urambazaji na mapambo kwenye dashibodi yako.",
    logoUrl: "URL ya nembo (si lazima)",
    logoHint: "URL ya picha kwa ankara na portali za hotspot.",
    portalSection: "Nambari na maandishi ya portali ya Wi-Fi",
    portalSectionHint: "Mipangilio hii inasasisha skrini ya kuingia ya Wi-Fi na nambari wateja wanazoona.",
    helplinePhone: "Simu ya usakinishaji / msaada",
    helplineHint: "Huonyeshwa kwenye bango kama nambari ya kupiga kwa usakinishaji.",
    supportPhone: "Simu ya msaada kwa wateja",
    supportHint: "Hutumika kwa tiketi za msaada na maswali ya WhatsApp.",
    welcomeTitle: "Kichwa cha karibu",
    bannerSubtitle: "Maelezo ya bango",
    renewBadge: "Usasishaji kwa ombi la M-Pesa",
    renewTitle: "Sasisha / pandisha mpango",
    amount: "Kiasi",
    mpesaPhone: "Nambari ya simu ya M-Pesa",
    stkHint: "Utapokea ombi la PIN papo hapo kwenye simu yako.",
    stkSent: "Angalia simu yako na uweke PIN yako ya M-Pesa kukamilisha usasishaji.",
    sendingStk: "Inatuma…",
    sendStk: "Tuma ombi la M-Pesa",
    failedSave: "Imeshindwa kuhifadhi mipangilio",
    failedRenew: "Imeshindwa kuanzisha usasishaji wa M-Pesa",
  },
};

export function pageStrings(lang: PortalLanguage): PageStrings {
  return lang === "sw" ? SW : EN;
}
