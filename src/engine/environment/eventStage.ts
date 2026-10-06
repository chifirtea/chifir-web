import type { CityEvent, Parcel } from "@/types/domain";
import type { CityIndex } from "@/city/cityIndex";
import { eventPhase, msUntilStart } from "@/lib/events/status";

/**
 * Pure helpers behind Event Square: which event the big screen shows, when a crowd gathers for
 * an event, and what the screen says. Everything derives from the clock value passed in; nothing
 * reads a stored status.
 */

/** Default minutes before an event's start at which the crowd begins to gather. */
export const DEFAULT_GATHER_FROM_MIN = 30;
const MAX_GATHER_FROM_MIN = 24 * 60;

/** `config.gatherFrom` in minutes, validated; the default when absent or nonsensical. */
export function gatherFromMinutes(event: Pick<CityEvent, "config">): number {
  const raw = event.config["gatherFrom"];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GATHER_FROM_MIN;
  return Math.min(MAX_GATHER_FROM_MIN, n);
}

/** Whether a crowd should be standing in front of the event's parcel at `now`. */
export function isGathering(
  event: Pick<CityEvent, "startsAt" | "endsAt" | "status" | "config">,
  now: number,
): boolean {
  if (event.status === "cancelled") return false;
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start - gatherFromMinutes(event) * 60_000 && now < end;
}

/**
 * The next instant the gathering state of any of these events changes (crowd arrives, event
 * ends), or null. Event start/end boundaries already rebuild the index; this covers the earlier
 * "gather from" boundary.
 */
export function nextGatherChangeAt(
  events: ReadonlyArray<Pick<CityEvent, "startsAt" | "endsAt" | "status" | "config">>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const start = Date.parse(e.startsAt);
    const end = Date.parse(e.endsAt);
    for (const t of [start - gatherFromMinutes(e) * 60_000, end]) {
      if (Number.isNaN(t) || t <= now) continue;
      if (next === null || t < next) next = t;
    }
  }
  return next;
}

/** Live events first, then by start time; stable on ties. */
function byUrgency(now: number) {
  return (a: CityEvent, b: CityEvent): number => {
    const pa = eventPhase(a, now);
    const pb = eventPhase(b, now);
    if (pa !== pb) return pa === "live" ? -1 : 1;
    return Date.parse(a.startsAt) - Date.parse(b.startsAt);
  };
}

/**
 * The event a venue's big screen shows: the live or soonest event at any parcel in the venue's
 * district (the drop at the pop-up next door counts), else anywhere in the city, else null.
 */
export function stageEvent(index: CityIndex, venue: Parcel, now: number): CityEvent | null {
  const candidates = Object.entries(index.eventByParcel)
    .map(([parcelId, event]) => ({ parcel: index.parcelsById[parcelId], event }))
    .filter((c) => c.event.status !== "cancelled" && eventPhase(c.event, now) !== "ended");
  const local = candidates.filter((c) => c.parcel?.districtId === venue.districtId).map((c) => c.event);
  const pool = local.length > 0 ? local : candidates.map((c) => c.event);
  return [...pool].sort(byUrgency(now))[0] ?? null;
}

/** Events with a parcel whose crowd should be out right now. */
export function gatheringEvents(index: CityIndex, now: number): Array<{ event: CityEvent; parcel: Parcel }> {
  const out: Array<{ event: CityEvent; parcel: Parcel }> = [];
  for (const [parcelId, event] of Object.entries(index.eventByParcel)) {
    const parcel = index.parcelsById[parcelId];
    if (!parcel || !isGathering(event, now)) continue;
    out.push({ event, parcel });
  }
  return out.sort((a, b) => a.parcel.slug.localeCompare(b.parcel.slug));
}

export type ScreenMode = "idle" | "countdown" | "live";

export function screenMode(event: CityEvent | null, now: number): ScreenMode {
  if (!event) return "idle";
  const phase = eventPhase(event, now);
  if (phase === "live") return "live";
  if (phase === "scheduled") return "countdown";
  return "idle";
}

/** "00:14:59", or "2d 03:00:00" when more than a day away; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${hms}` : hms;
}

export function countdownFor(event: Pick<CityEvent, "startsAt">, now: number): string {
  return formatCountdown(msUntilStart(event, now));
}

/** Live/scheduled events city-wide, live first then soonest; phase from the clock. */
export function upcomingEventsAt(events: readonly CityEvent[], now: number): CityEvent[] {
  return events
    .filter((e) => e.status !== "cancelled" && eventPhase(e, now) !== "ended")
    .sort(byUrgency(now));
}
