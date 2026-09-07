// Firebase Auth — WEB.
//
// `getReactNativePersistence` only exists in Firebase's React Native bundle
// (@firebase/auth/dist/rn). On web, Metro resolves the *browser* build, where
// that export genuinely doesn't exist — calling it throws
// "(0, n.getReactNativePersistence) is not a function" at runtime.
//
// (An earlier version imported it unconditionally behind a ts-expect-error
// suppression, on the assumption the gap was types-only. It isn't: types-only
// on native, a real missing export on web. Hence this split.)
//
// Web uses browserLocalPersistence, which keeps the anonymous session in
// localStorage across reloads — the web equivalent of the AsyncStorage
// persistence the native path uses.

import { initializeAuth, browserLocalPersistence, type Auth } from "firebase/auth";
import { firebaseApp } from "./firebaseApp";

export { firebaseApp, getDb } from "./firebaseApp";

let _auth: Auth | undefined;
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = initializeAuth(firebaseApp, { persistence: browserLocalPersistence });
  return _auth;
}
