// Onboarding flow: create/load the embedded wallet, sign into Firebase
// anonymously, and ensure a users/{uid} doc exists. This is the "wallet
// connect -> lightweight Firebase Auth session" step from Phase 3.

import { signInAnonymously, onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getDb } from "./firebase";
import { loadOrCreateWallet, type StreakrWallet } from "./wallet";
import type { UserDoc } from "./types";

export interface StreakrSession {
  user: User;
  wallet: StreakrWallet;
  profile: UserDoc;
}

/**
 * Full onboarding: embedded wallet (create-if-missing) -> Firebase anonymous
 * sign-in (create-if-missing) -> users/{uid} doc (create-if-missing). Safe to
 * call every app launch; each step is idempotent.
 */
export async function bootstrapSession(displayName?: string): Promise<StreakrSession> {
  const wallet = await loadOrCreateWallet();
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
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(reject);
    }
  });

  const userRef = doc(getDb(), "users", user.uid);
  const snap = await getDoc(userRef);

  let profile: UserDoc;
  if (snap.exists()) {
    profile = snap.data() as UserDoc;
    // Keep the wallet address in sync in case the local key was regenerated.
    if (profile.walletAddress !== wallet.address) {
      await setDoc(userRef, { walletAddress: wallet.address, updatedAt: Date.now() }, { merge: true });
      profile = { ...profile, walletAddress: wallet.address };
    }
  } else {
    const shortAddr = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
    profile = {
      uid: user.uid,
      walletAddress: wallet.address,
      displayName: displayName?.trim() || shortAddr,
      xp: 0,
      currentStreak: 0,
      bestStreak: 0,
      badges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await setDoc(userRef, profile);
  }

  return { user, wallet, profile };
}

export function subscribeAuthState(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), cb);
}
