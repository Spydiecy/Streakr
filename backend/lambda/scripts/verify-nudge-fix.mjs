// Prove the pre-lock nudge returns the room's own Telegram chat.
//
// The bug: the n8n workflow reads `telegramChatId` and falls back to the shared
// chat, but the handler never returned that field — so every reminder went to the
// fallback while settlements went per-room.
//
// Verifying it is awkward because the endpoint only reports rooms whose stored
// activeMarket pointer is STILL trading, and those pointers go stale as soon as the
// room's creator closes the screen. So this temporarily points a room at a live
// market, calls the real endpoint, checks the response, and puts the pointer back
// exactly as it was — including restoring "no pointer at all".
//
//   NUDGE_URL=… N8N_SHARED_SECRET=… npx tsx scripts/verify-nudge-fix.mjs

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const url = process.env.NUDGE_URL;
const secret = process.env.N8N_SHARED_SECRET;
if (!url) {
  console.error("set NUDGE_URL");
  process.exit(1);
}

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const { getNetwork, readSettlement } = await import("../src/chain.ts");

// A room with a linked chat is the whole point of the test.
const rooms = await db.collection("rooms").where("telegramChatId", "!=", null).get();
if (rooms.empty) {
  console.error("no room has a Telegram chat linked — nothing to verify");
  process.exit(1);
}
const roomDoc = rooms.docs[0];
const room = roomDoc.data();
console.log(`room "${room.name}"  chat ${room.telegramChatId}`);

const network = getNetwork();
let live = null;

// MARKET_ID lets a caller supply a known-live market, which is the reliable route:
// short cadences roll every few minutes, so anything found via recent calls has
// usually already resolved.
//   cd chain-integration && npx tsx scripts/list-cadences.ts   (to find one)
if (process.env.MARKET_ID) {
  const id = process.env.MARKET_ID;
  const s = await readSettlement(network, id);
  if (s.status !== "trading") {
    console.error(`MARKET_ID is ${s.status}, not trading — pick a live one`);
    process.exit(1);
  }
  live = { id, expiry: s.expiry, window: process.env.MARKET_WINDOW ?? "5m", symbol: process.env.MARKET_SYMBOL ?? "BTC" };
} else {
  // Fall back to walking recent calls' markets.
  const recent = await db.collection("calls").orderBy("createdAt", "desc").limit(40).get();
  const seen = new Set();
  for (const d of recent.docs) {
    const id = d.data().positionId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const s = await readSettlement(network, id);
      if (s.status === "trading" && s.expiry > Math.floor(Date.now() / 1000)) {
        live = { id, expiry: s.expiry, window: d.data().window, symbol: d.data().symbol };
        break;
      }
    } catch {
      /* ignore unreadable markets */
    }
  }
}

if (!live) {
  console.log(
    "\nno currently-trading market found. Get one with:\n" +
      "  cd chain-integration && npx tsx scripts/list-cadences.ts\n" +
      "then re-run with MARKET_ID=0x…",
  );
  process.exit(1);
}

const secondsLeft = live.expiry - Math.floor(Date.now() / 1000);
console.log(`live market ${live.symbol} ${live.window}  ${secondsLeft}s left`);

const original = room.activeMarket ?? null;
console.log(`\noriginal pointer: ${original ? `${original.symbol} ${original.window}` : "(none)"}`);

try {
  await roomDoc.ref.update({
    activeMarket: {
      symbol: live.symbol,
      window: live.window,
      positionMarketId: live.id,
    },
  });
  console.log("pointer temporarily set to the live market");

  const res = await fetch(`${url}?withinSeconds=${secondsLeft + 60}`, {
    headers: secret ? { "x-streakr-secret": secret } : {},
  });
  const body = await res.json();
  console.log(`\nHTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2).slice(0, 700));

  const mine = (body.nudges ?? []).find((n) => n.roomId === roomDoc.id);
  if (!mine) {
    console.log("\n*** the room did not appear in the response ***");
    process.exitCode = 1;
  } else if (mine.telegramChatId === String(room.telegramChatId)) {
    console.log(`\n>>> ok — nudge carries the room's own chat (${mine.telegramChatId})`);
    console.log("    n8n will post the reminder where that room's results go");
  } else {
    console.log(`\n*** telegramChatId missing or wrong: ${mine.telegramChatId} ***`);
    process.exitCode = 1;
  }
} finally {
  // Put it back exactly as found, including the absent case.
  const { FieldValue } = await import("firebase-admin/firestore");
  await roomDoc.ref.update({ activeMarket: original ?? FieldValue.delete() });
  console.log("\npointer restored to its original value");
}
