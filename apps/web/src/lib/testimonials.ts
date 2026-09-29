export interface TestimonialItem {
  id: string;
  name: string;
  role: string;
  company: string;
  subscribers?: string;
  quote: string;
  initials: string;
  color: string;
  verified: boolean;
}

export interface TestimonialsConfig {
  badge: string;
  title: string;
  subtitle: string;
  items: TestimonialItem[];
}

export const DEFAULT_TESTIMONIALS: TestimonialsConfig = {
  badge: "Proven in the Field",
  title: "Trusted by network engineers across Kenya",
  subtitle:
    "Hear from network operators who swapped manual Excel spreadsheets and Winbox script pasting for Suntech Billing.",
  items: [
    {
      id: "kevin-omondi",
      name: "Kevin Omondi",
      role: "CTO",
      company: "Nairobi Metro Fiber",
      subscribers: "5,200 Subs",
      quote:
        "Before Mashupkgrid, we had 3 staff members cross-referencing Paybill SMS with customer PPPoE accounts manually. We lost over KES 120,000 monthly in late cutoffs. Now, the moment an M-Pesa payment lands, our MikroTik un-throttles them in 2 seconds.",
      initials: "KO",
      color: "bg-brand-600",
      verified: true,
    },
    {
      id: "mercy-kiprop",
      name: "Mercy Kiprop",
      role: "Operations Director",
      company: "Rift Valley Wireless",
      subscribers: "Eldoret & Nakuru",
      quote:
        "We distribute wireless broadband across Eldoret and Nakuru. Generating 3,000 hotspot vouchers with QR codes used to take us a full day of scripting. With Mashupkgrid, our staff prints ready batches in 3 minutes.",
      initials: "MK",
      color: "bg-emerald-600",
      verified: true,
    },
    {
      id: "hassan-ali",
      name: "Hassan Ali",
      role: "Founder",
      company: "Coast Highspeed Broadband",
      subscribers: "4 Subsidiaries",
      quote:
        "The multi-tenant feature allows us to run 4 different ISP subsidiaries along the Kenyan coast with their own branding, separate Paybills, and isolated customer portals from a single unified management pane.",
      initials: "HA",
      color: "bg-indigo-600",
      verified: true,
    },
  ],
};

const STORAGE_KEY = "mkg_landing_testimonials";

export function getTestimonialsConfig(): TestimonialsConfig {
  if (typeof window === "undefined") {
    return DEFAULT_TESTIMONIALS;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TESTIMONIALS;
    const parsed = JSON.parse(raw);
    return {
      badge: parsed.badge || DEFAULT_TESTIMONIALS.badge,
      title: parsed.title || DEFAULT_TESTIMONIALS.title,
      subtitle: parsed.subtitle || DEFAULT_TESTIMONIALS.subtitle,
      items: Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : DEFAULT_TESTIMONIALS.items,
    };
  } catch {
    return DEFAULT_TESTIMONIALS;
  }
}

export function saveTestimonialsConfig(config: TestimonialsConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new Event("mkg_testimonials_change"));
  } catch (err) {
    console.error("Failed to save testimonials config", err);
  }
}

export function resetTestimonialsConfig(): TestimonialsConfig {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("mkg_testimonials_change"));
  }
  return DEFAULT_TESTIMONIALS;
}
