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

/** Lookup structures over a CitySnapshot. Built once per snapshot on the client and server. */
export interface CityIndex {
  snapshot: CitySnapshot;
  districtsById: Record<string, District>;
  districtsBySlug: Record<string, District>;
  parcelsById: Record<string, Parcel>;
  parcelsBySlug: Record<string, Parcel>;
  /** All parcels a merchant holds (store, billboard, pop-up). */
  parcelsByMerchant: Record<string, Parcel[]>;
  /** The parcel that has the merchant's storefront: first non-billboard, currently occupied. */
  parcelByMerchant: Record<string, Parcel>;
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

export function buildCityIndex(snapshot: CitySnapshot): CityIndex {
  const publishedMerchants = snapshot.merchants.filter((m) => m.status === "published");
  const activeProducts = snapshot.products
    .filter((p) => p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const now = Date.now();
  const occupiedNow = (p: Parcel) =>
    (!p.occupiedFrom || Date.parse(p.occupiedFrom) <= now) && (!p.occupiedUntil || Date.parse(p.occupiedUntil) > now);
  const parcelsByMerchant: Record<string, Parcel[]> = {};
  const parcelByMerchant: Record<string, Parcel> = {};
  for (const parcel of snapshot.parcels) {
    if (!parcel.merchantId) continue;
    (parcelsByMerchant[parcel.merchantId] ??= []).push(parcel);
    if (parcel.tier !== "billboard" && occupiedNow(parcel) && !parcelByMerchant[parcel.merchantId]) {
      parcelByMerchant[parcel.merchantId] = parcel;
    }
  }
  return {
    snapshot,
    districtsById: byKey(snapshot.districts, (d) => d.id),
    districtsBySlug: byKey(snapshot.districts, (d) => d.slug),
    parcelsById: byKey(snapshot.parcels, (p) => p.id),
    parcelsBySlug: byKey(snapshot.parcels, (p) => p.slug),
    parcelsByMerchant,
    parcelByMerchant,
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

/** Published merchants that occupy a parcel in the given district. */
export function merchantsInDistrict(index: CityIndex, districtId: string): Merchant[] {
  return index.snapshot.parcels
    .filter((p) => p.districtId === districtId && p.merchantId && index.merchantsById[p.merchantId])
    .map((p) => index.merchantsById[p.merchantId!]!);
}

/** The district whose bounds contain the point, else null. */
export function districtAt(index: CityIndex, x: number, z: number): District | null {
  for (const d of index.snapshot.districts) {
    const b = d.bounds;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return d;
  }
  return null;
}
