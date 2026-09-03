// Zips each dist/<handler>/ folder into deploy/<handler>.zip — the exact
// file to upload via the Lambda console's "Upload from -> .zip file" button.
// Requires the `zip` CLI (preinstalled on macOS/Linux).

import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const handlers = ["pollPendingCalls", "preLockNudge", "sentiment", "renderResultCard"];

mkdirSync("deploy", { recursive: true });

for (const name of handlers) {
  const distDir = path.join("dist", name);
  if (!existsSync(distDir)) {
    console.error(`✗ ${distDir} does not exist — run "node build.mjs" first.`);
    process.exit(1);
  }
  const zipPath = path.join("deploy", `${name}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  // -j: junk the path (index.js sits at the zip root, which is what Lambda
  // expects for a handler named "index.handler").
  execSync(`zip -j "${zipPath}" "${path.join(distDir, "index.js")}"`, { stdio: "inherit" });
  console.log(`✓ deploy/${name}.zip`);
}

console.log("\nAll zips ready in backend/lambda/deploy/. Upload each via the Lambda console (see DEPLOY.md).");
