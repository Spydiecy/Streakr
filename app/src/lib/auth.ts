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

  let profile: UserDoc;
  if (snap.exists()) {
    profile = snap.data() as UserDoc;
    // Keep the address in sync — the user may have switched wallets.
    if (profile.walletAddress !== walletAddress) {
      await setDoc(userRef, { walletAddress, updatedAt: Date.now() }, { merge: true });
      profile = { ...profile, walletAddress };
    }
  } else {
    profile = {
      uid: user.uid,
      walletAddress,
      displayName: displayName?.trim() || shortAddr(walletAddress),
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
