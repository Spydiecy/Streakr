// Posting settlement results straight to Telegram from the Lambda.
//
// Why this exists alongside the n8n path
// --------------------------------------
// n8n is the richer option — visual workflow, easy to add steps, and the two
// exported workflows in /n8n-workflows cover both settlement notifications and
// pre-lock nudges. But it needs somewhere to run that stays reachable, and a
// notification that only works while a laptop is awake isn't a working feature.
//
// This is the same message with no hosting dependency: the poller already knows
// the outcome, and the Bot API is one HTTP call. Both paths are supported and
// they compose — set either, or both:
//
//   N8N_SETTLEMENT_WEBHOOK_URL   -> POST the payload to n8n
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID -> post directly (this file)
//
// Neither being set is also fine; settlement doesn't depend on notifications.

import type { SettlementNotifyPayload } from "./n8n";

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
}

/**
 * Which chat a room's results go to.
 *
 * A room that has linked its own Telegram group (via `/link CODE`, handled by
 * telegramWebhook) notifies that group. Anything unlinked falls back to
 * TELEGRAM_CHAT_ID, so a demo works with no setup while real rooms get their own
 * chat.
 */
export async function resolveChatId(roomId: string, lookupRoomChat: (roomId: string) => Promise<string | null>): Promise<string | null> {
  const linked = await lookupRoomChat(roomId).catch(() => null);
  return linked ?? process.env.TELEGRAM_CHAT_ID ?? null;
}

/** Telegram's MarkdownV2 reserves a lot of punctuation; escape it in dynamic text. */
function esc(s: string): string {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * The message body.
 *
 * Deliberately leads with the person and the outcome rather than the asset — this
 * lands in a room's group chat, where "who just did what" is the point. The
 * streak is included because that's the thing people compete on, and the tx link
 * because every result here is verifiable on-chain rather than asserted.
 */
export function buildTelegramMessage(p: SettlementNotifyPayload): string {
  const name = esc(p.displayName || "Someone");
  const call = `${esc(p.symbol)} ${esc(p.direction.toUpperCase())} ${esc(p.window)}`;

  const headline =
    p.status === "won"
      ? `🔥 *${name}* called ${call} and won`
      : p.status === "lost"
        ? `💀 *${name}* called ${call} and lost`
        : `➖ *${name}*'s ${call} was voided`;

  const lines = [headline];

  if (p.status === "won" && p.payout !== null) {
    lines.push(`Returned *${esc(p.payout.toFixed(2))} tUSDC*`);
  } else if (p.status === "lost") {
    // Naming the cap is the whole risk story for this product.
    lines.push(`Down exactly the stake — no more than that`);
  }

  lines.push(
    p.currentStreak > 0
      ? `Streak: *${p.currentStreak}* 🔥${p.currentStreak === p.bestStreak && p.bestStreak > 1 ? " \\(personal best\\)" : ""}`
      : `Streak reset to 0`,
  );

  if (p.newBadges.length > 0) {
    lines.push(`New badge: *${esc(p.newBadges.join(", "))}*`);
  }

  if (p.txHash) {
    lines.push(`[View on\\-chain](https://shannon-explorer.somnia.network/tx/${p.txHash})`);
  }

  return lines.join("\n");
}

/**
 * Best-effort send. A notification failure must never fail settlement — the call
 * is already resolved on-chain and written to Firestore by this point.
 */
export async function postSettlementToTelegram(
  p: SettlementNotifyPayload,
  /** The room's own linked chat, when it has one. Falls back to TELEGRAM_CHAT_ID. */
  roomChatId?: string | null,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = roomChatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildTelegramMessage(p),
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`telegram sendMessage returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return;
    }
    // Log the delivered id. Without this, a successful send is indistinguishable
    // from the notification never being attempted — both look like silence.
    const body = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
    console.log(`telegram: posted settlement for ${p.uid} (message_id ${body?.result?.message_id ?? "?"})`);
  } catch (e) {
    console.error("telegram sendMessage failed:", e);
  }
}
