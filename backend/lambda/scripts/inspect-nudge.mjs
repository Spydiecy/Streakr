// Why is the pre-lock nudge returning nothing?
//
// The nudge only considers a room whose stored `activeMarket.positionMarketId` is
// STILL trading and expiring within the requested window. That pointer is written
// by the room screen while the room's CREATOR has it open, so it goes stale as soon
// as they leave — and on a short cadence it goes stale fast: a 5m market is
// resolved five minutes later. So a room can look permanently "nothing to nudge"
// while live markets exist, because the pointer is the limiting factor, not the
// venue.
//
// This reports the pointer AND the market's real on-chain state, which is the
// distinction the endpoint's empty response hides.
//
//   npx tsx scripts/inspect-nudge.mjs [withinSeconds]

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const within = Number(process.argv[2] ?? 120);

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// Same reads the handler uses, so this can't disagree with it.
const { getNetwork, readSettlement } = await import("../src/chain.ts");
const network = getNetwork();

const rooms = await db.collection("rooms").get();
const now = Math.floor(Date.now() / 1000);
console.log(`rooms ${rooms.size}   withinSeconds=${within}   now=${now}\n`);

let wouldNudge = 0;

for (const doc of rooms.docs) {
  const r = doc.data();
  console.log(`${r.name}  (${doc.id})`);
  console.log(`  telegram chat : ${r.telegramChatId ?? "(unlinked — nudge falls back to the default chat)"}`);

  const am = r.activeMarket;
  if (!am?.positionMarketId) {
    console.log(`  activeMarket  : ${am ? `${am.symbol} ${am.window} but no positionMarketId` : "(none)"}`);
    console.log("  -> SKIPPED: nothing to read\n");
    continue;
  }

  console.log(`  activeMarket  : ${am.symbol} ${am.window}  ${am.positionMarketId.slice(0, 18)}…`);
  try {
    const s = await readSettlement(network, am.positionMarketId);
    const left = s.expiry - now;
    console.log(`  on-chain      : status=${s.status}  expiry=${s.expiry}  ${left > 0 ? `${left}s left` : `expired ${-left}s ago`}`);
    if (s.status !== "trading") {
      console.log(`  -> SKIPPED: pointer is stale (market already ${s.status})\n`);
    } else if (left <= 0 || left > within) {
      console.log(`  -> SKIPPED: ${left}s left is outside the ${within}s nudge window\n`);
    } else {
      wouldNudge++;
      console.log(`  -> WOULD NUDGE: ${left}s left\n`);
    }
  } catch (e) {
    console.log(`  on-chain      : read failed — ${String(e.message ?? e).slice(0, 80)}\n`);
  }
}

console.log(`${wouldNudge} room(s) would produce a nudge right now.`);
if (wouldNudge === 0) {
  console.log(
    "\nEmpty is expected unless a room's creator has it open on a window that closes\n" +
      `within ${within}s. That is the nudge's design limit, not a fault: it reminds\n` +
      "people about the window the room was last pointed at.",
  );
}
process.exit(0);
