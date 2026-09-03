// Firebase Admin bootstrap for AWS Lambda.
//
// Cloud Functions gets GCP credentials for free (ambient service identity);
// running on Lambda, we're outside GCP, so firebase-admin needs an explicit
// service account key. Provide it via the FIREBASE_SERVICE_ACCOUNT_JSON
// environment variable — the full JSON key file content, as a single-line
// string (Lambda console's env var editor handles multi-line values fine,
// but a plain JSON string is the least fiddly to paste).
//
// Get this file from: Firebase Console -> Project Settings -> Service
// Accounts -> Generate new private key. Treat it like a password — it's
// exactly as dangerous as a leaked cloud credential.

import * as admin from "firebase-admin";

let initialized = false;

export function getDb(): admin.firestore.Firestore {
  if (!initialized) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Paste the full service account JSON key " +
          "(Firebase Console -> Project Settings -> Service Accounts -> Generate new private key) " +
          "as this Lambda's environment variable.",
      );
    }
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
  }
  return admin.firestore();
}

export { admin };
