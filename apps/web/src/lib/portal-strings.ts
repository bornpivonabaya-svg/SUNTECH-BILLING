/**
 * Every phrase the captive portal shows a customer, in English and Kiswahili. The EN/SW switch
 * at the top of the portal picks one of these, and the themes and the portal's own sheets read
 * from it, so switching actually changes what the customer reads.
 *
 * Kept separate from the plugin translations (captive-portal-plugins/translations.ts), which
 * cover the optional widgets: these are the core screen every tenant ships.
 */

export type PortalLanguage = "en" | "sw";

export interface PortalStrings {
  hotspot: string;
  defaultTitle: string;
  defaultSubtitle: string;
  choosePackage: string;
  buy: string;
  popular: string;
  unlimited: string;
  unlimitedData: string;
  noPackages: string;
  callForHelp: (phone: string) => string;
  alreadyHaveAccess: string;
  enterVoucher: string;
  /** The voucher button in the portal's bottom bar, where space is short. */
  voucherShort: string;
  accountLogin: string;
  paidNotConnected: string;
  paidNotConnectedShort: string;
  help: string;
  homeInternet: string;
  installation: (fee: string) => string;
  callToConnect: string;
  needHelp: string;
  sendMessage: string;
  connectingYou: string;
  youAreConnected: string;
  accessUntil: string;
  signedInAs: string;
  // Sheets on the portal page
  paymentReceived: string;
  oneLastTap: string;
  connectMeNow: string;
  showCodeInstead: string;
  getConnected: string;
  getConnectedDesc: string;
  phonePaidWith: string;
  orPasteMessage: string;
  lookingForPayment: string;
  connectMe: string;
  cancel: string;
  reconnecting: string;
  reconnectWithCode: string;
  welcomeBack: string;
  packageStillActive: string;
  left: string;
  ofDataLeft: string;
  reconnect: string;
  notNow: string;
  reconnectingYou: string;
  usingLastCode: string;
  activatingInternet: string;
  paymentConnecting: string;
  verified: string;
  automaticLogin: string;
  paymentConfirmed: string;
  connectingNow: string;
  checkYourPhone: string;
  enterPinToPay: string;
  from: string;
  waitingForConfirmation: string;
  enteredPin: string;
  youAreBuying: string;
  paymentMethod: string;
  card: string;
  mpesaNumber: string;
  phoneNumber: string;
  mpesaHint: string;
  pesapalHint: string;
  paystackHint: string;
  email: string;
  optional: string;
  sending: string;
  continueToPesapal: string;
  continueToCard: string;
  payWithMpesa: (amount: string) => string;
  enterYourVoucher: string;
  voucherDesc: string;
  voucherCode: string;
  connecting: string;
  connect: string;
  accountLoginDesc: string;
  password: string;
  signingIn: string;
  signInAndConnect: string;
  connectTv: string;
  connectTvDesc: string;
  gotIt: string;
  messageSent: string;
  contactSupport: string;
  weWillGetBack: string;
  tellUsWhatsWrong: string;
  close: string;
  yourName: string;
  whatsTheProblem: string;
  sendMessageButton: string;
}

