import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * The website's homepage. Field names match what apps/web/src/lib/sanity.ts reads; anything left
 * empty keeps the text the site already has, so an editor can change one section at a time.
 */

const ICONS = [
  { title: "Router", value: "router" },
  { title: "M-Pesa (green)", value: "mpesa" },
  { title: "Growth chart", value: "growth" },
  { title: "Shield", value: "shield" },
  { title: "Ticket / voucher", value: "ticket" },
  { title: "People", value: "users" },
  { title: "WhatsApp", value: "whatsapp" },
  { title: "Invoice", value: "invoice" },
  { title: "Lock", value: "lock" },
  { title: "Message", value: "message" },
  { title: "Globe", value: "globe" },
];

const iconField = defineField({ name: "icon", title: "Icon", type: "string", options: { list: ICONS, layout: "dropdown" } });
const bullets = (title = "Points", max = 8) =>
  defineField({ name: "bullets", title, type: "array", of: [defineArrayMember({ type: "string" })], validation: (r) => r.max(max) });
const text = (name: string, title: string, rows = 3) => defineField({ name, title, type: "text", rows });
const kes = (name: string, title: string) => defineField({ name, title, type: "number", validation: (r) => r.min(0).integer() });

export const homepage = defineType({
  name: "homepage",
  title: "Homepage",
  type: "document",
  groups: [
    { name: "hero", title: "Top of page", default: true },
    { name: "features", title: "Features" },
    { name: "customers", title: "Customers" },
    { name: "pricing", title: "Pricing" },
    { name: "kenya", title: "Kenya section" },
    { name: "faq", title: "FAQ" },
    { name: "footer", title: "Footer" },
  ],
  fields: [
    defineField({
      name: "hero",
      title: "Headline section",
      type: "object",
      group: "hero",
      fields: [
        defineField({ name: "statusBadge", title: "Small badge above the headline", type: "string" }),
        defineField({ name: "mainHeadingStart", title: "Headline — first part", type: "string" }),
        defineField({ name: "mainHeadingGradient", title: "Headline — highlighted (blue) part", type: "string" }),
        defineField({ name: "mainHeadingEnd", title: "Headline — last part", type: "string" }),
        text("description", "Paragraph under the headline", 4),
        defineField({ name: "primaryCtaText", title: "Main button text", type: "string" }),
        defineField({ name: "primaryCtaUrl", title: "Main button link", type: "string" }),
        defineField({ name: "secondaryCtaText", title: "Second button text", type: "string" }),
        defineField({ name: "secondaryCtaUrl", title: "Second button link", type: "string" }),
        defineField({ name: "ticks", title: "Ticks under the buttons", type: "array", of: [defineArrayMember({ type: "string" })], validation: (r) => r.max(4) }),
      ],
    }),
    defineField({
      name: "announcement",
      title: "Announcement bar",
      type: "object",
      group: "hero",
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({ name: "badge", type: "string" }),
        defineField({ name: "text", type: "string" }),
        defineField({ name: "linkText", title: "Link text", type: "string" }),
        defineField({ name: "linkUrl", title: "Link", type: "string" }),
      ],
    }),
    defineField({
      name: "featureGroups",
      title: "Feature groups",
      description: "The four cards under “Everything you need”. Shown two per row; on phones the first three points show until “Show more”.",
      type: "array",
      group: "features",
      validation: (r) => r.max(6),
      of: [
        defineArrayMember({
          type: "object",
          name: "featureGroup",
          fields: [defineField({ name: "title", type: "string", validation: (r) => r.required() }), text("body", "Short description", 2), iconField, bullets("Points", 8)],
          preview: { select: { title: "title", subtitle: "body" } },
        }),
      ],
    }),
    defineField({
      name: "network",
      title: "Remote WinBox and VLANs (dark section)",
      type: "object",
      group: "features",
      fields: [
        defineField({ name: "eyebrow", title: "Small label", type: "string" }),
        defineField({ name: "title", type: "string" }),
        text("body", "Paragraph", 4),
        bullets("Points", 6),
      ],
    }),
    defineField({
      name: "showcasePoints",
      title: "Platform points (beside the customers screenshot)",
      type: "array",
      group: "features",
      of: [defineArrayMember({ type: "string" })],
      validation: (r) => r.max(8),
    }),
    defineField({
      name: "steps",
      title: "“Live in five steps”",
      type: "array",
      group: "features",
      validation: (r) => r.max(6),
      of: [
        defineArrayMember({
          type: "object",
          name: "step",
          fields: [defineField({ name: "title", type: "string", validation: (r) => r.required() }), text("body", "Text", 2)],
          preview: { select: { title: "title", subtitle: "body" } },
        }),
      ],
    }),
    defineField({
      name: "customerPoints",
      title: "For your customers",
      type: "array",
      group: "customers",
      validation: (r) => r.max(6),
      of: [
        defineArrayMember({
          type: "object",
          name: "customerPoint",
          fields: [defineField({ name: "title", type: "string", validation: (r) => r.required() }), text("body", "Text", 3), iconField, bullets("Points", 5)],
          preview: { select: { title: "title", subtitle: "body" } },
        }),
      ],
    }),
    defineField({
      name: "pricing",
      title: "Prices (KES per month)",
      description: "Annual prices are per month when paid yearly. The “save %” label is worked out from these.",
      type: "object",
      group: "pricing",
      fields: [
        kes("starterMonthly", "Starter — monthly"),
        kes("starterAnnual", "Starter — per month, paid yearly"),
        kes("growthMonthly", "Growth — monthly"),
        kes("growthAnnual", "Growth — per month, paid yearly"),
        kes("carrierMonthly", "Enterprise — monthly"),
        kes("carrierAnnual", "Enterprise — per month, paid yearly"),
      ],
    }),
    defineField({
      name: "planIncludes",
      title: "Included in every plan",
      type: "array",
      group: "pricing",
      of: [defineArrayMember({ type: "string" })],
      validation: (r) => r.max(10),
    }),
    defineField({
      name: "operatorPoints",
      title: "Made for Kenyan ISPs",
      type: "array",
      group: "kenya",
      validation: (r) => r.max(9),
      of: [
        defineArrayMember({
          type: "object",
          name: "operatorPoint",
          fields: [defineField({ name: "title", type: "string", validation: (r) => r.required() }), text("body", "Text", 2), iconField],
          preview: { select: { title: "title", subtitle: "body" } },
        }),
      ],
    }),
    defineField({
      name: "faqs",
      title: "Questions and answers",
      description: "Also sent to Google as FAQ data, so keep answers true to what the product does.",
      type: "array",
      group: "faq",
      of: [
        defineArrayMember({
          type: "object",
          name: "faq",
          fields: [
            defineField({ name: "q", title: "Question", type: "string", validation: (r) => r.required() }),
            defineField({ name: "a", title: "Answer", type: "text", rows: 4, validation: (r) => r.required() }),
          ],
          preview: { select: { title: "q", subtitle: "a" } },
        }),
      ],
    }),
    defineField({
      name: "footer",
      title: "Footer",
      type: "object",
      group: "footer",
      fields: [
        text("description", "About text", 3),
        defineField({ name: "supportEmail", title: "Support email", type: "string" }),
        defineField({ name: "supportPhone", title: "Support phone", type: "string" }),
        defineField({ name: "copyrightYear", title: "Copyright year", type: "string" }),
      ],
    }),
  ],
  preview: { prepare: () => ({ title: "Homepage" }) },
});
