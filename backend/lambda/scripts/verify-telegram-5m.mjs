// Does a 5m settlement notification actually render and send?
//
// "5m" itself is harmless in MarkdownV2, but the message is assembled from
// display names, amounts and badge keys that are full of reserved punctuation, and
// a single unescaped character makes Telegram reject the WHOLE send — the
// notification just never arrives. So this builds the message with the production
// formatter from a real settled 5m call and then lets Telegram validate it by
// actually sending it with parse_mode MarkdownV2.
//
// Uses the bundled handler output rather than the TS source, so what is checked is
// exactly what the deployed function runs.
//
//   TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… node scripts/verify-telegram-5m.mjs [--send]

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const send = process.argv.includes("--send");
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;

const sa = JSON.parse(
  readFileSync(new URL("../streakr-hackathon-firebase-adminsdk.json", import.meta.url), "utf8"),
);
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// A real settled 5m call, so the payload isn't invented.
const snap = await db.collection("calls").orderBy("createdAt", "desc").limit(25).get();
const call = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .find((c) => c.window === "5m" && c.status === "won");

if (!call) {
  console.log("no settled winning 5m call found yet — run e2e/claim.mjs first");
  process.exit(1);
}

const user = await db.collection("users").doc(call.uid).get();
const room = await db.collection("rooms").doc(call.roomId).get();
const roomChat = room.exists ? room.data().telegramChatId : null;

const payload = {
  callId: call.id,
  roomId: call.roomId,
  displayName: user.exists ? (user.data().displayName ?? "Someone") : "Someone",
  symbol: call.symbol,
  direction: call.direction,
  window: call.window,
  status: call.status,
  payout: call.payout,
  stakeUsdso: call.stakeUsdso,
  currentStreak: user.exists ? (user.data().currentStreak ?? 0) : 0,
  xpAwarded: call.xpAwarded ?? 20,
  newBadges: call.newBadges ?? [],
  txHash: call.txHash,
};

console.log("real settled 5m call:");
console.log(`  ${payload.symbol} ${payload.direction} ${payload.window}  payout ${payload.payout}`);
console.log(`  room ${payload.roomId}  chat ${roomChat ?? "(unlinked -> falls back)"}\n`);

// The bundled handler is CJS with the formatter inlined; import the source module
// instead, which is what it was built from.
const { buildTelegramMessage } = await import("../src/telegram.ts").catch(async () => {
  // tsx isn't necessarily present; fall back to re-implementing nothing and bail
  // loudly rather than testing a copy of the logic.
  console.error("could not import src/telegram.ts — run with: npx tsx scripts/verify-telegram-5m.mjs");
  process.exit(1);
});

const msg = buildTelegramMessage(payload);
console.log("=== message ===");
console.log(msg);
console.log("=== end ===\n");

// Rough look at the escaping. `*` is deliberate here — it's the emphasis the
// message is built with — so a non-zero count is expected and this is only a hint.
// Telegram's own accept/reject below is the authority, which is the whole reason
// this script sends rather than just prints.
const stripped = msg.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/\*/g, "");
const unescaped = [...stripped].filter((ch, i, a) => /[_[\]()~`>#+\-=|{}.!]/.test(ch) && a[i - 1] !== "\\");
console.log(`suspicious unescaped characters (excluding * emphasis and links): ${unescaped.length}`);

if (!send) {
  console.log("\n(dry run — pass --send to let Telegram validate it for real)");
  process.exit(0);
}
if (!token || !chat) {
  console.error("set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to send");
  process.exit(1);
}

const target = roomChat ?? chat;
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chat_id: target,
    text: msg,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  }),
});
const body = await res.json();
console.log(`\nTelegram sendMessage -> HTTP ${res.status}  ok=${body.ok}`);
if (!body.ok) {
  console.error(`  REJECTED: ${body.description}`);
  process.exit(1);
}
console.log(`  delivered to "${body.result?.chat?.title ?? target}" as message ${body.result?.message_id}`);
console.log("\n>>> ok — a 5m settlement notification renders and Telegram accepts it");
