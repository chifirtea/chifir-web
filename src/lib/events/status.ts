import type { CityEvent, CityEventPhase, Product } from "@/types/domain";

/**
 * Event and product timing is derived from the clock, never stored: a stored `status` only
 * matters when it is `cancelled`. Everything that shows a countdown, opens a pop-up or refuses a
 * pre-launch purchase goes through these functions.
 */

export function eventPhase(
  event: Pick<CityEvent, "startsAt" | "endsAt" | "status">,
  now: number,
): CityEventPhase {
  if (event.status === "cancelled") return "ended";
  if (now < Date.parse(event.startsAt)) return "scheduled";
  if (now < Date.parse(event.endsAt)) return "live";
  return "ended";
}

export function isEventLive(
  event: Pick<CityEvent, "startsAt" | "endsAt" | "status">,
  now: number,
): boolean {
  return eventPhase(event, now) === "live";
}

/** Milliseconds until the event starts (negative once it has). */
export function msUntilStart(event: Pick<CityEvent, "startsAt">, now: number): number {
  return Date.parse(event.startsAt) - now;
}

/**
 * The next instant at which any event's phase or any parcel's tenancy changes, or null when
 * nothing lies ahead. The client ticks its city index at that moment.
 */
export function nextPhaseChangeAt(
  events: ReadonlyArray<Pick<CityEvent, "startsAt" | "endsAt" | "status">>,
  parcels: ReadonlyArray<{ occupiedFrom?: string; occupiedUntil?: string }>,
  now: number,
): number | null {
  let next: number | null = null;
  const consider = (iso: string | undefined) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t <= now) return;
    if (next === null || t < next) next = t;
  };
  for (const e of events) {
    if (e.status === "cancelled") continue;
    consider(e.startsAt);
    consider(e.endsAt);
  }
  for (const p of parcels) {
    consider(p.occupiedFrom);
    consider(p.occupiedUntil);
  }
  return next;
}

export type ProductAvailability =
  | { state: "available" }
  | { state: "upcoming"; availableFrom: string }
  | { state: "closed"; availableUntil: string };

/** Whether a product can be bought at `now`. Inventory is a separate question (`variantProblem`). */
export function productAvailability(
  product: Pick<Product, "availableFrom" | "availableUntil">,
  now: number,
): ProductAvailability {
  if (product.availableFrom && now < Date.parse(product.availableFrom)) {
    return { state: "upcoming", availableFrom: product.availableFrom };
  }
  if (product.availableUntil && now >= Date.parse(product.availableUntil)) {
    return { state: "closed", availableUntil: product.availableUntil };
  }
  return { state: "available" };
}

export function isProductAvailable(
  product: Pick<Product, "availableFrom" | "availableUntil">,
  now: number,
): boolean {
  return productAvailability(product, now).state === "available";
}

/** "8:00 PM" in the viewer's zone; "Oct 3, 8:00 PM" when it is not today. */
export function formatLaunchTime(iso: string, now: number, locale?: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })}, ${time}`;
}

/** Human reason a product cannot be bought right now, or null. */
export function availabilityProblem(
  product: Pick<Product, "availableFrom" | "availableUntil">,
  now: number,
): string | null {
  const a = productAvailability(product, now);
  if (a.state === "upcoming") return `Drops at ${formatLaunchTime(a.availableFrom, now)}.`;
  if (a.state === "closed") return "This item is no longer available.";
  return null;
}

/** Whether a parcel's tenancy covers `now` (open-ended tenancy always does). */
export function parcelOccupiedAt(
  parcel: { occupiedFrom?: string; occupiedUntil?: string },
  now: number,
): boolean {
  if (parcel.occupiedFrom && Date.parse(parcel.occupiedFrom) > now) return false;
  if (parcel.occupiedUntil && Date.parse(parcel.occupiedUntil) <= now) return false;
  return true;
}
