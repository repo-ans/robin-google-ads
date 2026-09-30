import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { Profile } from "./types";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  // True until both the session and (if signed in) the profile are known.
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// One auth subscription for the whole app (the reference opened one per
// component through useAuth()). Holds the Supabase session and the caller's
// profiles row, which carries the role and client_id.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      const current = data.session;
      // A stored session whose expiry has passed (a backgrounded tab whose
      // refresh timer was throttled) would otherwise surface as a raw
      // "JWT expired" error on the next query. Sign out cleanly instead.
      if (current?.expires_at && current.expires_at * 1000 < Date.now()) {
        await supabase.auth.signOut();
        return;
      }
      setSession(current);
      setSessionLoading(false);
    }

    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoading(false);
    });

    function handleVisibility() {
      if (document.visibilityState === "visible") checkSession();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("user_id, email, role, client_id, disabled")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile((data as Profile | null) ?? null);
        setProfileUserId(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const currentProfile = userId && profileUserId === userId ? profile : null;
  const loading = sessionLoading || (userId !== null && profileUserId !== userId);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, profile: currentProfile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
