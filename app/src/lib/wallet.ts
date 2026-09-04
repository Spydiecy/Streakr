// Embedded wallet for Streakr.
//
// The brief allows "WalletConnect OR embedded wallet pattern consistent with
// how DreamDEX's own web app onboards users." DreamDEX's own bot-kit
// onboarding is itself just a raw private key in .env (see
// chain-integration/.env.example + docs/getting-started.md) — there's no
// WalletConnect flow documented anywhere in the bot-kit or the Event
// Contracts docs to mirror. Standing up a real WalletConnect (Reown) pairing
// flow needs a registered Project ID from cloud.reown.com, which nobody has
// provided here — so this app uses an embedded wallet instead: a private key
// generated on-device, stored in the OS keychain via expo-secure-store, never
// leaving the device. Every call the user makes is still a real signed
// transaction, submitted the same way the CLI scripts (place-event-contract-call.ts)
// sign theirs — same SDK, same trader.placeOrder path. If a real WalletConnect
// integration is wanted later, swap this module's signer for a WalletConnect
// session signer; nothing else in the app needs to change since everything
// downstream just wants a `0x${string}` private key or a viem WalletClient.
//
// Security note: SecureStore uses the iOS Keychain / Android Keystore, which
// is reasonable for a hackathon demo wallet holding testnet funds. It is NOT
// a substitute for a hardware-backed or MPC wallet for real funds.

import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY_STORAGE_KEY = "streakr.wallet.privateKey";

export interface StreakrWallet {
  privateKey: `0x${string}`;
  address: `0x${string}`;
}

/**
 * Load the existing embedded wallet, or create one on first launch. Called
 * once during onboarding; the resulting address is what gets written to
 * users/{uid}.walletAddress.
 */
export async function loadOrCreateWallet(): Promise<StreakrWallet> {
  const existing = await SecureStore.getItemAsync(KEY_STORAGE_KEY);
  if (existing) {
    const privateKey = existing as `0x${string}`;
    return { privateKey, address: privateKeyToAccount(privateKey).address };
  }
  const privateKey = generatePrivateKey();
  await SecureStore.setItemAsync(KEY_STORAGE_KEY, privateKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

export async function hasWallet(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY_STORAGE_KEY)) != null;
}

/** Danger: wipes the local embedded wallet. Used only from a debug/reset action. */
export async function deleteWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_STORAGE_KEY);
}
