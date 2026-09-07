// wagmi + RainbowKit configuration.
//
// PLATFORM NOTE — this is the web path only.
//
// RainbowKit is a browser library: it renders DOM-based modals and ships
// vanilla-extract CSS, and its docs make no mention of React Native. It works
// on Expo's *web* target (which is where Streakr is demoed — the Vercel
// build) but it cannot run on native iOS/Android. The React Native equivalent
// would be Reown AppKit (formerly WalletConnect Modal, which is now
// deprecated in favour of AppKit).
//
// So the app supports two wallet paths, and picks per-platform:
//   web    → RainbowKit / wagmi (a real external wallet)
//   native → the embedded on-device wallet in wallet.ts
//
// Both end up signing real transactions through the same markets-sdk trader;
// the only difference is where the key lives. See WalletProvider.tsx for how
// the two are selected, and eventContracts.ts for how a call is signed
// either way.

import { somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";
import type { Chain } from "viem";
import { NETWORK } from "./chain";

/** The chain the app trades on, as a viem/wagmi Chain (from the SDK, so the
 *  RPC + explorer metadata always matches what the SDK itself uses). */
export const activeChain: Chain = (NETWORK === "mainnet" ? somniaMainnet : somniaShannon) as Chain;

/**
 * WalletConnect Project ID, from https://cloud.reown.com.
 *
 * RainbowKit requires this for WalletConnect-based connectors (mobile wallet
 * QR pairing). Injected browser wallets (MetaMask, Rabby, Brave) still work
 * without it, so the app degrades to injected-only rather than failing to
 * boot when it's unset — see `hasWalletConnectProjectId` below.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const hasWalletConnectProjectId = WALLETCONNECT_PROJECT_ID.length > 0;

export const WALLET_APP_NAME = "Streakr";
