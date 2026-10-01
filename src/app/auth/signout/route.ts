import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST only (a GET sign-out could be triggered by an image tag). Clears the session, then home. */
export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.warn("[auth] sign out failed:", error.message);
  }
  // 303 so the browser follows the redirect with GET after a form POST.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
