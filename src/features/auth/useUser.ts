"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { hasSupabaseAuth } from "@/lib/env";
import { loadBrowserSupabase } from "@/lib/supabase/browser";
import { setAnalyticsUser, track } from "@/lib/analytics/client";
import { consumeAuthEventCookie } from "./authEvent";

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
}

export interface UseUserResult {
  user: AuthUser | null;
  /** True until the first session check settles. Always false when accounts are off. */
  loading: boolean;
  signOut: () => Promise<void>;
}

function toAuthUser(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(typeof meta.display_name === "string" && meta.display_name
      ? { displayName: meta.display_name }
      : {}),
  };
}

/**
 * The signed-in user in the browser. Reads the session once, then follows auth state changes
 * (sign in, sign out, token refresh, other tabs). Keeps the analytics client's user id in step.
 */
export function useUser(): UseUserResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(hasSupabaseAuth);

  useEffect(() => {
    // Accounts off: `loading` already started as false and `user` stays null.
    if (!hasSupabaseAuth) return;

    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    loadBrowserSupabase().then(
      (supabase) => {
        if (cancelled) return;
        if (!supabase) {
          setLoading(false);
          return;
        }
        supabase.auth.getUser().then(
          ({ data }) => {
            if (cancelled) return;
            setUser(toAuthUser(data.user));
            setLoading(false);
          },
          () => {
            if (!cancelled) setLoading(false);
          },
        );
        subscription = supabase.auth.onAuthStateChange((_event, session) => {
          if (cancelled) return;
          setUser(toAuthUser(session?.user));
          setLoading(false);
        }).data.subscription;
      },
      () => {
        // The SDK chunk failed to load: behave as signed out rather than loading forever.
        if (!cancelled) setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;
  useEffect(() => {
    setAnalyticsUser(userId);
    if (!userId) return;
    // A magic-link sign-in finished server-side; report it now that we are back in the browser.
    const pending = consumeAuthEventCookie();
    if (pending) track(pending.name, { method: pending.method });
  }, [userId]);

  const signOut = useCallback(async () => {
    const supabase = await loadBrowserSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error("Could not sign out. Try again.");
    setUser(null);
  }, []);

  return { user, loading, signOut };
}
