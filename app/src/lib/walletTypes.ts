// The wallet contract both platform implementations satisfy, so screens never
// need to know whether they're talking to RainbowKit or the embedded wallet.

import type { WalletClient } from "viem";

/** How a call gets signed. `placeCall` accepts either shape. */
export type CallSigner =
  | { kind: "embedded"; privateKey: `0x${string}` }
  | { kind: "external"; walletClient: WalletClient };

export interface WalletState {
  /** null until a wallet is available. */
  address: `0x${string}` | null;
  isConnected: boolean;
  /** Which path is active — drives the "Demo wallet" vs wallet-name label in the UI. */
  kind: "external" | "embedded" | null;
  /** Human label for the connected wallet ("MetaMask", "Demo wallet", …). */
  label: string | null;
  /** True while a connect attempt is in flight. */
  connecting: boolean;
  /** Opens the RainbowKit modal (web) or provisions the embedded key (native). */
  connect: () => void | Promise<void>;
  /** Falls back to the embedded on-device wallet. Always available. */
  useEmbedded: () => Promise<void>;
  disconnect: () => void | Promise<void>;
  /** Resolves the signer `placeCall` needs. Throws if no wallet is connected. */
  getSigner: () => Promise<CallSigner>;
  /** True when RainbowKit is usable on this platform at all. */
  supportsExternal: boolean;
}
