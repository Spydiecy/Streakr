// Maintenance: delete rooms by exact name, plus their leaderboard subcollection.
//
// Used to clear rooms created by automated UI test runs. Prints what it keeps
// as well as what it removes, so an accidental over-match is obvious.
//
//   node scripts/purge-test-rooms.mjs "Timing" "Testnet Degens"

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node scripts/purge-test-rooms.mjs "Room Name" ["Another Name"]');
  process.exit(1);
}

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const all = await db.collection("rooms").get();
console.log(`scanning ${all.size} room(s); targets: ${targets.join(", ")}\n`);

let removed = 0;
for (const doc of all.docs) {
  const name = doc.data().name;
  if (!targets.includes(name)) {
    console.log(`  keep    ${name}`);
    continue;
  }
  const entries = await db.collection("leaderboard").doc(doc.id).collection("entries").get();
  for (const e of entries.docs) await e.ref.delete();
  await db.collection("leaderboard").doc(doc.id).delete().catch(() => {});
  await doc.ref.delete();
  removed++;
  console.log(`  DELETE  ${name} (${doc.id})`);
}

console.log(`\nremoved ${removed} room(s)`);
process.exit(0);
