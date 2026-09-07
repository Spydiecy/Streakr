#!/usr/bin/env node
/**
 * Post-export gate for the web bundle.
 *
 * Two failures have shipped silently before and both are caught here:
 *
 *  1. Stale env inlining. Metro inlines `process.env.EXPO_PUBLIC_*` at build
 *     time and caches the transform, so editing `.env` without `--clear`
 *     produces a bundle carrying the *previous* values with no warning. This
 *     asserts each configured value actually appears in the output.
 *
 *  2. Assets that 404 in production. `expo export` mirrors source paths into
 *     the output, and the Vercel CLI drops anything under a `node_modules`
 *     segment, so icon fonts vanish. This asserts nothing under
 *     `assets/node_modules/` survived and every asset URL resolves on disk.
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
const ENV_FILE = path.resolve(path.dirname(DIST), ".env");

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

if (!fs.existsSync(DIST)) {
  console.error(`[verify-web-build] no such directory: ${DIST}`);
  process.exit(1);
}

const all = walk(DIST);
const code = all.filter((f) => /\.(js|css|html)$/.test(f));
const haystack = code.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const problems = [];

// --- 1. inlined EXPO_PUBLIC_* values -----------------------------------------
if (fs.existsSync(ENV_FILE)) {
  const entries = fs
    .readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("EXPO_PUBLIC_") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "").trim()];
    })
    .filter(([, v]) => v.length > 6);

  console.log(`[verify-web-build] checking ${entries.length} EXPO_PUBLIC_* value(s) are inlined`);
  for (const [k, v] of entries) {
    const present = haystack.includes(v);
    console.log(`  ${present ? "ok  " : "MISS"} ${k}`);
    if (!present) problems.push(`${k} value is not present in the bundle (stale build? re-export with --clear)`);
  }
} else {
  console.log("[verify-web-build] no .env found, skipping env inlining check");
}

// --- 2. assets ---------------------------------------------------------------
const inNodeModules = all.filter((f) => f.includes(`${path.sep}assets${path.sep}node_modules${path.sep}`));
if (inNodeModules.length) {
  problems.push(
    `${inNodeModules.length} asset(s) still under assets/node_modules/ — these 404 on Vercel. Run scripts/relocate-vendor-assets.mjs`,
  );
}
if (haystack.includes("assets/node_modules/")) {
  problems.push("bundle still references assets/node_modules/ — run scripts/relocate-vendor-assets.mjs");
}

const missing = new Set();
for (const f of code) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/["'(]\/(assets\/[^"')\s]+)["')]/g)) {
    if (!fs.existsSync(path.join(DIST, m[1]))) missing.add(m[1]);
  }
}
if (missing.size) problems.push(`asset URL(s) with no file on disk: ${[...missing].join(", ")}`);

const fonts = all.filter((f) => f.endsWith(".ttf"));
console.log(`[verify-web-build] ${all.length} file(s), ${fonts.length} font(s), ${code.length} code file(s)`);

if (problems.length) {
  console.error("\n[verify-web-build] FAILED");
  problems.forEach((p) => console.error("  - " + p));
  process.exit(1);
}
console.log("[verify-web-build] ok");
