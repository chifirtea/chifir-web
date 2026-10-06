import type { OpeningHours, Weekday } from "@/types/domain";

/**
 * Open/closed status for the small window signs, derived from `merchant.openingHours` and the
 * city clock. Deliberately simple and client-safe (the search module's `isOpenNow` is server-only):
 * one status, one short label a sign can carry.
 */

export interface OpenStatus {
  open: boolean;
  /** "Open" | "Opens 11:30 AM" | "Closed" */
  label: string;
  /** "Until 11 PM" while open, "Back 11:30 AM" when closed and an opening is known. */
  detail?: string;
}

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "23:00" → "11 PM", "11:30" → "11:30 AM"; locale-independent so the sign reads the same everywhere. */
export function formatClock(hhmm: string): string {
  const total = ((toMinutes(hhmm) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Local weekday index and minutes-since-midnight of `now` in the merchant's zone. */
export function localClock(timezone: string, now: number): { day: number; minutes: number } {
  const date = new Date(now);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const minutes = Number(get("hour")) * 60 + Number(get("minute"));
    if (day >= 0 && Number.isFinite(minutes)) return { day, minutes };
  } catch {
    // Unknown zone: fall through to the viewer's local time.
  }
  return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
}

export function openStatus(hours: OpeningHours | undefined, now: number): OpenStatus | null {
  if (!hours) return null;
  const { day, minutes } = localClock(hours.timezone, now);
  const today = hours.weekly[WEEKDAYS[day]!] ?? [];
  const yesterday = hours.weekly[WEEKDAYS[(day + 6) % 7]!] ?? [];
  // An interval that closes after midnight still counts the morning after.
  for (const { open, close } of yesterday) {
    const o = toMinutes(open);
    const c = toMinutes(close);
    if (c <= o && minutes < c) return { open: true, label: "Open", detail: `Until ${formatClock(close)}` };
  }
  let nextOpen: string | null = null;
  for (const { open, close } of today) {
    const o = toMinutes(open);
    let c = toMinutes(close);
    if (c <= o) c += 24 * 60;
    if (minutes >= o && minutes < c) return { open: true, label: "Open", detail: `Until ${formatClock(close)}` };
    if (minutes < o && (nextOpen === null || o < toMinutes(nextOpen))) nextOpen = open;
  }
  if (nextOpen) return { open: false, label: `Opens ${formatClock(nextOpen)}`, detail: "Closed" };
  for (let i = 1; i <= 7; i++) {
    const first = (hours.weekly[WEEKDAYS[(day + i) % 7]!] ?? [])[0];
    if (first) return { open: false, label: "Closed", detail: `Back ${formatClock(first.open)}` };
  }
  return { open: false, label: "Closed" };
}

/**
 * The number on the door plate: the street number from the merchant's address when it has one,
 * else a stable number derived from where the parcel stands (so neighbours differ).
 */
export function houseNumber(addressLine1: string | undefined, position: { x: number; z: number }): string {
  const m = /^\s*(\d{1,5})\b/.exec(addressLine1 ?? "");
  if (m?.[1]) return m[1];
  const n = Math.abs(Math.round(position.x)) * 2 + Math.abs(Math.round(position.z)) + 10;
  return String(n);
}
