// The embedded ("demo") wallet.
//
// A private key generated on-device and persisted locally. Storage is
// platform-split — OS keychain on native, localStorage on web — see
// keyStore.ts / keyStore.web.ts, including the security note on the web path.
//
// This is the fallback wallet. On web the primary path is RainbowKit, where
// the key stays inside the user's own wallet and this module isn't used. The
// embedded wallet exists so the full call cycle is demoable on Somnia testnet
// without asking someone to fund an external wallet first.
//
// Either way, every call is a real wallet-signed testnet transaction through
// the same markets-sdk trader — the difference is only custody of the key.

import "react-native-get-random-values";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readKey, writeKey, clearKey, IS_SECURE_STORAGE } from "./keyStore";

export { IS_SECURE_STORAGE };

export interface StreakrWallet {
  privateKey: `0x${string}`;
  address: `0x${string}`;
}

function toWallet(privateKey: `0x${string}`): StreakrWallet {
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

/** Load the existing embedded wallet, or create one on first use. */
export async function loadOrCreateWallet(): Promise<StreakrWallet> {
  const existing = await readKey();
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) {
    return toWallet(existing as `0x${string}`);
  }
  const privateKey = generatePrivateKey();
  await writeKey(privateKey);
  return toWallet(privateKey);
}

export async function hasWallet(): Promise<boolean> {
  return (await readKey()) != null;
}

/** Wipes the local embedded wallet. */
export async function deleteWallet(): Promise<void> {
  await clearKey();
}
