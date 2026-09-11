// Structural checks on the markdown docs.
//
// The diagrams are the part of the README most likely to break silently: an
// unbalanced fence swallows the rest of the file, and a <details> without a blank
// line after </summary> makes GitHub render the markdown inside it as literal
// text. Neither shows up in a diff review.
//
//   node scripts/check-docs.mjs [file…]

import fs from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) files.push("README.md", "DEMO.md", "FEEDBACK.md");

let problems = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: MISSING`);
    problems++;
    continue;
  }
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");

  let fence = null;
  let fences = 0;
  const byLang = {};
  const suspect = [];

  lines.forEach((l, i) => {
    const m = l.match(/^```(\w*)\s*$/);
    if (!m) return;
    const lang = m[1];
    if (fence === null) {
      fence = lang || "plain";
      fences++;
      byLang[fence] = (byLang[fence] ?? 0) + 1;
    } else {
      // A closing fence is bare. A language here means the previous block never
      // closed, and everything after it is being treated as code.
      if (lang) suspect.push(`line ${i + 1}: inside "${fence}" but saw a fence opening "${lang}"`);
      fence = null;
    }
  });

  // Tags inside a fenced block are text, not markup — this README's own repo tree
  // contains the literal string "<details>" while describing this script, which an
  // unfiltered count reported as an unclosed tag.
  const outsideFences = [];
  {
    let inFence = false;
    lines.forEach((l, i) => {
      if (/^```/.test(l)) { inFence = !inFence; return; }
      if (!inFence) outsideFences.push({ line: i + 1, text: l });
    });
  }

  const open = outsideFences.filter((l) => /<details>/.test(l.text)).length;
  const close = outsideFences.filter((l) => /<\/details>/.test(l.text)).length;

  // A count mismatch alone sends you scrolling. Track the nesting and name the
  // line of the tag that never closed.
  const openStack = [];
  const strayClose = [];
  for (const { line, text } of outsideFences) {
    if (/<details>/.test(text)) openStack.push(line);
    if (/<\/details>/.test(text)) {
      if (openStack.length) openStack.pop();
      else strayClose.push(line);
    }
  }

  // GitHub only parses markdown inside <details> when a blank line follows
  // </summary>. Without it, a fenced diagram renders as literal text.
  const noBlank = [];
  for (const { line, text } of outsideFences) {
    if (!/<\/summary>/.test(text)) continue;
    const next = lines[line]; // lines is 0-indexed, so this is the following line
    if (next !== undefined && next.trim() !== "") noBlank.push(`line ${line + 1}`);
  }

  const langs = Object.entries(byLang).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`\n${file}`);
  console.log(`  fenced blocks ${fences}   (${langs})`);

  const fail = (msg) => { console.log(`  FAIL ${msg}`); problems++; };
  const ok = (msg) => console.log(`  ok   ${msg}`);

  fence === null ? ok("every fence closed") : fail(`unterminated "${fence}" fence`);
  suspect.length === 0 ? ok("no nested fence openings") : fail(`suspect fences\n       ${suspect.join("\n       ")}`);
  if (open === close && openStack.length === 0 && strayClose.length === 0) {
    ok(`<details> balanced (${open})`);
  } else {
    const detail = [
      openStack.length ? `unclosed <details> opened at line ${openStack.join(", ")}` : null,
      strayClose.length ? `</details> with no opener at line ${strayClose.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    fail(`<details> ${open} vs </details> ${close}${detail ? ` — ${detail}` : ""}`);
  }
  noBlank.length === 0
    ? ok("blank line after every </summary>")
    : fail(`markdown inside <details> will render literally at ${noBlank.join(", ")}`);
}

console.log(`\n>>> ${problems === 0 ? "docs structurally ok" : `${problems} problem(s)`}`);
process.exit(problems === 0 ? 0 : 1);
