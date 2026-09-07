// Streakr design tokens.
//
// Visual language: electric-lime accent on near-black surfaces, generous
// corner radii, chunky pill CTAs with dark text on bright fills, and white
// panels used sparingly for high-contrast moments. Bright and playful, but
// the reading surfaces stay dark — this is an app people open to check a
// live market, so legibility on a phone at night wins over a bright canvas.

export const colors = {
  // ── Surfaces (layered, never one flat black) ──────────────────────────
  bg: "#08090a",
  bgRaised: "#101113",
  surface: "#141518",
  surfaceAlt: "#1b1d21",
  surfaceHigh: "#24262b",
  border: "#25272c",
  borderBright: "#33363d",

  // White panels — for the one thing on a screen that must dominate
  paper: "#ffffff",
  paperInk: "#0a0b0c",
  paperMuted: "#6b7280",

  // ── Text ──────────────────────────────────────────────────────────────
  text: "#fbfcfd",
  textMuted: "#9ba1ac",
  textFaint: "#61666f",
  onAccent: "#0d1400", // dark ink that sits on lime

  // ── Brand: electric lime ──────────────────────────────────────────────
  accent: "#c5f82a",
  accentDim: "#9ad018",
  accentDeep: "#5f8a0a",
  accentSoft: "#e6f9b4", // pastel panel fill
  accentGlow: "rgba(197, 248, 42, 0.4)",
  accentWash: "rgba(197, 248, 42, 0.13)",

  // ── Semantic ──────────────────────────────────────────────────────────
  up: "#c5f82a", // Up == brand lime, so a winning call feels on-brand
  upInk: "#0d1400",
  upWash: "rgba(197, 248, 42, 0.13)",
  down: "#ff6b4a",
  downInk: "#2a0d05",
  downWash: "rgba(255, 107, 74, 0.14)",
  downGlow: "rgba(255, 107, 74, 0.4)",
  neutral: "#8b93a1",
  neutralWash: "rgba(139, 147, 161, 0.14)",
  gold: "#ffc94d",
  goldWash: "rgba(255, 201, 77, 0.14)",
  coral: "#ff7a45", // discount/alert badges

  // ── Gradients ─────────────────────────────────────────────────────────
  gradAccent: ["#d4ff3f", "#a8e600"] as const,
  gradAccentDeep: ["#c5f82a", "#7fd42a"] as const,
  gradDown: ["#ff8360", "#f04d28"] as const,
  gradHero: ["#1c2b05", "#08090a"] as const,
  gradPaper: ["#ffffff", "#f1f4f6"] as const,
  gradGold: ["#ffe08a", "#ffc94d"] as const,
  gradInk: ["#1b1d21", "#141518"] as const,
};

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  xxl: 36,
  pill: 999,
};

export const spacing = (n: number) => n * 4;

export const font = {
  display: { fontSize: 40, fontWeight: "900" as const, letterSpacing: -1.2 },
  h1: { fontSize: 30, fontWeight: "900" as const, letterSpacing: -0.8 },
  h2: { fontSize: 23, fontWeight: "800" as const, letterSpacing: -0.4 },
  h3: { fontSize: 17, fontWeight: "800" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "500" as const },
  bodySm: { fontSize: 13, fontWeight: "500" as const },
  label: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 0.9 },
  mono: {
    fontSize: 15,
    fontWeight: "700" as const,
    fontVariant: ["tabular-nums"] as ("tabular-nums")[],
  },
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 22,
    elevation: 10,
  },
  lift: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 12,
  }),
};
