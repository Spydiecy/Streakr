// Bundles each Lambda handler into a single self-contained CommonJS file
// under dist/<handler>/index.js — every dependency inlined, so the ONLY
// thing you need to zip and upload per function is that one folder (no
// node_modules, no multi-file layout to get wrong in the console's zip
// upload UI).
//
//   node build.mjs        # bundles all four handlers into dist/<name>/index.js
//
// Then `npm run package` (or zip.mjs directly) zips each dist/<name>/
// folder into deploy/<name>.zip, ready to upload via Lambda console's
// "Upload from -> .zip file" button.

import { build } from "esbuild";
import { mkdirSync } from "node:fs";

const handlers = ["pollPendingCalls", "preLockNudge", "sentiment", "renderResultCard", "faucet"];

mkdirSync("dist", { recursive: true });

for (const name of handlers) {
  await build({
    entryPoints: [`src/handlers/${name}.ts`],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: `dist/${name}/index.js`,
    // firebase-admin + @somnia-chain/markets-sdk + viem all bundle cleanly —
    // none of them ship native (.node) binaries, so a full bundle (no
    // external deps) keeps the zip a single flat file per function.
    minify: false,
    sourcemap: false,
    logLevel: "info",
  });
  console.log(`✓ bundled ${name} -> dist/${name}/index.js`);
}

console.log("\nAll handlers bundled. Run `node zip.mjs` (or `npm run package`) to produce upload-ready zips in deploy/.");
