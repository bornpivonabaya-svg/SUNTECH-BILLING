import Link from "next/link";
import { Logo, SUPPORT_PHONE_DISPLAY, whatsappLink } from "./brand";

const DEFAULT_DESCRIPTION =
  "ISP management and billing software for internet providers and hotspot operators in Kenya — subscribers, M-Pesa collections, MikroTik and RADIUS in one platform.";

type FooterLink = { label: string; href: string; external?: boolean };

/** Every entry points at a page or section that exists. There is deliberately no "Privacy Policy"
 *  or social-media column: neither exists yet, and a footer link to nothing reads as abandoned. */
function columns(supportEmail?: string): { title: string; links: FooterLink[] }[] {
  return [
    {
      title: "Product",
      links: [
        { label: "Features", href: "/#features" },
        { label: "Pricing", href: "/#pricing" },
        { label: "Integrations", href: "/#integrations" },
        { label: "Dashboard", href: "/dashboard" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/#about" },
        supportEmail
          ? { label: "Contact", href: `mailto:${supportEmail}`, external: true }
          : { label: "Contact", href: whatsappLink("Hello MashupHost, I'd like to talk to your team."), external: true },
        { label: "Support", href: whatsappLink("Hello MashupHost Support"), external: true },
      ],
    },
    {
      title: "More",
      links: [
        { label: "Customer portal", href: "/app" },
        { label: "Hardware store", href: "/shop" },
        { label: "Track an order", href: "/track" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms of Service", href: "/terms" },
        { label: "Refund Policy", href: "/refund-policy" },
        { label: "Age Policy", href: "/age-policy" },
      ],
    },
  ];
}

export function SiteFooter({
  description = DEFAULT_DESCRIPTION,
  supportEmail,
  copyrightYear,
}: {
  description?: string;
  supportEmail?: string;
  copyrightYear?: string;
}) {
  const year = copyrightYear || String(new Date().getFullYear());

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 pt-14 pb-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div className="max-w-sm">
            <Link href="/" aria-label="MashupHost home" className="inline-block">
              <Logo />
            </Link>
            <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
            <a
              href={whatsappLink("Hello MashupHost Support")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-medium text-slate-900 hover:text-blue-700"
            >
              {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {columns(supportEmail).map((col) => (
              <div key={col.title}>
                <p className="text-sm font-semibold text-slate-950">{col.title}</p>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target={link.href.startsWith("http") ? "_blank" : undefined}
                          rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                          className="text-sm text-slate-600 transition-colors hover:text-slate-950"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className="text-sm text-slate-600 transition-colors hover:text-slate-950">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} MashupHost. All rights reserved.</p>
          <p>Made in Nairobi, Kenya</p>
        </div>
      </div>
    </footer>
  );
}