const EN: PortalStrings = {
  hotspot: "Wi-Fi hotspot",
  defaultTitle: "Fast, reliable Wi-Fi",
  defaultSubtitle: "Pay with M-Pesa and connect instantly",
  choosePackage: "Choose a package",
  buy: "Buy",
  popular: "Popular",
  unlimited: "Unlimited",
  unlimitedData: "Unlimited data",
  noPackages: "No packages are on sale right now.",
  callForHelp: (phone) => ` Call ${phone} for help.`,
  alreadyHaveAccess: "Already have access?",
  enterVoucher: "Enter voucher",
  voucherShort: "Voucher",
  accountLogin: "Account login",
  paidNotConnected: "Paid but not connected? Get connected",
  paidNotConnectedShort: "Paid but not connected?",
  help: "Help",
  homeInternet: "Home internet",
  installation: (fee) => `Installation ${fee}. `,
  callToConnect: "to connect.",
  needHelp: "Need help?",
  sendMessage: "Send us a message",
  connectingYou: "Connecting you…",
  youAreConnected: "You’re connected",
  accessUntil: "Access until",
  signedInAs: "Signed in as",
  paymentReceived: "Payment received",
  oneLastTap: "One last tap to get online. Your browser needs you to confirm.",
  connectMeNow: "Connect me now",
  showCodeInstead: "Show my voucher code instead",
  getConnected: "Get connected",
  getConnectedDesc: "Enter the number you paid with, or paste the M-Pesa message. We’ll find your purchase and connect you.",
  phonePaidWith: "Phone number you paid with",
  orPasteMessage: "or paste the M-Pesa message",
  lookingForPayment: "Looking for your payment…",
  connectMe: "Connect me",
  cancel: "Cancel",
  reconnecting: "Reconnecting…",
  reconnectWithCode: "Reconnect with my code",
  welcomeBack: "Welcome back",
  packageStillActive: "Your package is still active on this phone.",
  left: "left",
  ofDataLeft: "of data left",
  reconnect: "Reconnect",
  notNow: "Not now",
  reconnectingYou: "Reconnecting you…",
  usingLastCode: "Using your code from last time.",
  activatingInternet: "Activating internet…",
  paymentConnecting: "Payment received. Connecting your device to the Wi-Fi now.",
  verified: "Verified",
  automaticLogin: "Automatic login in progress",
  paymentConfirmed: "Payment confirmed",
  connectingNow: "Connecting you to the internet now…",
  checkYourPhone: "Check your phone",
  enterPinToPay: "Enter your M-Pesa PIN to pay",
  from: "from",
  waitingForConfirmation: "Waiting for confirmation",
  enteredPin: "I’ve entered my PIN",
  youAreBuying: "You’re buying",
  paymentMethod: "Payment method",
  card: "Card",
  mpesaNumber: "M-Pesa number",
  phoneNumber: "Phone number",
  mpesaHint: "You’ll get a prompt on this phone to enter your M-Pesa PIN.",
  pesapalHint: "Pay with M-Pesa, Airtel Money, Visa or Mastercard on Pesapal.",
  paystackHint: "We’ll send your voucher code to this number.",
  email: "Email",
  optional: "(optional)",
  sending: "Sending…",
  continueToPesapal: "Continue to Pesapal",
  continueToCard: "Continue to card payment",
  payWithMpesa: (amount) => `Pay ${amount} with M-Pesa`,
  enterYourVoucher: "Enter your voucher",
  voucherDesc: "The code on your printed voucher or payment message.",
  voucherCode: "Voucher code",
  connecting: "Connecting…",
  connect: "Connect",
  accountLoginDesc: "Sign in with the account your internet provider gave you.",
  password: "Password",
  signingIn: "Signing in…",
  signInAndConnect: "Sign in and connect",
  connectTv: "Connect a TV or console",
  connectTvDesc:
    "Devices without a browser can’t open this page. Buy a package on your phone, then enter the voucher code on the device, or ask support to add the device.",
  gotIt: "Got it",
  messageSent: "Message sent",
  contactSupport: "Contact support",
  weWillGetBack: "We’ll get back to you shortly.",
  tellUsWhatsWrong: "Tell us what’s wrong and we’ll follow up.",
  close: "Close",
  yourName: "Your name",
  whatsTheProblem: "What’s the problem?",
  sendMessageButton: "Send message",
};

