import type {
  AiEmployeePublic,
  CityEvent,
  DigitalReward,
  District,
  Merchant,
  Offer,
  Parcel,
  Product,
} from "@/types/domain";
import type { CitySnapshot } from "@/lib/data/types";
import { eventPhase, parcelOccupiedAt } from "@/lib/events/status";

/**
 * Lookup structures over a CitySnapshot. Built per snapshot and per "phase" of the clock: the
 * client rebuilds it whenever an event starts/ends or a pop-up tenancy opens/closes.
 */
export interface CityIndex {
  snapshot: CitySnapshot;
  /** The clock value the index was built for. */
  builtAt: number;
  districtsById: Record<string, District>;
  districtsBySlug: Record<string, District>;
  parcelsById: Record<string, Parcel>;
  parcelsBySlug: Record<string, Parcel>;
  /** All parcels a merchant holds (store, billboard, pop-up). */
  parcelsByMerchant: Record<string, Parcel[]>;
  /**
   * The parcel that has the merchant's permanent storefront: first non-billboard parcel with an
   * open-ended tenancy, else the first one occupied now (a pop-up-only brand).
   */
  parcelByMerchant: Record<string, Parcel>;
  /** Every non-billboard parcel occupied *now* by a published merchant (storefronts + pop-ups). */
  occupiedParcels: Parcel[];
  /** The live or next scheduled event attached to a parcel (pop-ups, venues). */
  eventByParcel: Record<string, CityEvent>;
  merchantsById: Record<string, Merchant>;
  merchantsBySlug: Record<string, Merchant>;
  productsById: Record<string, Product>;
  productsByMerchant: Record<string, Product[]>;
  employeesByMerchant: Record<string, AiEmployeePublic>;
  eventsById: Record<string, CityEvent>;
  eventsBySlug: Record<string, CityEvent>;
  offersByMerchant: Record<string, Offer[]>;
  rewardsById: Record<string, DigitalReward>;
}

function byKey<T>(items: T[], key: (t: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) (out[key(item)] ??= []).push(item);
  return out;
}

export function buildCityIndex(snapshot: CitySnapshot, now: number = Date.now()): CityIndex {
  const publishedMerchants = snapshot.merchants.filter((m) => m.status === "published");
  const publishedIds = new Set(publishedMerchants.map((m) => m.id));
  const activeProducts = snapshot.products
    .filter((p) => p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const parcelsByMerchant: Record<string, Parcel[]> = {};
  const parcelByMerchant: Record<string, Parcel> = {};
  const occupiedParcels: Parcel[] = [];
  for (const parcel of snapshot.parcels) {
    if (!parcel.merchantId) continue;
    (parcelsByMerchant[parcel.merchantId] ??= []).push(parcel);
    if (parcel.tier === "billboard") continue;
    const occupied = parcelOccupiedAt(parcel, now);
    if (occupied && publishedIds.has(parcel.merchantId)) occupiedParcels.push(parcel);
    const openEnded = !parcel.occupiedFrom && !parcel.occupiedUntil;
    const current = parcelByMerchant[parcel.merchantId];
    if (occupied && (!current || (openEnded && (current.occupiedFrom || current.occupiedUntil)))) {
      parcelByMerchant[parcel.merchantId] = parcel;
    }
  }
  const eventByParcel: Record<string, CityEvent> = {};
  const byStart = [...snapshot.events]
    .filter((e) => e.parcelId && e.status !== "cancelled" && eventPhase(e, now) !== "ended")
    .sort((a, b) => {
      const pa = eventPhase(a, now);
      const pb = eventPhase(b, now);
      if (pa !== pb) return pa === "live" ? -1 : 1;
      return Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
  for (const e of byStart)
    if (e.parcelId && !eventByParcel[e.parcelId]) eventByParcel[e.parcelId] = e;
  return {
    snapshot,
    builtAt: now,
    districtsById: byKey(snapshot.districts, (d) => d.id),
    districtsBySlug: byKey(snapshot.districts, (d) => d.slug),
    parcelsById: byKey(snapshot.parcels, (p) => p.id),
    parcelsBySlug: byKey(snapshot.parcels, (p) => p.slug),
    parcelsByMerchant,
    parcelByMerchant,
    occupiedParcels,
    eventByParcel,
    merchantsById: byKey(publishedMerchants, (m) => m.id),
    merchantsBySlug: byKey(publishedMerchants, (m) => m.slug),
    productsById: byKey(activeProducts, (p) => p.id),
    productsByMerchant: groupBy(activeProducts, (p) => p.merchantId),
    employeesByMerchant: byKey(snapshot.employees, (e) => e.merchantId),
    eventsById: byKey(snapshot.events, (e) => e.id),
    eventsBySlug: byKey(snapshot.events, (e) => e.slug),
    offersByMerchant: groupBy(snapshot.offers, (o) => o.merchantId),
    rewardsById: byKey(snapshot.rewards, (r) => r.id),
  };
}

/** Published merchants that occupy a parcel in the given district right now (pop-ups included). */
export function merchantsInDistrict(index: CityIndex, districtId: string): Merchant[] {
  const seen = new Set<string>();
  const out: Merchant[] = [];
  for (const p of index.occupiedParcels) {
    if (p.districtId !== districtId || !p.merchantId || seen.has(p.merchantId)) continue;
    const m = index.merchantsById[p.merchantId];
    if (!m) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Products shown at a parcel: an event pop-up shows its collection, a storefront the whole catalog. */
export function productsAtParcel(index: CityIndex, parcel: Parcel): Product[] {
  const merchantId = parcel.merchantId;
  if (!merchantId) return [];
  const all = index.productsByMerchant[merchantId] ?? [];
  const event = index.eventByParcel[parcel.id];
  if (
    event &&
    event.productIds.length > 0 &&
    parcel.id !== index.parcelByMerchant[merchantId]?.id
  ) {
    const set = new Set(event.productIds);
    const collection = all.filter((p) => set.has(p.id));
    if (collection.length > 0) return collection;
  }
  return all;
}

/** The district whose bounds contain the point, else null. */
export function districtAt(index: CityIndex, x: number, z: number): District | null {
  for (const d of index.snapshot.districts) {
    const b = d.bounds;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return d;
  }
  return null;
}
