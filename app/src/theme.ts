// Streakr design tokens. A small, deliberate system rather than a big
// generic theme file — every value here is actually used somewhere in the
// app, tuned for a dark, high-contrast, "crypto trading app at night" feel
// that still reads as playful/social rather than sterile-fintech.

export const colors = {
  // Backgrounds — layered darks, not one flat black
  bg: "#05070a",
  bgElevated: "#0b0f16",
  surface: "#11151d",
  surfaceAlt: "#171c26",
  surfaceHigh: "#1e2430",
  border: "#242b38",
  borderStrong: "#323a4a",

  // Text
  text: "#f8fafc",
  textMuted: "#9aa5b5",
  textFaint: "#5b6577",

  // Brand
  primary: "#7c5cff",
  primaryDim: "#4c3a9e",
  primaryGlow: "rgba(124, 92, 255, 0.35)",
  secondary: "#22d3ee",

  // Semantic
  up: "#2fd47a",
  upDim: "#123424",
  upGlow: "rgba(47, 212, 122, 0.35)",
  down: "#ff5470",
  downDim: "#391320",
  downGlow: "rgba(255, 84, 112, 0.35)",
  voidColor: "#94a3b8",
  gold: "#ffc857",
  goldGlow: "rgba(255, 200, 87, 0.35)",

  // Gradients (as stop arrays for expo-linear-gradient)
  gradientPrimary: ["#7c5cff", "#5b3df0"] as const,
  gradientUp: ["#2fd47a", "#17b06a"] as const,
  gradientDown: ["#ff5470", "#e03158"] as const,
  gradientHero: ["#1a1030", "#05070a"] as const,
  gradientCard: ["#171c26", "#11151d"] as const,
  gradientGold: ["#ffe08a", "#ffc857"] as const,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = (n: number) => n * 4;

export const font = {
  h1: { fontSize: 34, fontWeight: "900" as const, letterSpacing: -0.5 },
  h2: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "500" as const },
  bodySm: { fontSize: 13, fontWeight: "500" as const },
  caption: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4 },
  numeric: { fontSize: 15, fontWeight: "700" as const, fontVariant: ["tabular-nums"] as ("tabular-nums")[] },
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 10,
  }),
  none: {
    shadowColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
};
