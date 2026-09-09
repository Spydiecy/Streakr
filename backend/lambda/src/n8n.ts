// Fires the n8n webhook that posts settlement outcomes to a Room's Telegram
// chat. See /n8n-workflows/settlement-notify.json for the workflow this
// webhook feeds. Config is a plain env var here (no functions.config()).

import type { CallDoc, UserDoc } from "./types";

function webhookUrl(): string | undefined {
  return process.env.N8N_SETTLEMENT_WEBHOOK_URL;
}

export interface SettlementNotifyPayload {
  roomId: string;
  uid: string;
  displayName: string;
  symbol: string;
  direction: string;
  window: string;
  status: "won" | "lost" | "void";
  payout: number | null;
  currentStreak: number;
  bestStreak: number;
  xpAwarded: number;
  newBadges: string[];
  txHash: string;
  positionId: string;
  settledAt: number;
  /**
   * The room's own linked chat, when it has one. The n8n workflow's Code node
   * already prefers this over its default, so per-room routing works on that
   * path too without editing the workflow.
   */
  telegramChatId?: string;
}

/** Best-effort fire-and-forget: a webhook outage must never fail settlement. */
export async function notifySettlement(payload: SettlementNotifyPayload): Promise<void> {
  const url = webhookUrl();
  if (!url) {
    console.warn("N8N_SETTLEMENT_WEBHOOK_URL not configured — skipping Telegram notification.");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`n8n settlement webhook returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (e) {
    console.error("n8n settlement webhook failed:", e);
  }
}

export function buildNotifyPayload(call: CallDoc, user: UserDoc, xpAwarded: number, newBadges: string[]): SettlementNotifyPayload {
  return {
    roomId: call.roomId,
    uid: call.uid,
    displayName: user.displayName,
    symbol: call.symbol,
    direction: call.direction,
    window: call.window,
    status: call.status as "won" | "lost" | "void",
    payout: call.payout ?? null,
    currentStreak: user.currentStreak,
    bestStreak: user.bestStreak,
    xpAwarded,
    newBadges,
    txHash: call.txHash,
    positionId: call.positionId,
    settledAt: call.settledAt ?? Date.now(),
  };
}
