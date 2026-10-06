import type { FulfillmentOptions, OpeningHours, OpeningInterval, Weekday } from "@/types/domain";

/**
 * Client-safe opening-hours phrasing for the HUD and landing cards: "Open · closes 11 PM",
 * "Opens 5 PM", "Opens tomorrow 11 AM". The server-side search helper (`isOpenNow`) is the
 * authority for filtering; this module states the same rule in words, in the merchant's zone.
 */

const DAY = 24 * 60;
const WEEKDAYS: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const INTL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_NAMES: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

export interface OpenStatus {
  open: boolean;
  /** Sentence-case phrase ready to render. */
  label: string;
  /** "HH:MM" the label refers to: the closing time when open, the next opening time otherwise. */
  at?: string;
}

/** Local wall clock of `now` in `timeZone`: weekday index (0 = Sunday) and minutes since midnight. */
function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
    const day = INTL_WEEKDAYS.indexOf((get("weekday") ?? "") as (typeof INTL_WEEKDAYS)[number]);
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    if (day < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error("bad clock");
    return { day, minutes: hour * 60 + minute };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function sorted(intervals: OpeningInterval[] | undefined): OpeningInterval[] {
  return [...(intervals ?? [])].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
}

/** "19:00" → "7 PM", "22:30" → "10:30 PM", "00:00"/"23:59"/"24:00" → "midnight", "12:00" → "noon". */
export function formatClock(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  if ((h === 0 || h === 24) && m === 0) return "midnight";
  if (h === 23 && m === 59) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const suffix = h % 24 < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function openNowStatus(
  hours: OpeningHours | undefined,
  now: Date = new Date(),
): OpenStatus | null {
  if (!hours) return null;
  const { day, minutes } = localClock(now, hours.timezone);
  const today = WEEKDAYS[day]!;
  const yesterday = WEEKDAYS[(day + 6) % 7]!;

  // Yesterday's intervals that run past midnight ("open until 1 AM").
  for (const it of hours.weekly[yesterday] ?? []) {
    const o = toMinutes(it.open);
    let c = toMinutes(it.close);
    if (c <= o) c += DAY;
    if (minutes + DAY >= o && minutes + DAY < c) {
      return { open: true, label: `Open · closes ${formatClock(it.close)}`, at: it.close };
    }
  }

  const todays = sorted(hours.weekly[today]);
  for (const it of todays) {
    const o = toMinutes(it.open);
    let c = toMinutes(it.close);
    if (c <= o) c += DAY;
    if (minutes >= o && minutes < c) {
      return { open: true, label: `Open · closes ${formatClock(it.close)}`, at: it.close };
    }
  }

  const later = todays.find((it) => toMinutes(it.open) > minutes);
  if (later) return { open: false, label: `Opens ${formatClock(later.open)}`, at: later.open };

  for (let offset = 1; offset <= 6; offset++) {
    const key = WEEKDAYS[(day + offset) % 7]!;
    const first = sorted(hours.weekly[key])[0];
    if (first) {
      const when = offset === 1 ? "tomorrow" : SHORT_NAMES[key];
      return { open: false, label: `Opens ${when} ${formatClock(first.open)}`, at: first.open };
    }
  }
  return { open: false, label: "Closed" };
}

/** The phrase alone, or null when the merchant publishes no hours. */
export function openNowLabel(
  hours: OpeningHours | undefined,
  now: Date = new Date(),
): string | null {
  return openNowStatus(hours, now)?.label ?? null;
}

/** 1 → "$", 4 → "$$$$". */
export function priceLevelLabel(level: 1 | 2 | 3 | 4 | undefined): string | null {
  return level ? "$".repeat(level) : null;
}

/** "25–40 min delivery", "15–20 min pickup", "3–5 day shipping", "Bookings", or null. */
export function fulfillmentEtaLabel(f: FulfillmentOptions | undefined): string | null {
  if (!f) return null;
  if (f.delivery?.enabled) return `${f.delivery.minutesMin}–${f.delivery.minutesMax} min delivery`;
  if (f.pickup?.enabled) return `${f.pickup.minutesMin}–${f.pickup.minutesMax} min pickup`;
  if (f.shipping?.enabled) return `${f.shipping.daysMin}–${f.shipping.daysMax} day shipping`;
  if (f.booking?.enabled) return "Bookings";
  return null;
}
