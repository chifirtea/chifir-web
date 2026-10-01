import "server-only";
import { features } from "@/lib/env.server";
import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * A client may only continue a conversation it owns. With Supabase configured this is checked
 * against `ai_conversations.user_id` using the admin client (RLS would otherwise hide the row from
 * the anonymous route context). In static mode conversations live in process memory (dev only),
 * so ownership is skipped.
 */
export async function assertConversationOwner(conversationId: string, userId: string): Promise<boolean> {
  if (!features.supabase) return true;
  try {
    const { data, error } = await getAdminSupabase()
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[ai] conversation ownership check failed", error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.error("[ai] conversation ownership check threw", err);
    return false;
  }
}
