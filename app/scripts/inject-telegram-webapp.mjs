/**
 * Adds Telegram's Mini App script to the exported HTML shell.
 *
 * Why a post-export step rather than a template: modular HTML (`app/+html.tsx`)
 * is an Expo Router feature, and this app uses react-navigation directly, so
 * `expo export` generates the shell from its own template with no hook to
 * customise it. `public/` is copied verbatim and can't modify index.html either.
 * The build already post-processes `dist` (see relocate-vendor-assets.mjs), so
 * this fits the existing shape and stays out of Expo's way.
 *
 * The script must be a real `<script src>` in the document head and cannot be
 * bundled: it defines `window.Telegram.WebApp` synchronously, and Telegram's own
 * client expects it present on load. Importing it through Metro would evaluate it
 * after the bundle starts, which is too late for `ready()`/`expand()`.
 *
 * Loading it in a normal browser is harmless — it defines the namespace and
 * reports `platform: "unknown"`, which `isTelegramMiniApp()` treats as not
 * Telegram. So the same deployed URL serves both surfaces.
 *
 * Idempotent: safe to run twice, and asserts its own result so a silent failure
 * can't ship (the same reason verify-web-build.mjs exists).
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
const HTML = path.join(DIST, "index.html");
const SRC = "https://telegram.org/js/telegram-web-app.js";
const TAG = `<script src="${SRC}"></script>`;

if (!fs.existsSync(HTML)) {
  console.error(`[inject-telegram-webapp] no such file: ${HTML}`);
  process.exit(1);
}

let html = fs.readFileSync(HTML, "utf8");

if (html.includes(SRC)) {
  console.log("[inject-telegram-webapp] already present, nothing to do");
  process.exit(0);
}

if (!html.includes("</head>")) {
  console.error("[inject-telegram-webapp] no </head> in the exported shell — template changed?");
  process.exit(1);
}

// Last thing in <head>, so it is defined before the bundle's first line runs.
html = html.replace("</head>", `  ${TAG}\n  </head>`);
fs.writeFileSync(HTML, html);

// Assert rather than trust the replace.
const after = fs.readFileSync(HTML, "utf8");
const count = after.split(SRC).length - 1;
if (count !== 1) {
  console.error(`[inject-telegram-webapp] expected exactly 1 script tag, found ${count}`);
  process.exit(1);
}
if (after.indexOf(SRC) > after.indexOf("</head>")) {
  console.error("[inject-telegram-webapp] script landed outside <head>");
  process.exit(1);
}

console.log("[inject-telegram-webapp] ok — telegram-web-app.js added to <head>");