const SW: PortalStrings = {
  hotspot: "Wi-Fi ya hotspot",
  defaultTitle: "Wi-Fi ya kasi na ya kutegemewa",
  defaultSubtitle: "Lipa na M-Pesa uunganishwe mara moja",
  choosePackage: "Chagua kifurushi",
  buy: "Nunua",
  popular: "Maarufu",
  unlimited: "Bila kikomo",
  unlimitedData: "Data bila kikomo",
  noPackages: "Hakuna vifurushi vinavyouzwa kwa sasa.",
  callForHelp: (phone) => ` Piga ${phone} kwa msaada.`,
  alreadyHaveAccess: "Tayari una kifurushi?",
  enterVoucher: "Weka vocha",
  voucherShort: "Vocha",
  accountLogin: "Ingia na akaunti",
  paidNotConnected: "Umelipa lakini hujaunganishwa? Unganishwa",
  paidNotConnectedShort: "Umelipa lakini hujaunganishwa?",
  help: "Msaada",
  homeInternet: "Intaneti ya nyumbani",
  installation: (fee) => `Usakinishaji ${fee}. `,
  callToConnect: "ili kuunganishwa.",
  needHelp: "Unahitaji msaada?",
  sendMessage: "Tutumie ujumbe",
  connectingYou: "Tunakuunganisha…",
  youAreConnected: "Umeunganishwa",
  accessUntil: "Hadi",
  signedInAs: "Umeingia kama",
  paymentReceived: "Malipo yamepokelewa",
  oneLastTap: "Gusa mara moja zaidi ili uwe mtandaoni. Kivinjari chako kinahitaji uthibitishe.",
  connectMeNow: "Niunganishe sasa",
  showCodeInstead: "Nionyeshe nambari ya vocha badala yake",
  getConnected: "Unganishwa",
  getConnectedDesc: "Weka nambari uliyolipa nayo, au bandika ujumbe wa M-Pesa. Tutapata malipo yako na kukuunganisha.",
  phonePaidWith: "Nambari ya simu uliyolipa nayo",
  orPasteMessage: "au bandika ujumbe wa M-Pesa",
  lookingForPayment: "Tunatafuta malipo yako…",
  connectMe: "Niunganishe",
  cancel: "Ghairi",
  reconnecting: "Tunakuunganisha tena…",
  reconnectWithCode: "Unganisha tena na nambari yangu",
  welcomeBack: "Karibu tena",
  packageStillActive: "Kifurushi chako bado kinatumika kwenye simu hii.",
  left: "zimesalia",
  ofDataLeft: "za data zimesalia",
  reconnect: "Unganisha tena",
  notNow: "Si sasa",
  reconnectingYou: "Tunakuunganisha tena…",
  usingLastCode: "Tunatumia nambari yako ya mara ya mwisho.",
  activatingInternet: "Tunawasha intaneti…",
  paymentConnecting: "Malipo yamepokelewa. Tunaunganisha kifaa chako kwenye Wi-Fi sasa.",
  verified: "Imethibitishwa",
  automaticLogin: "Kuingia kiotomatiki kunaendelea",
  paymentConfirmed: "Malipo yamethibitishwa",
  connectingNow: "Tunakuunganisha kwenye intaneti sasa…",
  checkYourPhone: "Angalia simu yako",
  enterPinToPay: "Weka PIN yako ya M-Pesa ulipe",
  from: "kutoka",
  waitingForConfirmation: "Tunasubiri uthibitisho",
  enteredPin: "Nimeweka PIN yangu",
  youAreBuying: "Unanunua",
  paymentMethod: "Njia ya malipo",
  card: "Kadi",
  mpesaNumber: "Nambari ya M-Pesa",
  phoneNumber: "Nambari ya simu",
  mpesaHint: "Utapata ombi kwenye simu hii la kuweka PIN yako ya M-Pesa.",
  pesapalHint: "Lipa kwa M-Pesa, Airtel Money, Visa au Mastercard kupitia Pesapal.",
  paystackHint: "Tutatuma nambari ya vocha yako kwenye nambari hii.",
  email: "Barua pepe",
  optional: "(si lazima)",
  sending: "Inatuma…",
  continueToPesapal: "Endelea kwa Pesapal",
  continueToCard: "Endelea kulipa kwa kadi",
  payWithMpesa: (amount) => `Lipa ${amount} kwa M-Pesa`,
  enterYourVoucher: "Weka vocha yako",
  voucherDesc: "Nambari iliyo kwenye vocha yako au ujumbe wa malipo.",
  voucherCode: "Nambari ya vocha",
  connecting: "Inaunganisha…",
  connect: "Unganisha",
  accountLoginDesc: "Ingia na akaunti uliyopewa na mtoa huduma wako wa intaneti.",
  password: "Nenosiri",
  signingIn: "Inaingia…",
  signInAndConnect: "Ingia na uunganishwe",
  connectTv: "Unganisha TV au konsoli",
  connectTvDesc:
    "Vifaa visivyo na kivinjari haviwezi kufungua ukurasa huu. Nunua kifurushi kwenye simu yako, kisha weka nambari ya vocha kwenye kifaa, au omba msaada kiongezwe.",
  gotIt: "Sawa",
  messageSent: "Ujumbe umetumwa",
  contactSupport: "Wasiliana na msaada",
  weWillGetBack: "Tutakujibu hivi karibuni.",
  tellUsWhatsWrong: "Tuambie tatizo na tutafuatilia.",
  close: "Funga",
  yourName: "Jina lako",
  whatsTheProblem: "Tatizo ni nini?",
  sendMessageButton: "Tuma ujumbe",
};

export const PORTAL_STRINGS: Record<PortalLanguage, PortalStrings> = { en: EN, sw: SW };

export function portalStrings(lang: PortalLanguage | null | undefined): PortalStrings {
  return lang === "sw" ? SW : EN;
}

const STORAGE_KEY = "mkg_portal_lang";

/** The language this phone chose last time, if any. */
export function loadPortalLanguage(): PortalLanguage | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "sw" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function savePortalLanguage(lang: PortalLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}
