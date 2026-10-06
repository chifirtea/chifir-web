"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseAuth, publicEnv } from "@/lib/env";

let client: Promise<SupabaseClient | null> | null = null;

/**
 * Browser Supabase client (anon key + RLS), or null when Supabase is not configured. The SDK is
 * imported on first use so the `/city` first-load chunk never carries it: a static-mode city has
 * no accounts and no realtime, and a configured one pays for the SDK only once it is needed.
 */
export function loadBrowserSupabase(): Promise<SupabaseClient | null> {
  if (!hasSupabaseAuth) return Promise.resolve(null);
  if (!client) {
    client = import("@supabase/ssr").then((m) =>
      m.createBrowserClient(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    );
    // A failed chunk load must not poison every later call.
    client.catch(() => {
      client = null;
    });
  }
  return client;
}
