/**
 * Brand primitives for the public site (homepage, legal pages, auth screens).
 *
 * The contact details live here once so the header, footer, CTAs and floating support links can
 * never disagree about how to reach the business. The WhatsApp line is the one contact route the
 * business actually operates today; the support email is editable per deployment through the
 * landing CMS and is passed in where it is shown.
 */

export const SUPPORT_PHONE_DISPLAY = "+254 703 605 266";
export const SUPPORT_WHATSAPP_NUMBER = "254703605266";

export function whatsappLink(message: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** The Suntech square "S" mark. */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="7" fill="#1d4ed8" />
      <path
        d="M21 11.5c-.8-1.1-2.2-1.8-3.9-1.8-2.9 0-4.9 1.7-4.9 4.1 0 4.7 8.8 2.7 8.8 7.1 0 2.6-2.1 4.3-5.1 4.3-2.1 0-3.8-.8-4.9-2.2"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="22" r="1.8" fill="#34d399" />
    </svg>
  );
}

export function Logo({ inverted = false, className = "" }: { inverted?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span
        className={`text-[1.2rem] font-semibold tracking-[-0.02em] ${inverted ? "text-white" : "text-slate-950"}`}
      >
        Suntech<span className={inverted ? "text-blue-400" : "text-blue-700"}> Billing</span>
      </span>
    </span>
  );
}
