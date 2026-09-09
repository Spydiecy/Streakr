// The most recent calls with their settled outcome, for checking what a run
// actually produced.
//
//   node scripts/recent-calls.mjs [limit]

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const limit = Number(process.argv[2] ?? 10);

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collection("calls").orderBy("createdAt", "desc").limit(limit).get();
console.log(`showing ${snap.size} most recent call(s)\n`);

for (const doc of snap.docs) {
  const c = doc.data();
  const when = c.createdAt?.toDate?.().toISOString() ?? String(c.createdAt);
  console.log(
    `${when}  ${String(c.symbol).padEnd(3)} ${String(c.direction).padEnd(4)} ${String(c.window).padEnd(3)}` +
      `  stake ${String(c.stakeUsdso).padEnd(6)} ${String(c.status).toUpperCase().padEnd(7)}` +
      `  payout ${c.payout ?? "-"}`,
  );
  console.log(`    callId ${doc.id}   uid ${String(c.uid).slice(0, 12)}   position ${c.positionId ?? "-"}`);
}
