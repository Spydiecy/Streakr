// A call you just placed must appear in the ROOM, not only in your profile.
//
// It didn't before: the room rendered only the leaderboard, which is written
// server-side from settled results, so a pending call had nowhere to show up in
// the room it belonged to. Also checks the balance readout and the refresh
// control, since all three are what makes the room feel live.
//
//   node e2e/roomfeed.mjs [url] [up|down]
import {
  open, wait, signIn, createRoom, marketCard, tapBigButton, tap, text, flat, reportProblems,
} from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const side = (process.argv[3] ?? "down").toUpperCase();
const { browser, page, problems } = await open({ url });

await signIn(page, "FeedProbe");
console.log("1. room list");
const list = await text(page);
const balOnList = list.match(/([\d.]+) tUSDC/);
console.log(`  balance shown: ${balOnList ? balOnList[0] : "*** MISSING ***"}`);
console.log(`  refresh control: ${await page.evaluate(() =>
  !!Array.from(document.querySelectorAll("[aria-label]")).find((e) => e.getAttribute("aria-label") === "Refresh"))}`);

// Give the faucet grant time to land before reading a balance that matters.
await wait(22_000);
await tap(page, "Refresh");
await wait(4000);
const list2 = await text(page);
const bal2 = list2.match(/([\d.]+) tUSDC/);
console.log(`  balance after faucet + refresh: ${bal2 ? bal2[0] : "*** MISSING ***"}`);

const room = `FeedProbe${Math.floor(Math.random() * 900 + 100)}`;
await createRoom(page, room);
const card = await marketCard(page);
console.log(`\n2. room ${room}: ${card.label ?? "-"} quotes=[${card.quotes.join(",")}]`);

const before = await text(page);
console.log(`  room calls section present: ${/Room calls/i.test(before)}`);
console.log(`  empty state: ${/No calls in this room yet/i.test(before)}`);
console.log(`  refresh control: ${await page.evaluate(() =>
  !!Array.from(document.querySelectorAll("[aria-label]")).find((e) => e.getAttribute("aria-label") === "Refresh market"))}`);

const [upQ, downQ] = card.quotes;
const ask = side === "UP" ? upQ : downQ;
console.log(`\n3. ${side} ask: ${ask ?? "none"}`);
if (!ask || ask === "—") {
  console.log("  that leg has no liquidity — cannot place a call to test the feed");
  reportProblems(problems);
  await browser.close();
  process.exit(0);
}

await tapBigButton(page, side);
await wait(14_000);
await tapBigButton(page, "Sign & Submit Call", 30, 120);

let placed = false;
for (let i = 0; i < 25; i++) {
  await wait(3000);
  if (/SETTLING|is on-chain|YOU WON|YOU LOST/i.test(await text(page))) { placed = true; break; }
}
console.log(`  call placed: ${placed}`);
if (!placed) {
  console.log("  " + (await flat(page)).slice(-260));
  reportProblems(problems);
  await browser.close();
  process.exit(1);
}

console.log("\n4. back to the room — the call must be in the feed");
await tap(page, "Back to room");
await wait(9000);
const after = await text(page);
console.log("  " + after.replace(/\n+/g, " | ").slice(0, 460));

const inFeed = /Room calls[\s\S]*You[\s\S]*(BTC|ETH) (UP|DOWN)/i.test(after);
const stillEmpty = /No calls in this room yet/i.test(after);
console.log(`\n  >>> call visible in room feed: ${inFeed && !stillEmpty ? "YES" : "NO  *** BUG ***"}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(inFeed && !stillEmpty && failed === 0 ? 0 : 1);
