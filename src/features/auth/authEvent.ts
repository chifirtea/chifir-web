import { z } from "zod";

/**
 * Magic-link sign-ins complete in `/auth/callback`, where there is no browser to call `track()`.
 * The callback leaves a short-lived, non-httpOnly cookie describing what happened; `useUser`
 * reads it once on the next page and reports `login` / `signup` with method `magic_link`.
 */
export const AUTH_EVENT_COOKIE = "chifir.auth_event";
export const AUTH_EVENT_MAX_AGE_SECONDS = 120;

export const authFlowSchema = z.enum(["login", "signup"]);
export type AuthFlow = z.infer<typeof authFlowSchema>;

export interface AuthEvent {
  name: AuthFlow;
  method: "magic_link";
}

export function encodeAuthEvent(flow: AuthFlow): string {
  return `${flow}:magic_link`;
}

export function decodeAuthEvent(value: string | undefined | null): AuthEvent | null {
  if (!value) return null;
  const [flow, method] = value.split(":");
  const parsed = authFlowSchema.safeParse(flow);
  if (!parsed.success || method !== "magic_link") return null;
  return { name: parsed.data, method: "magic_link" };
}

/** Browser only: reads the pending auth event and clears the cookie. Null when there is none. */
export function consumeAuthEventCookie(): AuthEvent | null {
  if (typeof document === "undefined") return null;
  try {
    const raw = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AUTH_EVENT_COOKIE}=`));
    if (!raw) return null;
    const event = decodeAuthEvent(decodeURIComponent(raw.slice(AUTH_EVENT_COOKIE.length + 1)));
    document.cookie = `${AUTH_EVENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return event;
  } catch {
    return null;
  }
}
