import type { Merchant, OpeningHours, Parcel, Product, Weekday } from "@/types/domain";
import type { MerchantSearchParams, ProductSearchParams } from "./types";

/**
 * Pure filtering used by the static data source and by unit tests. The Supabase implementation
 * applies the same semantics in SQL (see search_products in the migration).
 */

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function isOpenNow(hours: OpeningHours | undefined, now = new Date()): boolean | undefined {
  if (!hours) return undefined;
  let local: Date;
  try {
    local = new Date(now.toLocaleString("en-US", { timeZone: hours.timezone }));
  } catch {
    local = now;
  }
  const day = WEEKDAYS[local.getDay()]!;
  const intervals = hours.weekly[day] ?? [];
  const minutes = local.getHours() * 60 + local.getMinutes();
  for (const { open, close } of intervals) {
    const o = toMinutes(open);
    let c = toMinutes(close);
    if (c <= o) c += 24 * 60; // closes after midnight
    if (minutes >= o && minutes < c) return true;
    if (minutes + 24 * 60 >= o && minutes + 24 * 60 < c) return true;
  }
  return false;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function textScore(haystack: string, query: string | undefined): number {
  if (!query) return 0;
  const hay = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens(query)) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

/**
 * Popularity = rating weighted by how many people it rests on (log scale), so a 4.6 with a
 * thousand reviews outranks a 4.9 with twelve. Unrated merchants score 0.
 */
export function popularityScore(m: Pick<Merchant, "rating" | "ratingCount">): number {
  if (m.rating === undefined) return 0;
  return m.rating * Math.log(Math.max(0, m.ratingCount) + 1);
}

function comparePopular(a: Merchant, b: Merchant): number {
  return (
    popularityScore(b) - popularityScore(a) ||
    Number(b.sponsored) - Number(a.sponsored) ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export function filterMerchants(merchants: Merchant[], parcels: Parcel[], params: MerchantSearchParams): Merchant[] {
  const parcelByMerchant = new Map(parcels.filter((p) => p.merchantId).map((p) => [p.merchantId!, p]));
  const popular = params.sort === "popular";
  const scored = merchants
    .filter((m) => !params.merchantType || m.merchantType === params.merchantType)
    .filter((m) => !params.category || m.category === params.category || m.category.startsWith(`${params.category}.`))
    .filter((m) => !params.districtId || parcelByMerchant.get(m.id)?.districtId === params.districtId)
    .filter((m) => params.maxPriceLevel === undefined || (m.priceLevel ?? 2) <= params.maxPriceLevel)
    .filter((m) => !params.tags?.length || params.tags.some((t) => m.tags.includes(t)))
    .filter((m) => !params.openNow || isOpenNow(m.openingHours) !== false)
    .map((m) => ({
      m,
      score: textScore(`${m.name} ${m.tagline ?? ""} ${m.category} ${m.tags.join(" ")} ${m.description}`, params.query),
    }))
    .filter((x) => !params.query || x.score > 0)
    .sort((a, b) =>
      popular ? comparePopular(a.m, b.m) : b.score - a.score || (b.m.rating ?? 0) - (a.m.rating ?? 0),
    );
  return scored.slice(0, params.limit ?? 20).map((x) => x.m);
}

export function filterProducts(products: Product[], merchants: Merchant[], params: ProductSearchParams): Product[] {
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const merchantIds = params.merchantIds ? new Set(params.merchantIds) : null;
  const scored = products
    .filter((p) => !merchantIds || merchantIds.has(p.merchantId))
    .filter((p) => !params.merchantType || merchantById.get(p.merchantId)?.merchantType === params.merchantType)
    .filter((p) => !params.category || p.category === params.category || merchantById.get(p.merchantId)?.category.startsWith(params.category))
    .filter((p) => params.maxPriceCents === undefined || p.priceCents <= params.maxPriceCents)
    .filter((p) => params.minPriceCents === undefined || p.priceCents >= params.minPriceCents)
    .filter((p) => !params.dietary?.length || params.dietary.every((d) => p.attributes.dietary?.includes(d)))
    .filter((p) => params.minSpiceLevel === undefined || (p.attributes.spiceLevel ?? 0) >= params.minSpiceLevel)
    .filter((p) => !params.occasion || p.attributes.occasion?.some((o) => o.includes(params.occasion!.toLowerCase())) || p.tags.includes(params.occasion.toLowerCase()))
    .filter((p) => !params.fulfillmentType || p.fulfillmentTypes.includes(params.fulfillmentType))
    .filter((p) => !params.tags?.length || params.tags.some((t) => p.tags.includes(t)))
    .filter((p) => !(params.inStockOnly ?? true) || p.inventoryStatus !== "out_of_stock")
    .map((p) => {
      const merchant = merchantById.get(p.merchantId);
      const hay = `${p.title} ${p.category} ${p.tags.join(" ")} ${p.description} ${merchant?.name ?? ""} ${merchant?.category ?? ""} ${merchant?.tags.join(" ") ?? ""}`;
      return { p, score: textScore(hay, params.query) + (p.featured ? 0.5 : 0) };
    })
    .filter((x) => !params.query || x.score >= 1)
    .sort((a, b) => b.score - a.score || a.p.sortOrder - b.p.sortOrder);
  return scored.slice(0, Math.min(params.limit ?? 20, 50)).map((x) => x.p);
}
