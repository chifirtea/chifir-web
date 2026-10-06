import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { ADMIN_COOKIE, adminCookieOptions, refuseCrossSite, tokensMatch } from "@/lib/onboarding/auth";
import type { SessionResponse } from "@/lib/onboarding/api";
import { adminError, adminJson, parseAdminBody } from "@/lib/onboarding/http";
import { adminSessionSchema } from "@/lib/validation/merchantDraft";

export const runtime = "nodejs";

/**
 * POST /api/admin/session { token } → sets the `chifir_admin` cookie when the token matches
 * `ADMIN_ACCESS_TOKEN`. Without a configured token: a no-op outside production, 404 in production.
 */
export async function POST(req: NextRequest) {
  const crossSite = refuseCrossSite(req);
  if (crossSite) return crossSite;
  const expected = serverEnv.ADMIN_ACCESS_TOKEN;
  if (!expected) {
    if (serverEnv.NODE_ENV === "production") return adminError(404, "Not found");
    return adminJson<SessionResponse>({ ok: true, required: false });
  }
  const body = await parseAdminBody(req, adminSessionSchema);
  if (!body.ok) return body.response;
  if (!tokensMatch(body.data.token, expected)) return adminError(401, "That token is not valid.");
  const res = NextResponse.json<SessionResponse>({ ok: true, required: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, expected, adminCookieOptions());
  return res;
}

/** DELETE /api/admin/session → clears the cookie. */
export async function DELETE(req: NextRequest) {
  const crossSite = refuseCrossSite(req);
  if (crossSite) return crossSite;
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
  return res;
}
