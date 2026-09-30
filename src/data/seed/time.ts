/**
 * Seed helpers for relative dates so demo events are always "this week", computed in the
 * merchant's IANA time zone rather than the process zone.
 */

function zoneOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** Local wall-clock components of `at` in `tz`. */
function zonedParts(tz: string, at: Date): { y: number; m: number; d: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday };
}

/** The instant of `hour:minute` local time in `tz` on the local calendar day of `at` (+ dayOffset). */
export function zonedTime(tz: string, hour: number, minute = 0, at = new Date(), dayOffset = 0): Date {
  const { y, m, d } = zonedParts(tz, at);
  const guess = new Date(Date.UTC(y, m - 1, d + dayOffset, hour, minute, 0, 0));
  const offset = zoneOffsetMinutes(tz, guess);
  return new Date(guess.getTime() - offset * 60_000);
}

export function todayAt(tz: string, hour: number, minute = 0, from = new Date()): Date {
  return zonedTime(tz, hour, minute, from, 0);
}

export function upcomingWeekdayAt(tz: string, weekday: number, hour: number, minute = 0, from = new Date()): Date {
  const { weekday: today } = zonedParts(tz, from);
  let delta = (weekday - today + 7) % 7;
  let candidate = zonedTime(tz, hour, minute, from, delta);
  if (candidate.getTime() < from.getTime()) {
    delta += 7;
    candidate = zonedTime(tz, hour, minute, from, delta);
  }
  return candidate;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export const CITY_TZ = "America/Chicago";
