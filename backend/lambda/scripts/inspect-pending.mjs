// Why is a call still pending?
//
// Answers the two questions that matter when a call sits in `pending` longer than
// its window: does the settlement poller consider it due, and has the market
// actually resolved on-chain? Those are different failures with the same symptom —
// a poller that skips the call looks identical to a market that hasn't settled.
//
//   node scripts/inspect-pending.mjs [limit]

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const limit = Number(process.argv[2] ?? 10);

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const now = Math.floor(Date.now() / 1000);
console.log(`now = ${now}  (${new Date(now * 1000).toISOString()})\n`);

// No orderBy: status+createdAt needs a composite index that isn't deployed, and
// sorting a handful of docs in memory is cheaper than adding one for a script.
const pending = await db.collection("calls").where("status", "==", "pending").get();

const docs = pending.docs
  .sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0))
  .slice(0, limit);

console.log(`pending calls: ${pending.size} (showing ${docs.length})\n`);

for (const doc of docs) {
  const c = doc.data();
  const closes = Number(c.closesAtSec ?? 0);
  const overdue = closes > 0 ? now - closes : null;
  console.log(`${doc.id}`);
  console.log(`  ${c.symbol} ${c.direction} ${c.window}   stake ${c.stakeUsdso}   uid ${String(c.uid).slice(0, 10)}`);
  console.log(`  marketId    : ${c.marketId ?? "(missing)"}`);
  console.log(`  positionId  : ${c.positionId ?? "(missing)"}`);
  console.log(`  closesAtSec : ${closes || "(missing)"}${
    overdue === null ? "" : overdue > 0 ? `   OVERDUE by ${overdue}s` : `   ${-overdue}s to go`
  }`);
  console.log(`  createdAt   : ${c.createdAt?.toDate?.().toISOString() ?? c.createdAt}`);
  console.log(`  roomId      : ${c.roomId}`);
  console.log("");
}
