import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { AuthProvider } from "@/lib/auth-context";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const viewport: Viewport = {
  themeColor: "#090d16",
  width: "device-width",
  initialScale: 1,
  // No maximumScale: 1. Pinch-to-zoom is how a low-vision customer reads a voucher code or an
  // invoice line on a phone, and locking it out fails WCAG 1.4.4. iOS's "zooms on focus" quirk
  // that this is usually reached for is already avoided by the app's 16px form-field sizing.
};

export const metadata: Metadata = {
  // Required for Open Graph and canonical URLs to resolve. Without it Next emits relative og
  // URLs, which every crawler and link-preview scraper ignores — so a link pasted into WhatsApp
  // or Facebook renders as a bare URL with no title, description or image.
  metadataBase: new URL(SITE_URL),
  title: {
    // Pages set their own title; this frames it. A single shared title across every page is why
    // search results for a whole site can look like duplicates of one another.
    default: "Suntech Billing — Wi-Fi & ISP Billing System in Kenya",
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Wi-Fi and internet billing software for ISPs in Kenya. Sell hotspot vouchers, collect M-Pesa payments automatically, manage MikroTik routers and RADIUS authentication from one dashboard.",
  applicationName: SITE_NAME,
  // Keywords are a weak signal at best; the phrases that matter are the ones in the title,
  // description, headings and FAQ answers. Kept short and truthful rather than stuffed.
  keywords: [
    "wifi billing system Kenya",
    "hotspot billing software Kenya",
    "ISP billing software Kenya",
    "M-Pesa wifi billing",
    "MikroTik hotspot billing",
    "RADIUS billing system",
    "wifi voucher system Kenya",
  ],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo.jpg",
    apple: "/logo.jpg",
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    locale: "en_KE",
    title: "Suntech Billing — Wi-Fi & ISP Billing System in Kenya",
    description:
      "Sell hotspot vouchers, collect M-Pesa payments automatically and manage MikroTik routers from one dashboard.",
    images: [{ url: "/logo.jpg", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Suntech Billing — Wi-Fi & ISP Billing System in Kenya",
    description:
      "Sell hotspot vouchers, collect M-Pesa payments automatically and manage MikroTik routers from one dashboard.",
    images: ["/logo.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE" className="dark" suppressHydrationWarning>
      <body className="bg-obsidian-950 text-slate-100 antialiased min-h-screen" suppressHydrationWarning>
        <QueryProvider>
          <AuthProvider>
            <MaintenanceBanner />
            {children}
            <PwaInstallPrompt />
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
