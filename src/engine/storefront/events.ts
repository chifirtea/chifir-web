import type { CityEvent } from "@/types/domain";

/** Next live or scheduled event tied to a merchant or parcel: live first, then soonest start. */
export function nextEventFor(events: CityEvent[], merchantId?: string, parcelId?: string): CityEvent | null {
  const upcoming = events
    .filter((e) => (e.status === "live" || e.status === "scheduled") && ((merchantId && e.merchantId === merchantId) || (parcelId && e.parcelId === parcelId)))
    .sort(byUrgency);
  return upcoming[0] ?? null;
}

/** All live/scheduled events, live first, then soonest start. */
export function upcomingEvents(events: CityEvent[]): CityEvent[] {
  return events.filter((e) => e.status === "live" || e.status === "scheduled").sort(byUrgency);
}

function byUrgency(a: CityEvent, b: CityEvent): number {
  if (a.status !== b.status) return a.status === "live" ? -1 : 1;
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

export function isSameLocalDay(iso: string, now = Date.now()): boolean {
  return new Date(iso).toDateString() === new Date(now).toDateString();
}

/** "Live now", "Tonight · 7:00 PM" or "Friday · 9:00 PM". */
export function eventTimeLabel(event: CityEvent, now = Date.now()): string {
  if (event.status === "live") return "Live now";
  const start = new Date(event.startsAt);
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isSameLocalDay(event.startsAt, now)) return `Tonight · ${time}`;
  return `${start.toLocaleDateString(undefined, { weekday: "long" })} · ${time}`;
}

/** Hotspot label for an event at a venue: "Tonight at The Hall" / "Live now at The Hall" / "Friday at The Hall". */
export function eventHotspotLabel(event: CityEvent, venueName: string, now = Date.now()): string {
  if (event.status === "live") return `Live now at ${venueName}`;
  if (isSameLocalDay(event.startsAt, now)) return `Tonight at ${venueName}`;
  const day = new Date(event.startsAt).toLocaleDateString(undefined, { weekday: "long" });
  return `${day} at ${venueName}`;
}
