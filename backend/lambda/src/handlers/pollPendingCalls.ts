// pollPendingCalls — Lambda equivalent of the Cloud Functions scheduled
// function. Triggered by an EventBridge (CloudWatch Events) scheduled rule
// every 1 minute (see the deploy guide). For every `calls` doc still
// status=="pending", reads the REAL on-chain settlement outcome and, once
// resolved/voided, drives:
//
//   1. status/payout/settledAt on the call
//   2. streak/XP/badges on the user (gamification.ts)
//   3. room + global leaderboard entries
//   4. the Result Card doc
//   5. the n8n webhook (Telegram notification)
//
// Invocation shape: EventBridge invokes Lambda with a scheduled-event object
// as `event` — this handler ignores its contents entirely (there's nothing
// in it to read), it just runs the same sweep every time.

import { getDb, admin } from "../firebaseAdmin";
import { getNetwork, readSettlement, judgeCall, estimatePayoutRaw } from "../chain";
import { applyStreakUpdate, shouldAwardRoomChampion } from "../gamification";
import { notifySettlement, buildNotifyPayload } from "../n8n";
import { buildResultCard } from "../resultCard";
import type { CallDoc, UserDoc } from "../types";

async function settleOneCall(callSnap: admin.firestore.QueryDocumentSnapshot): Promise<boolean> {
  const db = getDb();
  const call = callSnap.data() as CallDoc;
  const network = getNetwork();

  const settlement = await readSettlement(network, call.positionId);
  const verdict = judgeCall(call.direction, settlement);
  if (verdict === "pending") return false;

  const calledLeg = call.direction === "up" ? 0 : 1;
  const amountRaw = BigInt(Math.round(call.stakeUsdso * 10 ** settlement.onchain.decimals));
  const payoutRaw =
    verdict === "won" || verdict === "void" ? estimatePayoutRaw(settlement, calledLeg as 0 | 1, amountRaw) : 0n;
  const payout = Number(payoutRaw) / 10 ** settlement.onchain.decimals;

  const usersRef = db.collection("users").doc(call.uid);

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(usersRef);
    if (!userSnap.exists) throw new Error(`settleOneCall: user ${call.uid} not found`);
    const user = userSnap.data() as UserDoc;

    const priorSettled = await tx.get(
      db.collection("calls").where("uid", "==", call.uid).where("status", "in", ["won", "lost", "void"]).limit(1),
    );
    const isFirstCallEver = priorSettled.empty;

    const update = applyStreakUpdate({
      status: verdict,
      currentStreak: user.currentStreak,
      bestStreak: user.bestStreak,
      existingBadges: user.badges ?? [],
      isFirstCallEver,
    });

    const now = Date.now();
    const updatedUser: UserDoc = {
      ...user,
      currentStreak: update.currentStreak,
      bestStreak: update.bestStreak,
      xp: user.xp + update.xpAwarded,
      badges: [...new Set([...(user.badges ?? []), ...update.newBadges])],
      updatedAt: now,
    };
    tx.set(usersRef, updatedUser, { merge: true });

    const updatedCall: Partial<CallDoc> = {
      status: verdict,
      payout,
      settledAt: now,
      streakAfter: update.currentStreak,
      xpAwarded: update.xpAwarded,
      badgesAwarded: update.newBadges,
    };
    tx.set(callSnap.ref, updatedCall, { merge: true });

    return {
      user: updatedUser,
      call: { ...call, ...updatedCall } as CallDoc,
      xpAwarded: update.xpAwarded,
      newBadges: update.newBadges,
    };
  });

  await refreshLeaderboards(result.call.roomId, result.user);
  await maybeAwardRoomChampion(result.call.roomId, result.user);

  const cardDoc = buildResultCard(result.call, result.user);
  await db.collection("resultCards").doc(cardDoc.cardId).set(cardDoc, { merge: true });

  await notifySettlement(buildNotifyPayload(result.call, result.user, result.xpAwarded, result.newBadges));

  console.log(
    `settled call ${call.callId}: ${verdict} · streak=${result.user.currentStreak} · xp+${result.xpAwarded} · badges+${result.newBadges.join(",") || "none"}`,
  );
  return true;
}

async function refreshLeaderboards(roomId: string, user: UserDoc): Promise<void> {
  const db = getDb();
  const entry = {
    uid: user.uid,
    displayName: user.displayName,
    currentStreak: user.currentStreak,
    bestStreak: user.bestStreak,
    xp: user.xp,
    updatedAt: Date.now(),
  };
  await Promise.all([
    db.collection("leaderboard").doc("global").collection("entries").doc(user.uid).set(entry, { merge: true }),
    db.collection("leaderboard").doc(roomId).collection("entries").doc(user.uid).set(entry, { merge: true }),
  ]);
}

async function maybeAwardRoomChampion(roomId: string, user: UserDoc): Promise<void> {
  const db = getDb();
  const top = await db
    .collection("leaderboard")
    .doc(roomId)
    .collection("entries")
    .orderBy("currentStreak", "desc")
    .orderBy("xp", "desc")
    .limit(1)
    .get();
  const isNumberOne = !top.empty && top.docs[0].id === user.uid;
  if (!shouldAwardRoomChampion(user.badges ?? [], isNumberOne)) return;

  await db
    .collection("users")
    .doc(user.uid)
    .set({ badges: admin.firestore.FieldValue.arrayUnion("room_champion") }, { merge: true });
  console.log(`awarded room_champion to ${user.uid} in room ${roomId}`);
}

export const handler = async (): Promise<{ checked: number; settled: number }> => {
  const db = getDb();
  const pending = await db.collection("calls").where("status", "==", "pending").limit(200).get();
  if (pending.empty) return { checked: 0, settled: 0 };

  let settled = 0;
  for (const doc of pending.docs) {
    try {
      if (await settleOneCall(doc)) settled++;
    } catch (e) {
      console.error(`failed to settle call ${doc.id}:`, e);
    }
  }
  console.log(`pollPendingCalls: checked ${pending.size}, settled ${settled}`);
  return { checked: pending.size, settled };
};
