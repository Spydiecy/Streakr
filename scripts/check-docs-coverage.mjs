// Is every script and module on disk actually mentioned in the docs?
//
// The README's repo tree and command blocks are the only map anyone has. A script
// that exists but is documented nowhere is invisible — which for a diagnostic tool
// means the next person hits the same problem and writes it again.
//
// Complements check-docs.mjs, which checks structure rather than coverage.
//
//   node scripts/check-docs-coverage.mjs

import fs from "node:fs";
import path from "node:path";

const DOCS = ["README.md", "DEMO.md", "FEEDBACK.md", "app/e2e/README.md", "backend/lambda/DEPLOY.md"];
const prose = DOCS.filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

/**
 * Directories whose every file should be findable in the docs.
 *
 * Only places where a file IS a tool. An undocumented script is genuinely lost —
 * the next person hits the same problem and writes it again. Deliberately NOT
 * app/src/lib: the README's tree is a summary of the modules worth calling out,
 * and listing all 30 would bury the ones that matter.
 */
const WATCHED = [
  "backend/lambda/scripts",
  "app/e2e",
  "app/e2e/tools",
  "app/scripts",
  "scripts",
  "backend/lambda/src/handlers",
];

/** lib.mjs is shared helpers, not a check; index/types are structural. */
const SKIP = new Set(["lib.mjs", "index.ts", "types.ts"]);

let missing = 0;
let checked = 0;

for (const dir of WATCHED) {
  if (!fs.existsSync(dir)) continue;
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(mjs|ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts"))
    .map((e) => e.name);

  const undocumented = [];
  for (const name of files) {
    if (SKIP.has(name)) continue;
    checked++;
    // Match the bare filename; the docs reference scripts by name, not full path.
    if (!prose.includes(name)) undocumented.push(name);
  }

  if (undocumented.length) {
    console.log(`\n${dir}`);
    for (const n of undocumented) console.log(`  UNDOCUMENTED  ${n}`);
    missing += undocumented.length;
  }
}

console.log(`\nchecked ${checked} file(s) across ${WATCHED.length} directories`);
console.log(`>>> ${missing === 0 ? "every file is mentioned in the docs" : `${missing} file(s) documented nowhere`}`);
process.exit(missing === 0 ? 0 : 1);
