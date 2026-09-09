// Firestore reads/writes for rooms, calls, and leaderboards. Every write here
// must satisfy backend/firestore.rules — see that file for the exact
// constraints (e.g. a call can only be created in "pending" status with a
// real txHash already attached).

import {
  collection,
  doc,
  arrayUnion,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getCountFromServer,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { CallDoc, LeaderboardEntryDoc, RoomDoc, UserDoc } from "./types";

const db = () => getDb();

// ── Rooms ──────────────────────────────────────────────────────────────────

/**
 * Bound a Firestore write so the UI can't hang on it forever.
 *
 * A `setDoc` promise only settles when the server acknowledges the write. If
 * requests to firestore.googleapis.com are being dropped — an ad/privacy
 * blocker is the common case, and it reports as ERR_BLOCKED_BY_CLIENT — the SDK
 * parks the mutation in its local queue and the promise never settles. The
 * spinner then spins indefinitely with nothing in the console to explain it.
 */
function writeTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — the request may be blocked by a browser extension`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function createRoom(params: {
  name: string;
  isPublic: boolean;
  createdBy: string;
}): Promise<string> {
  // Pre-generate the doc ref so roomId can be embedded in the create write
  // itself — firestore.rules' create check doesn't special-case a follow-up
  // update, so the id has to be there on the very first write.
  const ref = doc(collection(db(), "rooms"));
  try {
    await writeTimeout(
      setDoc(ref, {
        roomId: ref.id,
        name: params.name,
        isPublic: params.isPublic,
        memberUids: [params.createdBy],
        createdBy: params.createdBy,
        createdAt: Date.now(),
      }),
      12_000,
      "Creating the room",
    );
  } catch (e) {
    // The write is already queued locally, so it will still reach the server
    // whenever connectivity returns — which is how a room the user gave up on
    // appeared minutes later. Queue a matching delete so the two cancel out
    // instead of leaving an orphan nobody asked for.
    deleteDoc(ref).catch(() => {});
    throw e;
  }
  return ref.id;
}

export async function joinRoom(roomId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), "rooms", roomId), { memberUids: arrayUnion(uid) });
}

export interface RoomCallCount {
  /** Every call ever placed in this room. */
  total: number;
  /** Calls still awaiting on-chain settlement — live positions. */
  pending: number;
}

/**
 * How many calls a room holds, split by whether they've settled.
 *
 * Drives the delete confirmation copy: a room nobody has called in is throwaway
 * and can be removed with no caveat, whereas one with real calls leaves on-chain
 * records behind and the user should be told so before they confirm.
 *
 * Uses count aggregations rather than fetching the documents — this runs on a
 * tap and only the totals are needed.
 */
export async function countRoomCalls(roomId: string): Promise<RoomCallCount> {
  const calls = collection(db(), "calls");
  const [all, pending] = await Promise.all([
    getCountFromServer(query(calls, where("roomId", "==", roomId))),
    getCountFromServer(query(calls, where("roomId", "==", roomId), where("status", "==", "pending"))),
  ]);
  return { total: all.data().count, pending: pending.data().count };
}

/**
 * Delete a room. Only the creator can do this — enforced by firestore.rules
 * (`allow delete: if resource.data.createdBy == request.auth.uid`), so a
 * non-creator's attempt fails server-side regardless of what the UI shows.
 *
 * Leaves `calls` alone on purpose: a settled call is an audit record tied to a
 * real on-chain transaction, and shouldn't disappear because a room was
 * tidied up. The room's leaderboard entries go, since they're derived.
 *
 * Deleting a room with pending calls is allowed and safe — the settlement
 * poller queries `calls` by status, not by room, so those positions still
 * settle and still count toward the owner's streak and the global board.
 */
export async function deleteRoom(roomId: string): Promise<void> {
  const entries = await getDocs(collection(db(), "leaderboard", roomId, "entries"));
  await Promise.all(entries.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db(), "rooms", roomId));
}

export async function listPublicRooms(max = 30): Promise<RoomDoc[]> {
  const snap = await getDocs(
    query(collection(db(), "rooms"), where("isPublic", "==", true), orderBy("createdAt", "desc"), limit(max)),
  );
  return snap.docs.map((d) => d.data() as RoomDoc);
}

export function subscribeRoom(roomId: string, cb: (room: RoomDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db(), "rooms", roomId), (snap) => cb(snap.exists() ? (snap.data() as RoomDoc) : null));
}

export async function setRoomActiveMarket(
  roomId: string,
  activeMarket: RoomDoc["activeMarket"],
): Promise<void> {
  await updateDoc(doc(db(), "rooms", roomId), { activeMarket });
}

// ── Calls ──────────────────────────────────────────────────────────────────

export interface CreateCallInput {
  roomId: string;
  uid: string;
  symbol: CallDoc["symbol"];
  direction: CallDoc["direction"];
  window: CallDoc["window"];
  stakeUsdso: number;
  /** Outcome tokens bought. The settlement payout is computed from this. */
  shares: number;
  /** Price paid per share, 0–1. */
  entryPrice: number;
  txHash: string;
  positionId: string;
}

/** Record a call AFTER it has been signed and submitted on-chain. Never before. */
export async function recordCall(input: CreateCallInput): Promise<string> {
  // Same reasoning as createRoom: firestore.rules' create-only policy on
  // `calls` means callId must be present on the single allowed write.
  const ref = doc(collection(db(), "calls"));
  await setDoc(ref, {
    ...input,
    callId: ref.id,
    status: "pending",
    createdAt: Date.now(),
  });
  return ref.id;
}

export function subscribeCall(callId: string, cb: (call: CallDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db(), "calls", callId), (snap) => cb(snap.exists() ? (snap.data() as CallDoc) : null));
}

export function subscribeRoomCalls(roomId: string, cb: (calls: CallDoc[]) => void, max = 50): Unsubscribe {
  const q = query(collection(db(), "calls"), where("roomId", "==", roomId), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as CallDoc)));
}

export function subscribeUserCalls(uid: string, cb: (calls: CallDoc[]) => void, max = 50): Unsubscribe {
  const q = query(collection(db(), "calls"), where("uid", "==", uid), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as CallDoc)));
}

// ── Users ──────────────────────────────────────────────────────────────────

export function subscribeUser(uid: string, cb: (user: UserDoc | null) => void): Unsubscribe {
  return onSnapshot(doc(db(), "users", uid), (snap) => cb(snap.exists() ? (snap.data() as UserDoc) : null));
}

export async function getUser(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db(), "users", uid));
  return snap.exists() ? (snap.data() as UserDoc) : null;
}

/**
 * Display names for a set of uids, cached for the session.
 *
 * Calls carry only a uid, so a room's activity feed needs this to show who made
 * each one. Cached because the same handful of members recur on every snapshot,
 * and a live listener re-runs on each new call.
 */
const nameCache = new Map<string, string>();

export async function fetchDisplayNames(uids: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(uids)].filter((u) => !nameCache.has(u));
  if (missing.length > 0) {
    const docs = await Promise.all(missing.map((u) => getDoc(doc(db(), "users", u)).catch(() => null)));
    docs.forEach((snap, i) => {
      const name = snap?.exists() ? (snap.data() as UserDoc).displayName : undefined;
      // Fall back to a short uid so an unreadable profile still renders as
      // something stable rather than blank.
      nameCache.set(missing[i], name || `${missing[i].slice(0, 6)}…`);
    });
  }
  return new Map(uids.map((u) => [u, nameCache.get(u) ?? `${u.slice(0, 6)}…`]));
}

export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  await setDoc(doc(db(), "users", uid), { displayName, updatedAt: Date.now() }, { merge: true });
  // Keep the activity feed from showing the old name for the rest of the session.
  nameCache.set(uid, displayName);
}

// ── Leaderboards ─────────────────────────────────────────────────────────

export function subscribeLeaderboard(
  scope: string, // "global" | roomId
  cb: (entries: LeaderboardEntryDoc[]) => void,
  max = 50,
): Unsubscribe {
  const q = query(
    collection(db(), "leaderboard", scope, "entries"),
    orderBy("currentStreak", "desc"),
    orderBy("xp", "desc"),
    limit(max),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as LeaderboardEntryDoc)));
}
