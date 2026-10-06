/**
 * Post-auth redirect targets come from the URL (`?next=`), so they are untrusted. Only a
 * same-origin absolute path is accepted: it must start with exactly one "/", and it may not be
 * a protocol-relative URL ("//evil.example"), a backslash trick ("/\evil"), contain control
 * characters, or point back into the auth pages (which would loop).
 */
export const DEFAULT_NEXT_PATH = "/city";

const MAX_LENGTH = 512;

export function safeNextPath(input: unknown, fallback: string = DEFAULT_NEXT_PATH): string {
  if (typeof input !== "string") return fallback;
  const path = input.trim();
  if (path.length === 0 || path.length > MAX_LENGTH) return fallback;
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;
  if (path === "/auth" || path.startsWith("/auth/")) return fallback;
  return path;
}

/** Builds `/auth/login?next=…` (or signup) for a given return path. */
export function authPath(page: "login" | "signup", next?: string | null): string {
  const target = safeNextPath(next);
  return target === DEFAULT_NEXT_PATH
    ? `/auth/${page}`
    : `/auth/${page}?next=${encodeURIComponent(target)}`;
}
