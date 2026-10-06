import "server-only";
import { serverEnv } from "@/lib/env.server";

/**
 * Loopback fetches for the generator are a development convenience (a fixture store on another
 * port). Two switches, both ignored in production: the `ONBOARDING_ALLOW_LOCAL=1` server env, or
 * `?allowLocal=1` on the extract route. `env.server.ts` is shared and not extended for this.
 */
export function localFetchAllowed(queryFlag: boolean): boolean {
  if (serverEnv.NODE_ENV === "production") return false;
  return queryFlag || process.env.ONBOARDING_ALLOW_LOCAL === "1";
}
