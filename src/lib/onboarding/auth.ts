import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";

/**
 * Admin gate for the merchant generator. With `ADMIN_ACCESS_TOKEN` set, a request must carry
 * `authorization: Bearer <token>` or the `chifir_admin` cookie (set by POST /api/admin/session).
 * Without a token, admin is open outside production and does not exist (404) in production.
 * The token is compared in constant time and never logged.
 */

export const ADMIN_COOKIE = "chifir_admin";
export const ADMIN_COOKIE_MAX_AGE_S = 12 * 60 * 60;

export type AdminGate = "ok" | "unauthorized" | "not_found";

export interface AdminGateInput {
  configuredToken: string | undefined;
  isProduction: boolean;
  authorization: string | null;
  cookie: string | undefined;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time equality (both sides hashed so lengths never leak). */
export function tokensMatch(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function bearerToken(authorization: string | null): string | undefined {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1];
}

export function adminGate(input: AdminGateInput): AdminGate {
  if (!input.configuredToken) return input.isProduction ? "not_found" : "ok";
  if (tokensMatch(bearerToken(input.authorization), input.configuredToken)) return "ok";
  if (tokensMatch(input.cookie, input.configuredToken)) return "ok";
  return "unauthorized";
}

const isProduction = () => serverEnv.NODE_ENV === "production";

/** Returns a response to send when the request is not admin, or null when it may proceed. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const gate = adminGate({
    configuredToken: serverEnv.ADMIN_ACCESS_TOKEN,
    isProduction: isProduction(),
    authorization: req.headers.get("authorization"),
    cookie: req.cookies.get(ADMIN_COOKIE)?.value,
  });
  if (gate === "ok") return null;
  if (gate === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { error: "Admin access required." },
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE_S,
  };
}

export interface AdminPageAccess {
  /** A token is configured, so API calls need the cookie. */
  tokenRequired: boolean;
  /** This request already carries a valid cookie. */
  authenticated: boolean;
}

/** For the admin page shell (server component): whether to show the token prompt. */
export async function adminPageAccess(): Promise<AdminPageAccess> {
  const token = serverEnv.ADMIN_ACCESS_TOKEN;
  if (!token) return { tokenRequired: false, authenticated: true };
  const store = await cookies();
  return { tokenRequired: true, authenticated: tokensMatch(store.get(ADMIN_COOKIE)?.value, token) };
}
