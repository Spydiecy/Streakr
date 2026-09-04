import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { bootstrapSession, type StreakrSession } from "./auth";
import { subscribeUser } from "./firestoreApi";
import type { UserDoc } from "./types";

interface SessionState {
  loading: boolean;
  error: string | null;
  session: StreakrSession | null;
  profile: UserDoc | null; // live-updating copy of session.profile
  refresh: (displayName?: string) => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<StreakrSession | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);

  const refresh = useCallback(async (displayName?: string) => {
    setLoading(true);
    setError(null);
    try {
      const s = await bootstrapSession(displayName);
      setSession(s);
      setProfile(s.profile);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    return subscribeUser(session.user.uid, (u) => {
      if (u) setProfile(u);
    });
  }, [session]);

  return (
    <SessionContext.Provider value={{ loading, error, session, profile, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
