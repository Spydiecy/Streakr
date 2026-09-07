// Private-key storage — NATIVE (iOS / Android).
//
// Uses expo-secure-store, which is backed by the iOS Keychain / Android
// Keystore. Metro resolves keyStore.web.ts for the web target instead, because
// expo-secure-store has no web implementation at all — calling it in a browser
// throws "getValueWithKeyAsync is not a function".

import * as SecureStore from "expo-secure-store";

const KEY = "streakr.wallet.privateKey";

export async function readKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function writeKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** True when the key sits in OS-level secure storage. */
export const IS_SECURE_STORAGE = true;
