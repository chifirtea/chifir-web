import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseAuth, publicEnv } from "@/lib/env";
import { authPath } from "@/features/auth/nextPath";

/** Routes that require a signed-in user. Everything else is public (guests can shop). */
const PROTECTED_PREFIXES = ["/account"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase session on every matched request (the @supabase/ssr pattern: read the
 * request cookies, write refreshed tokens to both the forwarded request and the response) and
 * sends signed-out visitors away from account pages. A no-op passthrough when accounts are off.
 */
export async function proxy(request: NextRequest) {
  if (!hasSupabaseAuth) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser() validates the token with Supabase and triggers a refresh when it has expired.
  // Never let an auth hiccup take the page down: treat failures as "signed out".
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch (error) {
    console.error("[proxy] session refresh failed", error);
  }

  const { pathname, search } = request.nextUrl;
  if (!signedIn && isProtected(pathname)) {
    const redirect = NextResponse.redirect(
      new URL(authPath("login", `${pathname}${search}`), request.url),
    );
    // Carry any refreshed cookies over to the redirect response.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - Next internals (_next/static, _next/image) and the favicon
     * - Stripe webhooks (the raw body must reach the handler untouched)
     * - static assets by extension (images, 3D models, textures, fonts)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|ktx2|woff2?)$).*)",
  ],
};
