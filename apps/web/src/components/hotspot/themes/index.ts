import type { ComponentType } from "react";
import type { CaptiveThemeProps, ThemeId, ThemeMeta } from "./types";
import { MashupHostCleanTheme } from "./mashuphost-clean";
import { GoldEnergyTheme } from "./gold-energy";
import { SuntechBlueTheme } from "./suntech-blue";
import { ModernGlassTheme } from "./modern-glass";
import { VibrantRetailTheme } from "./vibrant-retail";
import { HospitalityCleanTheme } from "./hospitality-clean";
import { CyberpunkNeonTheme } from "./cyberpunk-neon";
import { PALETTE_PRESETS, createPaletteTheme, paletteThemeMeta, type PaletteThemeId } from "./palette-theme";

export * from "./types";
export {
  MashupHostCleanTheme,
  GoldEnergyTheme,
  SuntechBlueTheme,
  ModernGlassTheme,
  VibrantRetailTheme,
  HospitalityCleanTheme,
  CyberpunkNeonTheme,
};

export const THEME_CATALOG: ThemeMeta[] = [
  {
    id: "mashuphost-clean",
    name: "Suntech Clean",
    category: "Recommended",
    description: "Fast, light and clear. Loads quickly on any phone, uses your logo and brand colour, and puts packages, voucher login and help on one screen.",
    badgeColor: "bg-emerald-600 text-white",
    accentColor: "border-emerald-500",
    inlineHelp: true,
    appearance: "light",
  },
  {
    id: "gold-energy",
    name: "Gold Energy (SPICEZCOM Theme)",
    category: "Commercial ISP",
    description: "High-converting Kenyan ISP layout with gold energy waves, 3D cartoon signboard cards, 5-step visual guide, and support bar.",
    badgeColor: "bg-amber-500 text-slate-950",
    accentColor: "border-amber-500",
  },
  {
    id: "suntech-blue",
    name: "Suntech Blue (Red Boy Denim Theme)",
    category: "Commercial ISP",
    description: "Vibrant royal denim blue layout with torn paper effects, 4-tier fiber rate board, and 3D Red Jacket Boy pointing at package signboards.",
    badgeColor: "bg-sky-500 text-white",
    accentColor: "border-sky-500",
  },
  {
    id: "modern-glass",
    name: "Modern Glass (Luxury Dark)",
    category: "Modern / Tech",
    description: "Ultra-sleek dark theme with frosted glassmorphism, luminous glow lights, and clean typography.",
    badgeColor: "bg-purple-600 text-white",
    accentColor: "border-purple-500",
  },
  {
    id: "vibrant-retail",
    name: "Vibrant Retail (Crisp Light)",
    category: "Public Retail",
    description: "High-contrast daylight-optimized white design with bold colorful badges and quick-tap cards.",
    badgeColor: "bg-blue-600 text-white",
    accentColor: "border-blue-500",
  },
  {
    id: "hospitality-clean",
    name: "Hospitality Clean (Hotel & Lounge)",
    category: "Hospitality",
    description: "Sophisticated navy/slate minimalist aesthetic designed for luxury hotels, cafes, and executive guest lounges.",
    badgeColor: "bg-slate-700 text-slate-200",
    accentColor: "border-slate-600",
  },
  {
    id: "cyberpunk-neon",
    name: "Cyberpunk Neon (Electric Cyber)",
    category: "Gaming & Youth",
    description: "Midnight black background with glowing electric cyan and magenta neon accents for cybercafes and venues.",
    badgeColor: "bg-cyan-500 text-black",
    accentColor: "border-cyan-500",
  },
  ...PALETTE_PRESETS.map(({ badgeColor, accentColor, ...preset }) => paletteThemeMeta(preset, { badgeColor, accentColor })),
];

const PALETTE_COMPONENTS = Object.fromEntries(PALETTE_PRESETS.map((p) => [p.id, createPaletteTheme(p)])) as Record<PaletteThemeId, ComponentType<CaptiveThemeProps>>;

export const THEME_COMPONENTS: Record<ThemeId, ComponentType<CaptiveThemeProps>> = {
  "mashuphost-clean": MashupHostCleanTheme,
  "gold-energy": GoldEnergyTheme,
  "suntech-blue": SuntechBlueTheme,
  "modern-glass": ModernGlassTheme,
  "vibrant-retail": VibrantRetailTheme,
  "hospitality-clean": HospitalityCleanTheme,
  "cyberpunk-neon": CyberpunkNeonTheme,
  ...PALETTE_COMPONENTS,
};

export function getThemeComponent(themeId?: string | null): ComponentType<CaptiveThemeProps> {
  if (themeId && themeId in THEME_COMPONENTS) {
    return THEME_COMPONENTS[themeId as ThemeId];
  }
  return MashupHostCleanTheme;
}

export function getThemeMeta(themeId?: string | null): ThemeMeta {
  return THEME_CATALOG.find((t) => t.id === themeId) ?? THEME_CATALOG[0]!;
}
