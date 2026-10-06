/**
 * The one clock the city runs on. Countdowns, pop-up tenancy, product availability and event
 * phases all read `now()` so a demo can be rehearsed at any wall-clock time.
 *
 * The offset is process-global on the client (one tab, one clock). On the server it must never be
 * set: route handlers derive their `now` per request with `lib/time/serverClock.ts` instead.
 */

let offsetMs = 0;

export const CLOCK_HEADER = "x-chifir-clock-offset";
export const CLOCK_STORAGE_KEY = "chifir.clockOffset.v1";
/** `?clock=2026-10-01T19:58:00` (local wall time) or `?clock=+3600` (seconds from now). */
export const CLOCK_QUERY_PARAM = "clock";
/** Overrides more than a year either way are almost certainly mistakes. */
const MAX_OFFSET_MS = 366 * 24 * 3600_000;

export function now(): number {
  return Date.now() + offsetMs;
}

export function nowDate(): Date {
  return new Date(now());
}

export function clockOffsetMs(): number {
  return offsetMs;
}

export function setClockOffsetMs(ms: number): void {
  offsetMs = clampOffset(ms);
}

export function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(ms)));
}

/**
 * Parses a clock override into an offset from real time. Accepts an ISO date-time (interpreted
 * by the browser's/host's zone when it has no offset), an epoch in milliseconds, or a relative
 * `+900`/`-3600` in seconds. Returns null for anything else.
 */
export function parseClockOverride(
  value: string | null | undefined,
  realNow = Date.now(),
): number | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^[+-]\d{1,8}$/.test(v)) return clampOffset(Number(v) * 1000);
  if (/^\d{12,14}$/.test(v)) return clampOffset(Number(v) - realNow);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return clampOffset(t - realNow);
}

/** Parses the offset header a client sends so the server prices with the same clock. */
export function parseClockHeader(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (!/^-?\d{1,15}$/.test(v)) return null;
  return clampOffset(Number(v));
}
