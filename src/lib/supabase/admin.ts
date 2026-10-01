import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS. Only ever used inside route handlers and server-side data
 * code; never pass its results to the client without filtering.
 */
export function getAdminSupabase(): SupabaseClient {
  if (!publicEnv.NEXT_PUBLIC_SUPABASE_URL || !serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin client requested but SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  if (!client) {
    client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}
