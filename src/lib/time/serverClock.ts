import "server-only";
import { features } from "@/lib/env.server";
import { parseClockHeader, CLOCK_HEADER } from "./clock";

/**
 * Per-request "now" for route handlers. Honours the client's demo clock offset only when the
 * deployment allows it (`features.demoClock`); production ignores the header entirely.
 */
export function requestNow(req: { headers: { get(name: string): string | null } }): Date {
  if (!features.demoClock) return new Date();
  const offset = parseClockHeader(req.headers.get(CLOCK_HEADER));
  return new Date(Date.now() + (offset ?? 0));
}

/** Same rule for a raw override value (the `?clock=` query on a page). */
export function allowClockOverride(): boolean {
  return features.demoClock;
}
