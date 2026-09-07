import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { bootstrapSession, type StreakrSession } from "./auth";
import { subscribeUser } from "./firestoreApi";
import { useWallet } from "./WalletProvider";
import type { UserDoc } from "./types";

interface SessionState {
  loading: boolean;
  error: string | null;
  session: StreakrSession | null;
  profile: UserDoc | null;
  /** Set the display name at onboarding time; re-runs bootstrap. */
  setDisplayName: (name: string) => void;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Attaches a Firebase session to whatever wallet WalletProvider currently
 * has. Reacts to the wallet address rather than owning it, so connecting,
 * switching, or disconnecting a wallet flows through automatically.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<StreakrSession | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const pendingName = useRef<string | undefined>(undefined);

  const run = useCallback(async (addr: `0x${string}`, name?: string) => {
    setLoading(true);
    setError(null);
    try {
      const s = await bootstrapSession(addr, name);
      setSession(s);
      setProfile(s.profile);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setSession(null);
      setProfile(null);
      return;
    }
    run(address, pendingName.current);
  }, [address, run]);

  // Live profile updates, so streak/XP/badges reflect settlement immediately.
  useEffect(() => {
    if (!session) return;
    return subscribeUser(session.user.uid, (u) => {
      if (u) setProfile(u);
    });
  }, [session]);

  const setDisplayName = useCallback(
    (name: string) => {
      pendingName.current = name;
      if (address) run(address, name);
    },
    [address, run],
  );

  return (
    <SessionContext.Provider value={{ loading, error, session, profile, setDisplayName }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
