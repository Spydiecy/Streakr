// Private-key storage — WEB.
//
// expo-secure-store is native-only (it wraps the iOS Keychain / Android
// Keystore); in a browser its methods don't exist and calling them throws
// "getValueWithKeyAsync is not a function". So the web build uses
// localStorage.
//
// ⚠️ SECURITY: localStorage is NOT secure storage. Anything running on this
// origin — including a malicious dependency or an XSS payload — can read it.
// That is an accepted tradeoff here for one specific reason: this path only
// ever holds the **demo wallet**, a throwaway key that exists to let someone
// try a full call cycle on Somnia *testnet* without funding their own wallet.
// It never holds mainnet value.
//
// Users who connect a real wallet go through RainbowKit instead (see
// WalletProvider.web.tsx), where the key never leaves their wallet extension
// and this module is not involved at all.

const KEY = "streakr.wallet.privateKey";

function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Storage can throw in private-mode / blocked-cookie contexts.
    return null;
  }
}

export async function readKey(): Promise<string | null> {
  return ls()?.getItem(KEY) ?? null;
}

export async function writeKey(value: string): Promise<void> {
  ls()?.setItem(KEY, value);
}

export async function clearKey(): Promise<void> {
  ls()?.removeItem(KEY);
}

/** False on web — surfaced so the UI can be honest about where the key lives. */
export const IS_SECURE_STORAGE = false;
