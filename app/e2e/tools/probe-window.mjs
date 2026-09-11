// Is a given window actually tradable in the app, end to end?
//
// Adding a cadence to the label map makes a chip appear; it does not prove the
// market behind it is real, priced, and callable. This selects the window in a
// fresh room and reports the card the user would see.
//
//   node e2e/tools/probe-window.mjs [url] [window]
import { open, wait, signIn, tap, typeInto, text, marketCard, reportProblems } from "../lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const want = process.argv[3] ?? "5m";

const { browser, page, problems } = await open({ url });

await signIn(page, "WindowProbe");
console.log("signed in, waiting for the faucet grant…");
await wait(22_000);

await tap(page, "New Room");
await wait(2500);
await typeInto(page, "Room name", `WinProbe${Math.floor(Math.random() * 900 + 100)}`);
await tap(page, "Create room");
for (let i = 0; i < 20; i++) {
  await wait(2000);
  if (/LIVE|No live/.test(await text(page))) break;
}

console.log(`\nselecting ${want}: ${await tap(page, want)}`);
// Switching windows refetches; the buttons read "no liquidity" until it lands.
for (let i = 0; i < 20; i++) {
  await wait(2000);
  const t = await text(page);
  if (/LIVE/.test(t) && !/Reading live/.test(t)) break;
}

const c = await marketCard(page);
const body = await text(page);

console.log(`\nmarket card on ${want}`);
console.log(`  state      : ${c.state}`);
console.log(`  label      : ${c.label ?? "-"}`);
console.log(`  time left  : ${c.left ?? "-"}`);
console.log(`  chances    : ${c.quotes.join(" / ") || "hidden (wide spread)"}`);
console.log(`  up button  : ${c.wins.up ?? "-"}`);
console.log(`  down button: ${c.wins.down ?? "-"}`);

const labelled = c.label === null ? false : c.label.endsWith(` ${want}`);
const tradable = /^win /.test(c.wins.up ?? "") || /^win /.test(c.wins.down ?? "");
console.log(`\n  card is on ${want}: ${labelled ? "yes" : `NO (shows "${c.label}")`}`);
console.log(`  at least one leg callable: ${tradable ? "yes" : "no — venue has nothing quoting that side"}`);
console.log(`  chart drawn: ${/\d+m|\d+h/.test(body) ? "yes" : "no"}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(labelled && failed === 0 ? 0 : 1);
