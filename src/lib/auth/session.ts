import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email?: string;
  displayName?: string;
}

/** The signed-in user for this request, or null (also null when Supabase is not configured). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const meta = data.user.user_metadata as Record<string, unknown> | null;
  return {
    id: data.user.id,
    ...(data.user.email ? { email: data.user.email } : {}),
    ...(typeof meta?.display_name === "string" ? { displayName: meta.display_name } : {}),
  };
}
