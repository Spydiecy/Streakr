// Switching asset or window must never show the previous market's data, and the
// window chips must not flicker out.
//
// Both bugs were reported together and shared a cause worth remembering.
// `listLiveMarkets` takes seconds, and the toggles plus a 15s poll can each
// start one, so an older response could resolve last — the card then rendered an
// ETH heading over BTC's label and BTC's prices, which reads as "the odds never
// change when I switch". Separately the chips came and went because a cadence
// label was matched exactly while the indexer reports it with a second or two of
// jitter.
//
//   node e2e/switch.mjs [url]
import {
  open, wait, tap, signIn, createRoom, marketCard, windowChips, reportProblems,
} from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const { browser, page, problems } = await open({ url });

const show = (c) =>
  `state=${c.state} big=${c.big ?? "-"} label=${c.label ?? "-"} quotes=[${c.quotes.join(",")}] left=${c.left ?? "-"}`;

await signIn(page, "SwitchProbe");
const room = `SwitchProbe${Math.floor(Math.random() * 900 + 100)}`;
console.log(`creating room ${room}…`);
await createRoom(page, room);

console.log("\n=== initial (BTC) ===");
console.log("  " + show(await marketCard(page)));
console.log("  chips:", await windowChips(page));

console.log("\n=== switch to ETH — the card must never show BTC data ===");
await tap(page, "Ξ ETH");
let leaks = 0;
for (let i = 0; i < 12; i++) {
  await wait(1500);
  const c = await marketCard(page);
  const leak = c.big === "BTC" || (c.label && c.label.startsWith("BTC"));
  if (leak) leaks++;
  console.log(`  t+${((i + 1) * 1.5).toFixed(1)}s ${leak ? "*** BTC LEAK ***" : "ok  "} ${show(c)}`);
}
console.log(`  >>> BTC leaks while ETH selected: ${leaks}${leaks ? "  *** BUG ***" : ""}`);

const chips = await windowChips(page);
console.log(`\n=== window switches (available: ${chips.join(",") || "none"}) ===`);
for (const w of chips) {
  await tap(page, w);
  let c = null;
  for (let i = 0; i < 14; i++) {
    await wait(2000);
    c = await marketCard(page);
    if (c.state === "market" && c.label?.endsWith(` ${w}`)) break;
    if (c.state === "no-window") break;
  }
  const bad = c.state === "market" && c.label && !c.label.endsWith(` ${w}`);
  console.log(`  [${w}] ${bad ? "*** LABEL MISMATCH ***" : "ok  "} ${show(c)}`);
}

console.log("\n=== chip stability across poll cycles (60s) ===");
const samples = [];
for (let i = 0; i < 12; i++) {
  await wait(5000);
  const c = (await windowChips(page)).join(",");
  samples.push(c);
  console.log(`  t+${(i + 1) * 5}s [${c}]`);
}
const firstNonEmpty = samples.findIndex((s) => s.length > 0);
const vanished = firstNonEmpty >= 0 && samples.slice(firstNonEmpty).some((s) => s.length === 0);
console.log(`  >>> chips vanished after appearing: ${vanished ? "YES *** BUG ***" : "no"}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(leaks === 0 && !vanished && failed === 0 ? 0 : 1);
