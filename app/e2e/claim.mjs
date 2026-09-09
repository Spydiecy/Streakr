// Winnings have to be redeemed, and that step has to actually move money.
//
// A resolved market does not pay out on its own. The winning outcome tokens stay
// in the wallet until they're burned for the collateral behind them, so a user
// could see "won 14.58 tUSDC" in the feed while their balance never changed.
// That was a real reported confusion, and the fix (a Claim action on the history
// row) can only be trusted if a claim is observed to raise the balance.
//
// The wallet has to be one this script controls, because claiming needs the
// user's key — the settlement poller has no access to it. So: generate a key,
// drive the browser with it, place calls, wait for the window to resolve, claim,
// and compare the collateral balance either side.
//
//   node e2e/claim.mjs [url] [callCount]
//
// Prints the key it generated so a run can be resumed against the same wallet:
//   node e2e/claim.mjs http://localhost:8899 0   # skip placing, just claim
import { open, wait, signIn, tap, tapBigButton, text, flat, reportProblems } from "./lib.mjs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { sendGas } from "./tools/gas.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const want = Number(process.argv[3] ?? 4);
const pk = process.env.CLAIM_PK ?? generatePrivateKey();
const account = privateKeyToAccount(pk);

const RPC = "https://api.infra.testnet.somnia.network";
// Shannon testnet collateral (tUSDC, 6 decimals) — matches
// NETWORKS.testnet.addresses.collateral in src/lib/chain.ts.
const USDC = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const DECIMALS = 6;

console.log("wallet:", account.address);
console.log("key   :", pk, "  (CLAIM_PK to resume)");

const pub = createPublicClient({ transport: http(RPC) });
const collateral = async () => {
  try {
    const raw = await pub.readContract({
      address: USDC,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [account.address],
    });
    return Number(formatUnits(raw, DECIMALS));
  } catch {
    return null;
  }
};

const { browser, page, problems } = await open({ url });
// Seed the embedded wallet before the app boots a fresh one.
await page.evaluate((k) => localStorage.setItem("streakr.wallet.privateKey", k), pk);
await page.reload({ waitUntil: "networkidle2" });
await wait(3500);

await signIn(page, "ClaimProbe");
console.log("\n1. signed in as", account.address.slice(0, 10));
console.log("   waiting for the faucet grant…");
await wait(25_000);
console.log("   collateral:", await collateral(), "tUSDC");

// The product faucet grants enough gas for about three writes. This run needs
// four (collateral approve, two orders, one redeem), so top up from the treasury.
// Harness-only — it does not exercise or depend on any app code path.
if (want > 0) {
  // Non-fatal: a transient RPC/DNS blip here shouldn't abandon a run that the
  // faucet grant alone may still be able to complete.
  try {
    const g = await sendGas(account.address, "0.4");
    console.log(`   harness gas top-up: ${g.status}, now ${g.writes} writes affordable`);
  } catch (e) {
    console.log(`   harness gas top-up failed (continuing): ${String(e).split("\n")[0].slice(0, 120)}`);
  }
}

