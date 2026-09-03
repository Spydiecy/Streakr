// Result Card data assembly — unchanged logic from the Cloud Functions
// version. Actual image rendering is in handlers/renderResultCard.ts.

import type { CallDoc, ResultCardDoc, UserDoc } from "./types";

export function buildResultCard(call: CallDoc, user: UserDoc): ResultCardDoc {
  return {
    cardId: call.callId,
    callId: call.callId,
    uid: call.uid,
    displayName: user.displayName,
    symbol: call.symbol,
    direction: call.direction,
    status: call.status,
    streakAfter: call.streakAfter ?? user.currentStreak,
    payout: call.payout,
    createdAt: Date.now(),
  };
}
