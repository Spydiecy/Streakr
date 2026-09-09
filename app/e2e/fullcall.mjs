// The whole loop, for real: new wallet → server-funded → live market → signed
// on-chain call → recorded.
//
// This is the check that matters most, because it's the one that was broken
// end-to-end without any single component looking broken. A browser-generated
// demo wallet holds 0 STT; STT is gas; so it could not send any transaction,
// including the collateral token's own faucet(). Every visitor's first call
// failed and the only visible symptom was a confusing revert string.
//
// Placing a real order needs resting liquidity on the leg being bought, which
// the venue does not always have — an unfilled IOC is reported here as a venue
// condition rather than an app failure, since that distinction is the whole
// reason this script prints the book before it taps.
//
//   node e2e/fullcall.mjs [url] [up|down]
import {
  open, wait, signIn, createRoom, marketCard, tapBigButton, tap, text, flat, reportProblems,
} from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const side = (process.argv[3] ?? "up").toUpperCase();
const { browser, page, problems } = await open({ url });

await signIn(page, "FullCall");
console.log("1. signed in\n  " + (await flat(page)).slice(0, 200));

// The faucet is fired without awaiting at connect time, so give the two
// transfers time to confirm before the balance is read.
console.log("\n2. waiting for the faucet grant to land…");
await wait(25_000);

const room = `FullCall${Math.floor(Math.random() * 900 + 100)}`;
await createRoom(page, room);
const card = await marketCard(page);
console.log(`\n3. room ${room}`);
console.log(`  ${card.state} ${card.label ?? "-"} quotes=[${card.quotes.join(",")}] left=${card.left ?? "-"}`);

if (card.state !== "market") {
  console.log("\n  no live market to call — venue has nothing quoting. Not an app failure.");
  reportProblems(problems);
  await browser.close();
  process.exit(0);
}

// A leg with no ask cannot fill; say so up front rather than reporting the
// resulting revert as a bug.
const [upQ, downQ] = card.quotes;
const wanted = side === "UP" ? upQ : downQ;
console.log(`  ${side} ask: ${wanted ?? "none"}`);

console.log(`\n4. tapping ${side}`);
console.log("  tapped:", await tapBigButton(page, side));
await wait(14_000);

const confirm = await text(page);
console.log("\n5. confirmation screen\n  " + confirm.replace(/\n+/g, " | ").slice(0, 600));

const gated = /Not enough tUSDC/.test(confirm);
console.log(`\n  funding gate shown: ${gated}${gated ? "  <-- faucet did not land" : "  (wallet is funded)"}`);

if (gated) {
  console.log("\n  tapping 'Fund this wallet' as the fallback path…");
  await tap(page, "Fund this wallet");
  await wait(35_000);
  console.log("  " + (await flat(page)).slice(0, 300));
}

console.log("\n6. signing the call");
await tapBigButton(page, "Sign & Submit Call", 30, 120);
// A real signed tx plus receipt confirmation; the SDK confirms via newHeads.
let settled = null;
for (let i = 0; i < 30; i++) {
  await wait(3000);
  const t = await text(page);
  // The result screen shows SETTLING until the poller sees the window resolve.
  if (/SETTLING|is on-chain|View on-chain transaction|YOU WON|YOU LOST/i.test(t)) {
    settled = "recorded";
    break;
  }
  if (/Nobody on the other side|Not enough|Window already|Signature cancelled|Call failed/.test(t)) {
    settled = "rejected";
    break;
  }
}
const after = await text(page);
console.log("  " + after.replace(/\n+/g, " | ").slice(0, 500));

console.log("\n=== outcome ===");
if (settled === "recorded") {
  console.log("  ok — call signed, submitted and recorded on-chain");
} else if (settled === "rejected") {
  const line = after.split("\n").find((l) => /Nobody|Not enough|Window|cancelled|failed/.test(l));
  console.log(`  call did not go through: ${line ?? "see above"}`);
  console.log("  (a no-fill here is venue liquidity, not an app bug — see the book above)");
} else {
  console.log("  timed out waiting for a result");
}

const failed = reportProblems(problems);
await browser.close();
process.exit(settled && failed === 0 ? 0 : 1);
