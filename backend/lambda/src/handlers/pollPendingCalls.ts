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
import { getNetwork, readSettlement, judgeCall, estimatePayoutRaw, readOutcomeBalance } from "../chain";
import { applyStreakUpdate, shouldAwardRoomChampion } from "../gamification";
import { notifySettlement, buildNotifyPayload } from "../n8n";
import { postSettlementToTelegram } from "../telegram";
import { buildResultCard } from "../resultCard";
import type { CallDoc, RoomDoc, UserDoc } from "../types";

async function settleOneCall(callSnap: admin.firestore.QueryDocumentSnapshot): Promise<boolean> {
  const db = getDb();
  const call = callSnap.data() as CallDoc;
  const network = getNetwork();

  const settlement = await readSettlement(network, call.positionId);
  const verdict = judgeCall(call.direction, settlement);
  if (verdict === "pending") return false;

  const calledLeg = call.direction === "up" ? 0 : 1;

  // The amount here is OUTCOME TOKENS, not collateral. A winning share redeems
  // for ~1 collateral, so the payout follows from how many shares were bought —
  // stake / price — and not from the stake.
  //
  // This previously passed the stake, which made every winning payout come back
  // equal to the stake: a $5 call that should have returned $21 reported $5, so
  // wins looked like break-even. `shares` is now recorded at call time.
  //
  // Calls written before that field existed can't be valued after the fact (the
  // fill price isn't recoverable from the document), so they settle with no
  // payout figure rather than a wrong one. The UI omits the amount when it's
  // absent instead of printing a number it can't stand behind.
  const decimals = settlement.onchain.decimals;

  // Read the share count from chain, not from the call document.
  //
  // The client records what it believes it filled, but that value drives the
  // payout shown in a shared room feed, so taking it on trust would let a client
  // claim any win it liked. The wallet's actual ERC-6909 balance on the called leg
  // is authoritative, and keeps the "outcomes come from on-chain state, never
  // self-reported" premise true for the amount as well as the verdict.
  //
  // Falls back to the recorded value only if the read fails, and to no figure at
  // all if neither is available — a missing amount is honest, a wrong one isn't.
  let sharesRaw: bigint | null = null;
  try {
    const holder = await resolveWalletAddress(call.uid);
    if (holder) sharesRaw = await readOutcomeBalance(network, settlement.onchain, holder, calledLeg as 0 | 1);
  } catch (e) {
    console.error(`settleOneCall: outcome balance read failed for ${call.callId}:`, e);
  }
  if ((sharesRaw === null || sharesRaw === 0n) && typeof call.shares === "number" && call.shares > 0) {
    sharesRaw = BigInt(Math.round(call.shares * 10 ** decimals));
  }

  const payout = (() => {
    if (verdict === "lost") return 0;
    if (sharesRaw === null || sharesRaw <= 0n) return undefined;
    const raw = estimatePayoutRaw(settlement, calledLeg as 0 | 1, sharesRaw);
    return Number(raw) / 10 ** decimals;
  })();

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
      // Omit rather than write undefined — Firestore rejects undefined values,
      // and an absent field is what the UI checks for.
      ...(payout !== undefined ? { payout } : {}),
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

  // Both notification paths are optional and independent — n8n for the workflow
  // route, the Bot API directly for a route with no hosting dependency. Either,
  // both, or neither; settlement never depends on them.
  const notifyPayload = buildNotifyPayload(result.call, result.user, result.xpAwarded, result.newBadges);
  // A room that linked its own Telegram group gets notified there; everything
  // else falls back to the shared chat, so no setup is required for a demo.
  const roomChatId = await lookupRoomChat(result.call.roomId);
  await Promise.all([
    notifySettlement({ ...notifyPayload, telegramChatId: roomChatId ?? undefined }),
    postSettlementToTelegram(notifyPayload, roomChatId),
  ]);

  console.log(
    `settled call ${call.callId}: ${verdict} · streak=${result.user.currentStreak} · xp+${result.xpAwarded} · badges+${result.newBadges.join(",") || "none"}`,
  );
  return true;
}

/** The Telegram chat a room has linked, if any. */
async function lookupRoomChat(roomId: string): Promise<string | null> {
  try {
    const snap = await getDb().collection("rooms").doc(roomId).get();
    const id = snap.exists ? (snap.data() as RoomDoc).telegramChatId : null;
    return id ? String(id) : null;
  } catch (e) {
    console.error(`lookupRoomChat failed for ${roomId}:`, e);
    return null;
  }
}

/** The wallet that signed a user's calls, for reading their on-chain holdings. */
async function resolveWalletAddress(uid: string): Promise<string | null> {
  const snap = await getDb().collection("users").doc(uid).get();
  const addr = snap.exists ? (snap.data() as UserDoc).walletAddress : undefined;
  return addr && /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : null;
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