// ------------------------------------------------------------- place the calls
//
// Both directions, deliberately. One of them has to win, so a claimable position
// is guaranteed rather than left to luck — and on the shortest window available,
// because the whole point is to reach settlement inside one run.
if (want > 0) {
  await tap(page, "test");
  await wait(9000);

  // Switching windows refetches, and the buttons read "no liquidity" until that
  // resolves — tapping during the gap silently does nothing. Wait for the card.
  const waitForMarket = async (label = "") => {
    for (let i = 0; i < 20; i++) {
      const t = await text(page);
      if (/LIVE/.test(t) && !/Reading live/.test(t)) return true;
      if (/No live/.test(t)) return false;
      await wait(2000);
    }
    console.log(`   market never finished loading ${label}`);
    return false;
  };

  // The room opens on whatever window it defaults to (1h), which would mean
  // waiting an hour for settlement. 15m is the shortest.
  console.log("\n2.0 selecting the 15m window");
  console.log("   selected:", await tap(page, "15m"));
  await waitForMarket("after selecting 15m");
  const before = await text(page);
  const left = (before.match(/(?:^|\n)([0-9]+[hm]?[: ][0-9]+[hm]?)\nleft/) || [])[1] ?? "?";
  const label = (before.match(/(BTC|ETH) (15m|1h|4h|1d)/) || [])[0] ?? "?";
  console.log(`   market: ${label}   time left: ${left}`);

  // SIDES lets a run top up a leg that failed previously, so both directions end
  // up held on the same market without re-placing the one that worked.
  const sides = (process.env.SIDES ?? "UP,DOWN").split(",").map((s) => s.trim().toUpperCase());
  for (let n = 0; n < Math.min(want, sides.length); n++) {
    const side = sides[n];
    console.log(`\n2.${n + 1} tapping ${side}`);
    if (!(await tapBigButton(page, side))) {
      console.log("   button not found — market may be locked");
      break;
    }
    await wait(6000);
    // Label must match CallSheet's PillButton exactly.
    if (!(await tapBigButton(page, "Sign & place call", 30, 120))) {
      console.log("   confirm button not found — sheet did not open");
      break;
    }
    let ok = false;
    for (let i = 0; i < 25; i++) {
      await wait(3000);
      const t = await text(page);
      if (/SETTLING|is on-chain|YOU WON|YOU LOST/i.test(t)) { ok = true; break; }
      if (/Nobody on the other side|Not enough|Window already|cancelled|Call failed/i.test(t)) break;
    }
    const t = await text(page);
    console.log(`   ${ok ? "placed" : "did not place"}: ${t.replace(/\n+/g, " | ").slice(0, 180)}`);
    // A placed call lands on the Result screen; "Back to room" resets the stack
    // to the room so the next call can be placed. The reset re-mounts the room
    // on its default window, so 15m has to be re-selected for the next call.
    await tap(page, "Back to room");
    await wait(4000);
    await waitForMarket("back in the room");
    // The reset re-mounts the room on its default window, so 15m has to be
    // re-selected — and waited for again.
    await tap(page, "15m");
    await waitForMarket("after re-selecting 15m");
  }
}

// ------------------------------------------------- profile: cap + claim button
console.log("\n3. opening profile");
// The profile button lives on the ROOM LIST header, not the room's, so a run that
// ends inside a room has to leave it first — otherwise the 44x44 lookup matches
// something on the room screen and the profile never opens.
//
// Reloading rather than hunting for the back control: the session is restored from
// localStorage and the app lands on the room list, which is deterministic. Tapping
// a header button identified only by its 40x40 box was not — it matched a
// different element and the run sat on the room screen waiting for a Claim button
// that is only ever rendered on the profile.
// Navigate, don't reload. Calls are keyed by Firebase uid, not by wallet address,
// and signing in again mints a NEW anonymous uid — so a reloaded run looks at an
// empty history and can never find the win it just placed. The session has to be
// kept alive for the whole run.
const onRoomList = async () => /new room/i.test(await text(page));
const tapLabel = (label) =>
  page.evaluate((label) => {
    const el = Array.from(document.querySelectorAll("[aria-label]")).find(
      (e) => e.getAttribute("aria-label") === label && !e.closest('[aria-hidden="true"]'),
    );
    if (!el) return false;
    el.click();
    return true;
  }, label);

for (let i = 0; i < 4 && !(await onRoomList()); i++) {
  console.log("   tapping back:", await tapLabel("Back to rooms"));
  await wait(4000);
}
console.log("   on room list:", await onRoomList());

await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
    if (e.closest('[aria-hidden="true"]')) return false;
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 44 && Math.round(r.height) === 44;
  });
  btns[btns.length - 1]?.click();
});
await wait(8000);
console.log("   on profile:", /call history/i.test(await text(page)));

