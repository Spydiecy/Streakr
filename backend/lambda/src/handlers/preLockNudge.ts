// preLockNudge — Lambda Function URL handler. GET ?withinSeconds=120
//
// n8n's scheduled "2 minutes before lock" workflow calls this. Returns every
// room whose active market window closes within `withinSeconds`, with its
// member list, so n8n can post a Telegram nudge. Auth: shared secret header
// (x-streakr-secret) — see /n8n-workflows/pre-lock-nudge.json.

import { getDb } from "../firebaseAdmin";
import { getNetwork, readSettlement } from "../chain";
import type { RoomDoc } from "../types";
import { getHeader, jsonResponse, type LambdaHttpEvent, type LambdaHttpResponse } from "../httpTypes";

export const handler = async (event: LambdaHttpEvent): Promise<LambdaHttpResponse> => {
  const expectedSecret = process.env.N8N_SHARED_SECRET;
  if (expectedSecret && getHeader(event, "x-streakr-secret") !== expectedSecret) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const windowSeconds = Number(event.queryStringParameters?.withinSeconds ?? 120);
  const network = getNetwork();
  const db = getDb();

  const roomsSnap = await db.collection("rooms").where("activeMarket", "!=", null).get();
  const nudges: {
    roomId: string;
    roomName: string;
    memberUids: string[];
    symbol: string;
    window: string;
    secondsLeft: number;
    /**
     * The room's own Telegram chat, so a nudge lands where that room's
     * settlements land.
     *
     * The n8n workflow already reads `telegramChatId` and falls back to the
     * default chat, but this handler never returned the field — so every nudge
     * silently went to the shared fallback while settlements went per-room. A
     * room linked to its own group got its results there and its reminders
     * somewhere else entirely.
     */
    telegramChatId?: string;
  }[] = [];

  for (const doc of roomsSnap.docs) {
    const room = doc.data() as RoomDoc;
    const marketId = room.activeMarket?.positionMarketId;
    if (!marketId) continue;
    try {
      const settlement = await readSettlement(network, marketId);
      if (settlement.status !== "trading") continue;
      const secondsLeft = settlement.expiry - Math.floor(Date.now() / 1000);
      if (secondsLeft > 0 && secondsLeft <= windowSeconds) {
        nudges.push({
          roomId: room.roomId,
          roomName: room.name,
          memberUids: room.memberUids,
          symbol: room.activeMarket!.symbol,
          window: room.activeMarket!.window,
          secondsLeft,
          ...(room.telegramChatId ? { telegramChatId: String(room.telegramChatId) } : {}),
        });
      }
    } catch (e) {
      console.error(`preLockNudge: failed to read market for room ${room.roomId}:`, e);
    }
  }

  return jsonResponse(200, { nudges });
};
