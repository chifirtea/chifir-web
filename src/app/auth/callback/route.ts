import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { safeNextPath } from "@/features/auth/nextPath";
import {
  AUTH_EVENT_COOKIE,
  AUTH_EVENT_MAX_AGE_SECONDS,
  authFlowSchema,
  encodeAuthEvent,
} from "@/features/auth/authEvent";

export const runtime = "nodejs";

/**
 * Finishes magic-link and email-confirmation flows: exchanges the one-time `code` for a session
 * (cookies are written by the server client) and sends the visitor on to a sanitised `next`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const code = params.get("code");
  const flow = authFlowSchema.safeParse(params.get("flow"));

  const backToLogin = (reason: "link" | "missing_code") =>
    NextResponse.redirect(
      new URL(`/auth/login?error=${reason}&next=${encodeURIComponent(next)}`, request.url),
    );

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.redirect(new URL("/auth/login", request.url));
  if (!code) return backToLogin("missing_code");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("[auth] code exchange failed:", error.message);
    return backToLogin("link");
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  if (flow.success) {
    response.cookies.set({
      name: AUTH_EVENT_COOKIE,
      value: encodeAuthEvent(flow.data),
      path: "/",
      maxAge: AUTH_EVENT_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: false,
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}
