"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseAuth, publicEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + RLS). Returns null when Supabase is not configured. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (!hasSupabaseAuth) return null;
  if (!client) {
    client = createBrowserClient(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
