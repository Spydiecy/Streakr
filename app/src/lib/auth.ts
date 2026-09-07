// Session bootstrap: Firebase anonymous sign-in + the users/{uid} doc.
//
// The wallet itself is owned by WalletProvider (RainbowKit on web, embedded on
// native) — this module only takes the resulting address and attaches a
// Firebase identity to it. Anonymous auth gives every install a stable uid to
// key Firestore docs off without a second credential for the user to manage;
// the wallet address is what's displayed and shared.

import { signInAnonymously, onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getDb } from "./firebase";
import type { UserDoc } from "./types";

export interface StreakrSession {
  user: User;
  walletAddress: `0x${string}`;
  profile: UserDoc;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Idempotent: safe to call on every launch and on every wallet change. */
export async function bootstrapSession(
  walletAddress: `0x${string}`,
  displayName?: string,
): Promise<StreakrSession> {
  const auth = getFirebaseAuth();

  const user = await new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (u) {
          unsub();
          resolve(u);
        }
      },
      reject,
    );
    if (!auth.currentUser) signInAnonymously(auth).catch(reject);
  });

  const userRef = doc(getDb(), "users", user.uid);
  const snap = await getDoc(userRef);

  const wanted = displayName?.trim();

  let profile: UserDoc;
  if (snap.exists()) {
    profile = snap.data() as UserDoc;

    // Reconcile against what the caller supplied. Both of these matter on an
    // EXISTING doc, not just at creation: Firebase anonymous auth persists
    // across reloads, so a returning user always lands here — an earlier
    // version only honoured displayName in the create branch, which meant a
    // name typed at onboarding was silently dropped for anyone who had
    // opened the app before.
    const patch: Partial<UserDoc> = {};
    if (wanted && wanted !== profile.displayName) patch.displayName = wanted;
    if (profile.walletAddress !== walletAddress) patch.walletAddress = walletAddress;

    if (Object.keys(patch).length > 0) {
      await setDoc(userRef, { ...patch, updatedAt: Date.now() }, { merge: true });
      profile = { ...profile, ...patch };
    }
  } else {
    profile = {
      uid: user.uid,
      walletAddress,
      displayName: wanted || shortAddr(walletAddress),
      xp: 0,
      currentStreak: 0,
      bestStreak: 0,
      badges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setDoc(userRef, profile);
  }

  return { user, walletAddress, profile };
}