const pt = await text(page);
console.log("   " + pt.replace(/\n+/g, " | ").slice(0, 400));

const caps = await page.evaluate(() =>
  Array.from(document.querySelectorAll("div"))
    .filter((el) => !el.closest('[aria-hidden="true"]'))
    .map((el) => parseInt(getComputedStyle(el).maxHeight, 10))
    .filter((h) => Number.isFinite(h) && h > 100 && h < 500),
);
const boxes = await page.evaluate(() =>
  Array.from(document.querySelectorAll("div"))
    .filter((el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      return el.scrollHeight > el.clientHeight + 1 && /auto|scroll|hidden/.test(getComputedStyle(el).overflowY) && r.height >= 40 && r.height <= 700;
    })
    .map((el) => ({ viewport: Math.round(el.getBoundingClientRect().height), content: el.scrollHeight })),
);
console.log(`\n   height caps: ${caps.length ? caps.map((c) => c + "px").join(", ") : "none"}`);
console.log(`   scrolling boxes: ${boxes.length ? boxes.map((b) => `${b.viewport}/${b.content}px`).join(", ") : "none"}`);

// ------------------------------------------------------------------- the claim
console.log("\n4. looking for a claimable win (waiting for the window to resolve)");
let claimed = false;
let before = null;

for (let i = 0; i < 40; i++) {
  const t = await text(page);
  // Match the button's real label. A loose /claim/i matched unrelated copy and
  // reported a claim was available when none was rendered.
  const hasClaim = /Claim [\d.]+ tUSDC/i.test(t);
  if (hasClaim) {
    before = await collateral();
    console.log(`   claim action present. collateral before: ${before} tUSDC`);
    // The row's button reads "Claim <amount>".
    const tapped = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll("*")).filter((e) => {
        if (e.closest('[aria-hidden="true"]')) return false;
        // The button carries a wallet glyph before the label, so its innerText is
        // "\uF10C\nClaim 14.58 tUSDC" — anchor to the LINE, not the start.
        if (!/(^|\n)Claim [\d.]+ tUSDC/i.test((e.innerText || "").trim())) return false;
        const r = e.getBoundingClientRect();
        return r.height > 10 && r.width > 30;
      });
      if (!c.length) return false;
      c.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      c[0].scrollIntoView({ block: "center" });
      c[0].click();
      return true;
    });
    console.log(`   tapped claim: ${tapped}`);
    if (tapped) {
      for (let j = 0; j < 25; j++) {
        await wait(3000);
        const after = await collateral();
        const s = await text(page);
        if (after !== null && before !== null && after > before + 0.000001) {
          console.log(`\n   >>> CLAIMED. collateral ${before} → ${after} tUSDC  (+${(after - before).toFixed(6)})`);
          claimed = true;
          break;
        }
        if (/claim failed|could not claim/i.test(s)) {
          console.log("   claim reported a failure:", s.replace(/\n+/g, " | ").slice(0, 200));
          break;
        }
      }
    }
    // Only stop once the claim has actually been exercised; a failed tap should
    // keep polling rather than end the run reporting nothing.
    if (claimed) break;
  }
  if (i === 0) console.log("   no claim yet — calls still pending. Polling…");
  await wait(30_000);
  // The history list is a live Firestore listener, so the row updates in place;
  // the screen only needs re-reading, not reloading.
}

console.log("\n=== outcome ===");
if (claimed) {
  console.log("  ok — redeeming a winning position increased the wallet's collateral");
} else {
  console.log("  no claim exercised (no settled win on this wallet within the wait)");
  console.log("  resume with:  CLAIM_PK=" + pk + " node e2e/claim.mjs " + url + " 0");
}

const failed = reportProblems(problems);
await browser.close();
process.exit(claimed && failed === 0 ? 0 : 1);
