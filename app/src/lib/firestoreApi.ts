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
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { CallDoc, LeaderboardEntryDoc, RoomDoc, UserDoc } from "./types";

const db = () => getDb();

// ── Rooms ──────────────────────────────────────────────────────────────────

export async function createRoom(params: {
  name: string;
  isPublic: boolean;
  createdBy: string;
}): Promise<string> {
  // Pre-generate the doc ref so roomId can be embedded in the create write
  // itself — firestore.rules' create check doesn't special-case a follow-up
  // update, so the id has to be there on the very first write.
  const ref = doc(collection(db(), "rooms"));
  await setDoc(ref, {
    roomId: ref.id,
    name: params.name,
    isPublic: params.isPublic,
    memberUids: [params.createdBy],
    createdBy: params.createdBy,
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function joinRoom(roomId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), "rooms", roomId), { memberUids: arrayUnion(uid) });
}

/**
 * Delete a room. Only the creator can do this — enforced by firestore.rules
 * (`allow delete: if resource.data.createdBy == request.auth.uid`), so a
 * non-creator's attempt fails server-side regardless of what the UI shows.
 *
 * Leaves `calls` alone on purpose: a settled call is an audit record tied to a
 * real on-chain transaction, and shouldn't disappear because a room was
 * tidied up. The room's leaderboard entries go, since they're derived.
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

export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  await setDoc(doc(db(), "users", uid), { displayName, updatedAt: Date.now() }, { merge: true });
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
