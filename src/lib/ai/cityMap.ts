import "server-only";
import type { CatalogSource } from "@/lib/data/types";
import { eventPhase, parcelOccupiedAt } from "@/lib/events/status";
import type { CityEvent, District, Merchant, Parcel } from "@/types/domain";

/**
 * The compact "map" the concierge carries in its cacheable system prompt: districts, which
 * merchants stand in each, and what is scheduled. It lets "take me to Event Square" or "somewhere
 * popular" resolve to real ids without a search round trip. Everything here is derived from the
 * same snapshot the UI renders, so the ids are guaranteed to exist on the client.
 */

export const DEFAULT_CITY_TIMEZONE = "America/Chicago";

export interface CityMapMerchant {
  id: string;
  name: string;
  type: Merchant["merchantType"];
  category: string;
  tags: string[];
  priceLevel?: number;
  rating?: number;
  ratingCount: number;
  sponsored: boolean;
  /** Present when the merchant also holds a time-boxed pop-up lot right now. */
  popupParcelId?: string;
}

export interface CityMapDistrict {
  id: string;
  name: string;
  slug: string;
  description: string;
  merchants: CityMapMerchant[];
}

export interface CityMapEvent {
  id: string;
  title: string;
  kind: CityEvent["kind"];
  phase: "scheduled" | "live";
  /** Wall-clock phrases in city time, e.g. "Today 8:00 PM". */
  starts: string;
  ends: string;
  districtName?: string;
  merchantId?: string;
  merchantName?: string;
  parcelId?: string;
  productIds: string[];
}

export interface CityMap {
  timezone: string;
  districts: CityMapDistrict[];
  events: CityMapEvent[];
}

/** The storefront parcel: the merchant's open-ended, non-billboard lot occupied now (else its pop-up). */
export function storefrontParcelFor(parcels: Parcel[], merchantId: string, now: number): Parcel | undefined {
  let best: Parcel | undefined;
  for (const parcel of parcels) {
    if (parcel.merchantId !== merchantId || parcel.tier === "billboard") continue;
    if (!parcelOccupiedAt(parcel, now)) continue;
    const openEnded = !parcel.occupiedFrom && !parcel.occupiedUntil;
    if (!best || (openEnded && (best.occupiedFrom || best.occupiedUntil))) best = parcel;
  }
  return best;
}

/** "8:00 PM" when the instant falls on the same local day as `now`, else "Oct 2, 8:00 PM". */
export function formatCityTime(iso: string, timeZone: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  let tz = timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = DEFAULT_CITY_TIMEZONE;
  }
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: tz, year: "numeric", month: "short", day: "numeric" });
  const time = at.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const sameDay = day(at) === day(now);
  const tomorrow = day(at) === day(new Date(now.getTime() + 86_400_000));
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${at.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}, ${time}`;
}

/** The merchants' shared zone (the seed city is one city); falls back to the default. */
export function cityTimezone(merchants: Pick<Merchant, "openingHours">[]): string {
  for (const m of merchants) if (m.openingHours?.timezone) return m.openingHours.timezone;
  return DEFAULT_CITY_TIMEZONE;
}

export async function buildCityMap(ds: CatalogSource, now: Date): Promise<CityMap> {
  const [districts, parcels, merchants, events] = await Promise.all([
    ds.listDistricts(),
    ds.listParcels(),
    ds.listMerchants(),
    ds.listEvents({ from: now.toISOString(), limit: 10 }),
  ]);
  const t = now.getTime();
  const timezone = cityTimezone(merchants);
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const districtById = new Map(districts.map((d) => [d.id, d]));

  const byDistrict = new Map<string, CityMapMerchant[]>();
  for (const m of merchants) {
    const home = storefrontParcelFor(parcels, m.id, t);
    if (!home) continue;
    const popup = parcels.find(
      (p) => p.merchantId === m.id && p.id !== home.id && p.tier !== "billboard" && parcelOccupiedAt(p, t),
    );
    const entry: CityMapMerchant = {
      id: m.id,
      name: m.name,
      type: m.merchantType,
      category: m.category,
      tags: m.tags.slice(0, 4),
      ...(m.priceLevel !== undefined ? { priceLevel: m.priceLevel } : {}),
      ...(m.rating !== undefined ? { rating: m.rating } : {}),
      ratingCount: m.ratingCount,
      sponsored: m.sponsored,
      ...(popup ? { popupParcelId: popup.id } : {}),
    };
    (byDistrict.get(home.districtId) ?? byDistrict.set(home.districtId, []).get(home.districtId)!).push(entry);
  }

  return {
    timezone,
    districts: [...districts]
      .sort((a: District, b: District) => a.sortOrder - b.sortOrder)
      .map((d) => ({
        id: d.id,
        name: d.name,
        slug: d.slug,
        description: d.description,
        merchants: byDistrict.get(d.id) ?? [],
      })),
    events: events
      .filter((e) => eventPhase(e, t) !== "ended")
      .map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        phase: eventPhase(e, t) === "live" ? "live" : "scheduled",
        starts: formatCityTime(e.startsAt, timezone, now),
        ends: formatCityTime(e.endsAt, timezone, now),
        ...(e.districtId && districtById.get(e.districtId) ? { districtName: districtById.get(e.districtId)!.name } : {}),
        ...(e.merchantId ? { merchantId: e.merchantId } : {}),
        ...(e.merchantId && merchantById.get(e.merchantId) ? { merchantName: merchantById.get(e.merchantId)!.name } : {}),
        ...(e.parcelId ? { parcelId: e.parcelId } : {}),
        productIds: e.productIds,
      })),
  };
}
