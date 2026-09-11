// Remove the data automated test runs left behind, and nothing else.
//
// Browser checks sign in as a fresh anonymous user and often create a room, so a
// day of runs leaves dozens of one-member rooms and probe accounts sitting in the
// public room list and on the global leaderboard. That's noise in front of anyone
// looking at the product.
//
// Deleting shared data is easy to get wrong, so this is deliberately conservative:
//
//   · probe accounts are matched by an explicit list of display-name prefixes the
//     checks actually use — never by "looks automated"
//   · a wallet-address display name (0x…) is NEVER a probe: that's a real visitor
//     who didn't type a name
//   · a room is NEVER deleted if it has a Telegram chat linked, regardless of its
//     name — that's someone's real room
//   · a room is never deleted if it still holds calls from a non-probe account
//   · dry run by default; pass --yes to actually delete
//
//   node scripts/purge-probe-data.mjs          # show what would go
//   node scripts/purge-probe-data.mjs --yes    # do it

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const commit = process.argv.includes("--yes");

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

/**
 * Display-name prefixes used by the browser checks and dev tools.
 *
 * Taken from the actual `signIn(page, "…")` calls in app/e2e rather than guessed —
 * an earlier version of this list guessed "ErrProbe" while errpath.mjs really
 * signs in as "ErrPath", so a dozen probe accounts were being reported as real:
 *
 *   grep -rhoE 'signIn\(page, *"[^"]+"' app/e2e/
 */
const PROBE_PREFIXES = [
  // current checks
  "Probe", "ErrProbe", "ErrPath", "SwitchProbe", "SwitchTest", "AlignProbe",
  "AlignAudit", "FullCall", "HistProbe", "ScrollProbe", "ShotProbe", "WindowProbe",
  "WinProbe", "FiveProbe", "FiveMin", "HttpProbe", "ClaimProbe",
  // earlier sessions / one-off diagnostics
  "PayoutProbe", "SheetProbe", "ChartProbe", "DbgProbe", "TimingProbe", "IndexProbe",
  "BookProbe", "TelegramProbe", "FeedProbe", "RoomFeed", "Diag",
];

/** Room-name prefixes the checks create rooms under. */
const PROBE_ROOM_PREFIXES = [...PROBE_PREFIXES, "Timing", "Testnet Degens"];

const isProbeName = (name, prefixes) => {
  const n = String(name ?? "").trim();
  // A wallet address is a real visitor who skipped the name field.
  if (/^0x/i.test(n)) return false;
  return prefixes.some((p) => n.toLowerCase().startsWith(p.toLowerCase()));
};

// ---------------------------------------------------------------- gather
const [usersSnap, roomsSnap, callsSnap] = await Promise.all([
  db.collection("users").get(),
  db.collection("rooms").get(),
  db.collection("calls").get(),
]);

const probeUids = new Set();
const keptUsers = [];
for (const d of usersSnap.docs) {
  const name = d.data().displayName;
  if (isProbeName(name, PROBE_PREFIXES)) probeUids.add(d.id);
  else keptUsers.push(name ?? d.id);
}

const callsByRoom = new Map();
for (const d of callsSnap.docs) {
  const c = d.data();
  if (!callsByRoom.has(c.roomId)) callsByRoom.set(c.roomId, []);
  callsByRoom.get(c.roomId).push({ id: d.id, uid: c.uid, ref: d.ref });
}

const roomsToDelete = [];
const roomsKept = [];
for (const d of roomsSnap.docs) {
  const r = d.data();
  const calls = callsByRoom.get(d.id) ?? [];
  const foreignCalls = calls.filter((c) => !probeUids.has(c.uid));

  let reason = null;
  if (r.telegramChatId) reason = "Telegram linked";
  else if (!isProbeName(r.name, PROBE_ROOM_PREFIXES)) reason = "not a probe name";
  else if (foreignCalls.length > 0) reason = `holds ${foreignCalls.length} call(s) from real accounts`;

  if (reason) roomsKept.push(`${r.name}  (${reason})`);
  else roomsToDelete.push({ id: d.id, name: r.name, calls });
}

const probeCalls = callsSnap.docs.filter((d) => probeUids.has(d.data().uid));

console.log(`users  ${usersSnap.size}  ->  ${probeUids.size} probe, ${usersSnap.size - probeUids.size} kept`);
console.log(`rooms  ${roomsSnap.size}  ->  ${roomsToDelete.length} to delete, ${roomsKept.length} kept`);
console.log(`calls  ${callsSnap.size}  ->  ${probeCalls.length} from probe accounts\n`);

console.log("KEEPING these rooms:");
for (const r of roomsKept) console.log(`  ${r}`);
console.log("\nKEEPING these accounts:");
for (const n of keptUsers) console.log(`  ${n}`);

console.log(`\nDELETING ${roomsToDelete.length} room(s):`);
for (const r of roomsToDelete) console.log(`  ${r.name}  (${r.calls.length} call(s))`);

if (!commit) {
  console.log("\n(dry run — nothing changed. pass --yes to delete)");
  process.exit(0);
}

// ---------------------------------------------------------------- delete
let deleted = { rooms: 0, calls: 0, users: 0, entries: 0 };

// Leaderboard entries first: an entry outranks nothing once its user is gone, but
// a leftover entry would keep a deleted probe on the board.
for (const uid of probeUids) {
  const boards = await db.collection("leaderboard").listDocuments();
  for (const b of boards) {
    const e = b.collection("entries").doc(uid);
    if ((await e.get()).exists) {
      await e.delete();
      deleted.entries++;
    }
  }
}

for (const d of probeCalls) {
  await d.ref.delete();
  deleted.calls++;
}

for (const r of roomsToDelete) {
  const entries = await db.collection("leaderboard").doc(r.id).collection("entries").get();
  for (const e of entries.docs) {
    await e.ref.delete();
    deleted.entries++;
  }
  await db.collection("leaderboard").doc(r.id).delete().catch(() => {});
  // Any remaining calls in a room being removed (all probe-owned by the checks above).
  for (const c of r.calls) {
    await c.ref.delete().catch(() => {});
    deleted.calls++;
  }
  await db.collection("rooms").doc(r.id).delete();
  deleted.rooms++;
}

for (const uid of probeUids) {
  await db.collection("users").doc(uid).delete();
  deleted.users++;
}

console.log(
  `\ndeleted: ${deleted.rooms} room(s), ${deleted.calls} call(s), ` +
    `${deleted.users} account(s), ${deleted.entries} leaderboard entr(ies)`,
);
