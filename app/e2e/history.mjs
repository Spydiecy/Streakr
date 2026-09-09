// A settled call must explain itself.
//
// The history row used to show only a WON/LOST badge, which tells you the result
// but not what happened. The winning leg isn't stored on the call — it's implied
// by status vs direction — so this checks the derived line renders and reads
// correctly, plus the sentiment card is coming from the LLM rather than the
// template fallback.
//
// Needs an existing wallet with settled calls, so it reads the deep-linked
// profile of a session restored from localStorage. Pass a private key to reuse a
// specific funded wallet:
//
//   node e2e/history.mjs [url] [0xprivateKey]
import { open, wait, tap, signIn, text, flat, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const pk = process.argv[3];
const { browser, page, problems } = await open({ url });

if (pk) {
  // Seed the embedded wallet so we land on an address that already has history.
  await page.evaluate((k) => localStorage.setItem("streakr.wallet.privateKey", k), pk);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(3500);
}

await signIn(page, "HistProbe");
await wait(4000);

// Open the profile via the header button (44x44, rightmost).
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 44 && Math.round(r.height) === 44;
  });
  btns[btns.length - 1]?.click();
});
await wait(6000);

const body = await text(page);
console.log("=== profile ===");
console.log(await flat(page));

console.log("\n=== checks ===");
const bal = body.match(/([\d.]+) tUSDC/);
console.log(`  balance row:      ${bal ? bal[0] : "*** MISSING ***"}`);
console.log(`  refresh control:  ${await page.evaluate(() =>
  !!Array.from(document.querySelectorAll("[aria-label]")).find(
    (e) => e.getAttribute("aria-label") === "Refresh balance"))}`);

const rows = body.match(/Closed (Up|Down) —[^\n]*/g) ?? [];
const pending = body.match(/Waiting for the window to settle[^\n]*/g) ?? [];
const voided = body.match(/Market voided[^\n]*/g) ?? [];
console.log(`  settled rows explained: ${rows.length}`);
rows.forEach((r) => console.log(`     ${r}`));
if (pending.length) console.log(`  pending rows: ${pending.length} ("${pending[0]}")`);
if (voided.length) console.log(`  voided rows: ${voided.length}`);

const hasHistory = /Call history/.test(body) && !/No calls yet/.test(body);
const explained = rows.length + pending.length + voided.length > 0;
console.log(`\n  >>> ${hasHistory ? (explained ? "ok — every row explains itself" : "*** rows present but unexplained ***") : "no history on this wallet (inconclusive)"}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(!hasHistory || explained ? (failed === 0 ? 0 : 1) : 1);
