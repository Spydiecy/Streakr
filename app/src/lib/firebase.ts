// Firebase init for Streakr. Values come from EXPO_PUBLIC_* env vars so the
// same bundle can point at different Firebase projects (dev/demo) without a
// rebuild of native code — see /.env.example at the app root.
//
// Auth strategy: Firebase Anonymous Auth. The brief asks for "lightweight
// login" gated behind wallet connect — Streakr's wallet IS the identity (an
// embedded key created on-device), so there's no separate password/email
// step. Anonymous auth gives every install a stable Firebase uid to key
// Firestore docs off, without adding a second credential the user has to
// manage. The wallet address (not the Firebase uid) is what's shown/shared;
// the uid is plumbing.

import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, type Auth } from "firebase/auth";
// @ts-expect-error — getReactNativePersistence ships in firebase's RN bundle
// (@firebase/auth/dist/rn/index.rn.d.ts) but the generic "firebase/auth"
// type declarations tsc resolves under Node's module resolution don't
// include it. Metro resolves the RN-specific build at runtime (platform
// extension resolution), so the function is genuinely present when the app
// actually runs — this is a types-only gap, not a runtime one. See e.g.
// https://stackoverflow.com/questions/76779282 for the same report against
// other firebase versions.
// eslint-disable-next-line import/no-duplicates
import { getReactNativePersistence } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

let _auth: Auth | undefined;
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return _auth;
}

let _db: Firestore | undefined;
export function getDb(): Firestore {
  if (_db) return _db;
  _db = getFirestore(firebaseApp);
  return _db;
}
