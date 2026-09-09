// The connected wallet's tUSDC balance, for display.
//
// Works the same for the demo wallet and an external one — it's a plain ERC-20
// read against whatever address the wallet layer currently holds, so there's no
// per-path branching.
//
// Shown because a call escrows collateral, and "why did that fail" is almost
// always "the wallet is empty". Surfacing the number continuously means the user
// sees it before they commit rather than in an error afterwards.

import { useCallback, useEffect, useState } from "react";
import { getCollateralBalance } from "./eventContracts";

interface State {
  /** tUSDC on hand, or null until the first read completes. */
  balance: number | null;
  loading: boolean;
  /** Re-read on demand — wired to the refresh control. */
  refresh: () => void;
}

export function useCollateralBalance(address: string | null | undefined, pollMs = 30_000): State {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const read = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!address) {
        setBalance(null);
        return;
      }
      setLoading(true);
      try {
        const b = await getCollateralBalance(address as `0x${string}`);
        if (!signal?.cancelled) setBalance(b.human);
      } catch {
        // Leave the last known value rather than flashing to "—" on a blip.
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [address],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    read(signal);
    // Balances change from the user's own calls and from faucet grants landing a
    // few seconds after connect, so a slow poll keeps it honest without the
    // complexity of watching Transfer logs.
    const id = setInterval(() => read(signal), pollMs);
    return () => {
      signal.cancelled = true;
      clearInterval(id);
    };
  }, [read, pollMs]);

  return { balance, loading, refresh: () => read() };
}
