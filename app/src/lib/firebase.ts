// Firebase Auth — NATIVE (iOS / Android).
//
// Metro resolves firebase.web.ts for the web target and this file for native.
// See firebase.web.ts for why the two can't share one implementation:
// `getReactNativePersistence` ships only in Firebase's RN bundle, so it's
// available here and genuinely absent on web.
//
// Auth strategy (both platforms): Firebase Anonymous. The wallet is the
// identity — anonymous auth just supplies a stable uid to key Firestore docs
// off, with no second credential for the user to manage.

import { initializeAuth, type Auth } from "firebase/auth";
// @ts-expect-error — present in @firebase/auth's RN build (dist/rn), which
// Metro resolves for native, but absent from the generic type declarations
// tsc reads. Types-only gap on THIS platform; on web the export is genuinely
// missing, which is why firebase.web.ts exists.
import { getReactNativePersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { firebaseApp } from "./firebaseApp";

export { firebaseApp, getDb } from "./firebaseApp";

let _auth: Auth | undefined;
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return _auth;
}
