// Web wallet path: RainbowKit + wagmi, with the embedded wallet kept as an
// explicit fallback.
//
// Why both on web: an external wallet a judge/visitor connects will not have
// Somnia Shannon STT gas or tUSDC collateral, and there's no way to faucet
// *their* wallet on their behalf — so a RainbowKit-only demo dead-ends at the
// first call. The embedded wallet is auto-fundable, so it keeps the full
// loop (call → settle → streak → share) demoable. RainbowKit is the primary,
// real path; embedded is the labelled demo path.

import "@rainbow-me/rainbowkit/styles.css";
// Must come after RainbowKit's own stylesheet — see the file for why the
// [data-rk] wrapper needs explicit flex sizing under react-native-web.
import "./rainbowkitLayout.css";
import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { WagmiProvider, createConfig, http, useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  useConnectModal,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
  injectedWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { activeChain, WALLETCONNECT_PROJECT_ID, hasWalletConnectProjectId, WALLET_APP_NAME } from "./wagmi";
import { loadOrCreateWallet, deleteWallet } from "./wallet";
import type { CallSigner, WalletState } from "./walletTypes";
import { colors } from "../theme";

// WalletConnect-backed connectors need a Project ID; injected ones don't. Only
// offer the former when we actually have an ID, so the modal never shows a
// wallet that would fail on click.
const wallets = hasWalletConnectProjectId
  ? [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
  : [injectedWallet, metaMaskWallet];

const connectors = connectorsForWallets(
  [{ groupName: "Wallets", wallets }],
  { appName: WALLET_APP_NAME, projectId: WALLETCONNECT_PROJECT_ID || "streakr-dev-placeholder" },
);

const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors,
  transports: { [activeChain.id]: http() },
  ssr: false,
});

const queryClient = new QueryClient();

const WalletCtx = createContext<WalletState | null>(null);

function InnerProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, connector } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: activeChain.id });
  const { disconnectAsync } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { status: connectStatus } = useConnect();

  const [embedded, setEmbedded] = useState<{ address: `0x${string}`; privateKey: `0x${string}` } | null>(null);
  const [busy, setBusy] = useState(false);

  const useEmbedded = useCallback(async () => {
    setBusy(true);
    try {
      const w = await loadOrCreateWallet();
      setEmbedded(w);
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    // Clear the stored demo key too, not just the in-memory handle — otherwise
    // "disconnect" then "use demo wallet" silently returns the same address,
    // which doesn't match what the button says it does.
    setEmbedded(null);
    await deleteWallet().catch(() => {});
    if (isConnected) await disconnectAsync();
  }, [isConnected, disconnectAsync]);

  const getSigner = useCallback(async (): Promise<CallSigner> => {
    // An external wallet wins when connected — it's the real path.
    if (isConnected && walletClient) return { kind: "external", walletClient };
    if (embedded) return { kind: "embedded", privateKey: embedded.privateKey };
    throw new Error("No wallet connected. Connect a wallet or use the demo wallet.");
  }, [isConnected, walletClient, embedded]);

  const value = useMemo<WalletState>(() => {
    const external = isConnected && !!address;
    return {
      address: external ? (address as `0x${string}`) : (embedded?.address ?? null),
      isConnected: external || !!embedded,
      kind: external ? "external" : embedded ? "embedded" : null,
      label: external ? (connector?.name ?? "Wallet") : embedded ? "Demo wallet" : null,
      connecting: busy || connectStatus === "pending",
      connect: () => openConnectModal?.(),
      useEmbedded,
      disconnect,
      getSigner,
      supportsExternal: true,
    };
  }, [isConnected, address, embedded, connector, busy, connectStatus, openConnectModal, useEmbedded, disconnect, getSigner]);

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: colors.accent,
            accentColorForeground: colors.onAccent,
            borderRadius: "large",
            overlayBlur: "small",
          })}
          modalSize="compact"
        >
          <InnerProvider>{children}</InnerProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
