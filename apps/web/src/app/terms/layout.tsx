import type { Metadata } from "next";

/**
 * Metadata only. The page itself is a client component ("use client"), and a client component
 * cannot export `metadata` — so without this wrapper every one of these pages would inherit the
 * site-wide title and appear in search results as a duplicate of the homepage.
 */
export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing use of Suntech Billing's ISP billing, hotspot and network management platform.",
  alternates: { canonical: "/terms" },
  openGraph: { title: "Terms of Service", description: "The terms governing use of Suntech Billing's ISP billing, hotspot and network management platform.", url: "/terms" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
