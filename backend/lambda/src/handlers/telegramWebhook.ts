// telegramWebhook — Lambda Function URL handler. Telegram POSTs updates here.
//
// Links a Telegram group to a Streakr room, so a room's settlements notify that
// room's own chat instead of everything landing in one shared demo group.
//
// Flow:
//   1. Streakr shows the room's 6-character link code to its members
//   2. someone types `/link ABC123` in the group they want notified
//   3. Telegram POSTs that message here
//   4. this writes the group's chat id onto the matching room and confirms
//
// A webhook rather than polling `getUpdates`: polling needs a scheduler, holds an
// offset cursor, and breaks if anything else consumes the same feed. A webhook has
// none of that and is what Telegram recommends for exactly this.
//
// Set it once (Telegram remembers it):
//   curl "https://api.telegram.org/bot<token>/setWebhook?url=<function url>&secret_token=<secret>"

import { getDb } from "../firebaseAdmin";
import { jsonResponse, getHeader, type LambdaHttpEvent, type LambdaHttpResponse } from "../httpTypes";
import type { RoomDoc } from "../types";

const API = "https://api.telegram.org";

/** Telegram's own reserved-character rules; escape anything interpolated. */
function esc(s: string): string {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

async function reply(chatId: number | string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("telegramWebhook: reply failed", e);
  }
}

const HELP =
  "Send `/link CODE` here to point a Streakr room's results at this chat\\. " +
  "The code is on the room screen in the app\\.";

export const handler = async (event: LambdaHttpEvent): Promise<LambdaHttpResponse> => {
  // Telegram echoes a configured secret in this header. Without the check, anyone
  // who found the URL could forge updates and repoint any room's notifications.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && getHeader(event, "x-telegram-bot-api-secret-token") !== expected) {
    console.warn("telegramWebhook: rejected an update with a bad secret token");
    // 200 so Telegram doesn't retry a forged request.
    return jsonResponse(200, { ok: true });
  }

  let update: any;
  try {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    update = JSON.parse(raw ?? "{}");
  } catch {
    return jsonResponse(200, { ok: true });
  }

  const msg = update.message ?? update.edited_message ?? update.channel_post;
  const chat = msg?.chat;
  const text: string = msg?.text ?? "";
  if (!chat || !text) return jsonResponse(200, { ok: true });

  // Group commands often arrive addressed to the bot: "/link@streak_r_bot ABC123".
  const m = text.trim().match(/^\/(link|unlink|start|help)(?:@\w+)?\s*(\S+)?/i);
  if (!m) return jsonResponse(200, { ok: true });

  const command = m[1].toLowerCase();
  const arg = (m[2] ?? "").toUpperCase();
  const db = getDb();

  if (command === "start" || command === "help") {
    await reply(chat.id, HELP);
    return jsonResponse(200, { ok: true });
  }

  if (command === "unlink") {
    // Clear every room currently pointing here, so a group can always detach
    // itself without needing to know which room claimed it.
    const linked = await db.collection("rooms").where("telegramChatId", "==", String(chat.id)).get();
    await Promise.all(linked.docs.map((d) => d.ref.update({ telegramChatId: null })));
    await reply(
      chat.id,
      linked.empty
        ? "This chat isn't linked to a Streakr room\\."
        : `Unlinked ${linked.size} room${linked.size === 1 ? "" : "s"} from this chat\\.`,
    );
    return jsonResponse(200, { ok: true });
  }

  // /link
  if (!arg) {
    await reply(chat.id, HELP);
    return jsonResponse(200, { ok: true });
  }

  const found = await db.collection("rooms").where("linkCode", "==", arg).limit(1).get();
  if (found.empty) {
    await reply(chat.id, `No room found for code *${esc(arg)}*\\. Check the code on the room screen\\.`);
    return jsonResponse(200, { ok: true });
  }

  const roomRef = found.docs[0].ref;
  const room = found.docs[0].data() as RoomDoc;
  await roomRef.update({ telegramChatId: String(chat.id) });

  console.log(`telegramWebhook: linked room ${room.roomId} (${room.name}) to chat ${chat.id}`);
  await reply(
    chat.id,
    `Linked to *${esc(room.name)}*\\.\nSettled calls from that room will post here\\.`,
  );

  return jsonResponse(200, { ok: true });
};
