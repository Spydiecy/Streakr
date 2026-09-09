#!/usr/bin/env node
/**
 * Generates the app icon set from the same source the UI uses.
 *
 * The brand mark is the Ionicons "flame" glyph on Streakr's lime gradient — the
 * exact composition OnboardingScreen renders. Rather than trace it by hand, this
 * loads the real Ionicons TTF in headless Chrome and screenshots it, so the icon
 * cannot drift from the in-app mark.
 *
 * Chrome instead of a raster library because the glyph lives in a font: PIL
 * isn't installed, and node canvas bindings ship per-platform native binaries
 * (the same reason Result Cards are SVG, see backend/lambda/DEPLOY.md).
 *
 *   node scripts/generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const TTF = path.join(
  ROOT,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
);

// Ionicons "flame", read from the package's own glyphmap.
const GLYPH = String.fromCodePoint(0xf313);
const LIME_FROM = "#d4ff3f";
const LIME_TO = "#a8e600";
const INK = "#0a0b0c";

if (!fs.existsSync(TTF)) {
  console.error(`[icons] Ionicons.ttf not found at ${TTF}`);
  process.exit(1);
}
const fontBase64 = fs.readFileSync(TTF).toString("base64");

/**
 * @param size      output square size in px
 * @param radiusPct corner radius as a % of size (0 = square, for adaptive icons
 *                  where the launcher applies its own mask)
 * @param glyphPct  glyph height as a % of size
 * @param bg        "gradient" | "transparent" | "solid"
 */
const page$ = (size, { radiusPct, glyphPct, bg }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: Ionicons; src: url(data:font/ttf;base64,${fontBase64}) format("truetype"); }
  html, body { margin: 0; padding: 0; background: transparent; }
  .tile {
    width: ${size}px; height: ${size}px;
    border-radius: ${(size * radiusPct) / 100}px;
    display: flex; align-items: center; justify-content: center;
    ${
      bg === "gradient"
        ? `background: linear-gradient(135deg, ${LIME_FROM} 0%, ${LIME_TO} 100%);`
        : bg === "solid"
          ? `background: ${LIME_FROM};`
          : "background: transparent;"
    }
  }
  .glyph {
    font-family: Ionicons;
    font-size: ${(size * glyphPct) / 100}px;
    line-height: 1;
    color: ${bg === "transparent" ? INK : INK};
    /* The flame's ink sits slightly low in its em box; nudge it onto the
       optical centre so the mark doesn't look bottom-heavy. */
    transform: translateY(-1.5%);
  }
</style></head>
<body><div class="tile"><span class="glyph">${GLYPH}</span></div></body></html>`;

const targets = [
  // Expo app icon — full bleed, rounded by the OS on iOS.
  { file: "icon.png", size: 1024, radiusPct: 22, glyphPct: 52, bg: "gradient" },
  // Web favicon.
  { file: "favicon.png", size: 96, radiusPct: 22, glyphPct: 54, bg: "gradient" },
  // Splash — Expo tints the background itself, so this is the mark alone.
  { file: "splash-icon.png", size: 512, radiusPct: 22, glyphPct: 52, bg: "gradient" },
  // Android adaptive: foreground must be transparent with generous safe-area
  // padding (the launcher crops to a circle), background a flat fill.
  { file: "android-icon-foreground.png", size: 1024, radiusPct: 0, glyphPct: 40, bg: "transparent" },
  { file: "android-icon-background.png", size: 1024, radiusPct: 0, glyphPct: 0, bg: "solid" },
  { file: "android-icon-monochrome.png", size: 1024, radiusPct: 0, glyphPct: 40, bg: "transparent" },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();

for (const t of targets) {
  await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 });
  await page.setContent(page$(t.size, t), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$(".tile");
  const out = path.join(ASSETS, t.file);
  await el.screenshot({ path: out, omitBackground: t.bg === "transparent" });
  console.log(`[icons] ${t.file.padEnd(30)} ${t.size}x${t.size}  ${fs.statSync(out).size} bytes`);
}

await browser.close();
console.log("[icons] done — assets/ updated");
