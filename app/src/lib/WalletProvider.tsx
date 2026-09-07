// Native wallet path: embedded on-device wallet only.
//
// RainbowKit cannot run here (browser DOM + vanilla-extract CSS; no React
// Native support). Metro resolves WalletProvider.web.tsx for the web target
// and this file for iOS/Android, so RainbowKit's code never enters a native
// bundle. Wiring a real external wallet on native would mean Reown AppKit for
// React Native — a separate integration, noted in wagmi.ts.
//
// The interface is identical to the web provider, so no screen needs a
// platform branch: `supportsExternal` is simply false here and `connect()`
// provisions the embedded key instead of opening a modal.

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { loadOrCreateWallet, deleteWallet } from "./wallet";
import type { CallSigner, WalletState } from "./walletTypes";

const WalletCtx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState<{ address: `0x${string}`; privateKey: `0x${string}` } | null>(null);
  const [busy, setBusy] = useState(false);

  const useEmbedded = useCallback(async () => {
    setBusy(true);
    try {
      setEmbedded(await loadOrCreateWallet());
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setEmbedded(null);
    await deleteWallet();
  }, []);

  const getSigner = useCallback(async (): Promise<CallSigner> => {
    if (!embedded) throw new Error("No wallet yet. Tap Connect to create your device wallet.");
    return { kind: "embedded", privateKey: embedded.privateKey };
  }, [embedded]);

  const value = useMemo<WalletState>(
    () => ({
      address: embedded?.address ?? null,
      isConnected: !!embedded,
      kind: embedded ? "embedded" : null,
      label: embedded ? "Device wallet" : null,
      connecting: busy,
      connect: useEmbedded,
      useEmbedded,
      disconnect,
      getSigner,
      supportsExternal: false,
    }),
    [embedded, busy, useEmbedded, disconnect, getSigner],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
