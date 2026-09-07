#!/usr/bin/env node
/**
 * Moves exported assets out of `dist/assets/node_modules/**` and rewrites the
 * URLs that point at them.
 *
 * Why: `expo export` mirrors an asset's source path into the output, so a font
 * that lives in `node_modules/@expo/vector-icons/...` is emitted to
 * `dist/assets/node_modules/@expo/vector-icons/...`. The Vercel CLI strips any
 * path containing a `node_modules` segment from a static upload, so every one
 * of those files 404s in production — icon fonts render as blank boxes and the
 * failed font fetch surfaces as an unhandled "NetworkError".
 *
 * Nothing in the bundle computes these URLs at runtime; each one is emitted as
 * a literal string module (`module.exports = "/assets/node_modules/..."`), so a
 * plain textual rewrite is sufficient and complete.
 *
 * Run after `expo export`, before deploying.
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] ?? "dist");
const FROM_DIR = path.join(DIST, "assets", "node_modules");
const TO_DIR = path.join(DIST, "assets", "vendor");
const FROM_URL = "assets/node_modules/";
const TO_URL = "assets/vendor/";

if (!fs.existsSync(DIST)) {
  console.error(`[relocate-vendor-assets] no such directory: ${DIST}`);
  process.exit(1);
}

if (!fs.existsSync(FROM_DIR)) {
  console.log("[relocate-vendor-assets] nothing to relocate (no assets/node_modules)");
  process.exit(0);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

// 1. move the files, preserving the subtree below node_modules/
const moved = walk(FROM_DIR);
for (const src of moved) {
  const dest = path.join(TO_DIR, path.relative(FROM_DIR, src));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}
fs.rmSync(FROM_DIR, { recursive: true, force: true });
console.log(`[relocate-vendor-assets] moved ${moved.length} file(s) -> assets/vendor/`);

// 2. rewrite every reference to them
let patchedFiles = 0;
let patchedRefs = 0;
for (const file of walk(DIST)) {
  if (!/\.(js|css|html|json|map)$/.test(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  if (!before.includes(FROM_URL)) continue;
  const hits = before.split(FROM_URL).length - 1;
  fs.writeFileSync(file, before.split(FROM_URL).join(TO_URL));
  patchedFiles++;
  patchedRefs += hits;
  console.log(`[relocate-vendor-assets]   ${hits} ref(s) in ${path.relative(DIST, file)}`);
}
console.log(`[relocate-vendor-assets] rewrote ${patchedRefs} reference(s) across ${patchedFiles} file(s)`);

// 3. fail loudly if anything still points into node_modules
const stragglers = walk(DIST).filter(
  (f) => /\.(js|css|html|json)$/.test(f) && fs.readFileSync(f, "utf8").includes(FROM_URL),
);
if (stragglers.length) {
  console.error("[relocate-vendor-assets] references remain in:", stragglers);
  process.exit(1);
}

// 4. confirm every rewritten URL resolves to a real file
const missing = [];
for (const file of walk(DIST)) {
  if (!/\.(js|css|html)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/["'(]\/(assets\/vendor\/[^"')]+)["')]/g)) {
    if (!fs.existsSync(path.join(DIST, m[1]))) missing.push(m[1]);
  }
}
if (missing.length) {
  console.error("[relocate-vendor-assets] dangling URLs:", [...new Set(missing)]);
  process.exit(1);
}
console.log("[relocate-vendor-assets] ok — all vendor asset URLs resolve");
