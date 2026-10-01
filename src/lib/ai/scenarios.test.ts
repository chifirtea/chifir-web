import { describe, expect, it } from "vitest";
import { buildCitySnapshot } from "@/data/seed";
import { sid } from "@/data/seed/ids";
import { NIGHT_SHIFT_SLUGS } from "@/data/seed/products";
import { dropWindow } from "@/data/seed/time";
import { filterMerchants, popularityScore } from "@/lib/data/search";
import { StaticDataSource } from "@/lib/data/static";
import type { Merchant, Offer } from "@/types/domain";
import type { AIAction, ChatStreamEvent } from "./actions";
import { buildCityMap, formatCityTime, storefrontParcelFor } from "./cityMap";
import {
  conciergeTools,
  employeeTools,
  highlightStorefront,
  openMerchant,
  openProduct,
  recommend,
  searchMerchants,
  searchProducts,
  type ProductFactWithOffer,
  type ToolContext,
} from "./tools";

/**
 * The four founder scenarios, executed against the seed through the real tool executors (no model):
 * what the AI would receive as facts, and which actions/cards leave the server.
 */

// Wednesday 18:30 in Chicago: the Night Shift drop is tonight at 8 PM and not purchasable yet.
const NOW = new Date("2026-09-30T23:30:00Z");
const snapshot = buildCitySnapshot(NOW);
const drop = dropWindow(NOW);

class FixedClockSource extends StaticDataSource {
  override async listOffers(merchantId?: string): Promise<Offer[]> {
    const t = NOW.getTime();
    return snapshot.offers.filter(
      (o) => o.active && (!merchantId || o.merchantId === merchantId) && Date.parse(o.startsAt) <= t && Date.parse(o.endsAt) >= t,
    );
  }
}

const EMBER = sid.merchant("ember-and-oak");
const SAFFRON = sid.merchant("saffron-alley");
const KORI = sid.merchant("kori-ramen");
const VERDE = sid.merchant("verde-bowl");
const NORTHLINE = sid.merchant("northline-supply");
const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
const VINDALOO = sid.product("saffron-alley", "vindaloo-bowl");
const SPICY_MISO = sid.product("kori-ramen", "spicy-miso");
const MERIDIAN = sid.product("northline-supply", "meridian-hoodie");
const NIGHT_SHIFT_INK = sid.product("northline-supply", "night-shift-hoodie-ink");
const NIGHT_SHIFT = NIGHT_SHIFT_SLUGS.map((s) => sid.product("northline-supply", s));
const EMBER_PARCEL = sid.parcel("fs-n1");
const NORTHLINE_FLAGSHIP = sid.parcel("fa-n2");

function makeCtx(overrides: Partial<ToolContext> = {}) {
  const events: ChatStreamEvent[] = [];
  const ctx: ToolContext = { ds: new FixedClockSource(snapshot), emit: (e) => events.push(e), now: NOW, scope: "concierge", ...overrides };
  const actions = () => events.filter((e): e is Extract<ChatStreamEvent, { type: "action" }> => e.type === "action").map((e) => e.action);
  const productCards = () => events.flatMap((e) => (e.type === "cards" ? (e.products ?? []) : []));
  const merchantCards = () => events.flatMap((e) => (e.type === "cards" ? (e.merchants ?? []) : []));
  return { ctx, events, actions, productCards, merchantCards };
}

const parse = <T>(content: string): T => JSON.parse(content) as T;
type ProductsBody = { count: number; products: ProductFactWithOffer[]; note?: string };

describe("scenario 1: spicy food under $25", () => {
  it("search_products returns the three true answers as purchasable facts with inventory", async () => {
    const { ctx, productCards } = makeCtx();
    const res = await searchProducts.execute({ minSpiceLevel: 2, maxPriceCents: 2500 }, ctx);
    const body = parse<ProductsBody>(res.content);
    const ids = body.products.map((p) => p.id);
    // Every matching product survives compaction (11 in the seed): prose is dropped before entities.
    expect(body.count).toBe(11);
    expect(ids).toEqual(expect.arrayContaining([HELLFIRE, VINDALOO, SPICY_MISO]));
    expect(res.content.length).toBeLessThanOrEqual(6000);
    for (const p of body.products) {
      expect(p.priceCents).toBeLessThanOrEqual(2500);
      expect(p.spiceLevel ?? 0).toBeGreaterThanOrEqual(2);
      expect(p.inventoryStatus).toBeDefined();
      expect(p.purchasableNow).toBe(true);
      expect(p.availabilityNote).toBeUndefined();
      expect(p.serves).toBeDefined();
    }
    expect(productCards().map((c) => c.id)).toEqual(ids);
    expect(body.note).toBeUndefined();
  });

  it("highlight_storefront resolves the restaurant's door parcel and emits an action with ids only", async () => {
    const { ctx, actions } = makeCtx();
    const res = await highlightStorefront.execute({ merchantId: EMBER, reason: "Hottest burger under $25" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(parse<{ ok: boolean; district: string }>(res.content)).toMatchObject({ ok: true, district: "Food Street" });
    expect(actions()).toEqual([
      { type: "highlight_storefront", merchantId: EMBER, parcelId: EMBER_PARCEL, label: "Ember & Oak", reason: "Hottest burger under $25" },
    ]);
  });

  it("highlight_storefront refuses unknown merchants without emitting anything", async () => {
    const { ctx, events } = makeCtx();
    const res = await highlightStorefront.execute({ merchantId: "ghost" }, ctx);
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(0);
  });
});

describe("scenario 2: two people, $60, something healthy", () => {
  it("'healthy' finds Verde Bowl first and bowls that serve two under $60 together", async () => {
    const { ctx, merchantCards } = makeCtx();
    const merchants = await searchMerchants.execute({ query: "healthy" }, ctx);
    const body = parse<{ merchants: Array<{ id: string; openNow: boolean }> }>(merchants.content);
    expect(body.merchants[0]?.id).toBe(VERDE);
    expect(body.merchants[0]?.openNow).toBe(true);
    expect(merchantCards()[0]?.id).toBe(VERDE);

    const products = await searchProducts.execute({ query: "healthy", maxPriceCents: 3000 }, ctx);
    const facts = parse<ProductsBody>(products.content).products;
    const verde = facts.filter((p) => p.merchantId === VERDE);
    expect(verde.length).toBeGreaterThanOrEqual(2);
    const [a, b] = verde;
    expect(a!.priceCents + b!.priceCents).toBeLessThanOrEqual(6000);
    expect((a!.serves ?? 0) + (b!.serves ?? 0)).toBeGreaterThanOrEqual(2);
    // Labelled bowls lead; "Build Your Own" has no dietary tags until you pick a base.
    expect(verde.filter((p) => p.dietary?.length).length).toBeGreaterThanOrEqual(2);
  });

  it("recommend returns the picks' facts, emits cards and a recommend action, and lists unknown ids", async () => {
    const { ctx, actions, productCards, merchantCards } = makeCtx();
    const green = sid.product("verde-bowl", "green-goddess");
    const harissa = sid.product("verde-bowl", "harissa-chicken");
    const res = await recommend.execute({ productIds: [green, harissa, "nope"], merchantIds: [VERDE], reason: "Two bowls under $30, both gluten-free" }, ctx);
    expect(res.isError).toBeUndefined();
    const body = parse<{ recommended: boolean; reason: string; products: ProductFactWithOffer[]; merchants: Array<{ id: string }>; unknownIds?: string[] }>(res.content);
    expect(body.recommended).toBe(true);
    expect(body.products.map((p) => p.id)).toEqual([green, harissa]);
    expect(body.merchants.map((m) => m.id)).toEqual([VERDE]);
    expect(body.unknownIds).toEqual(["nope"]);
    expect(productCards().map((c) => c.id)).toEqual([green, harissa]);
    expect(merchantCards().map((c) => c.id)).toEqual([VERDE]);
    expect(actions()).toEqual([{ type: "recommend", productIds: [green, harissa], merchantIds: [VERDE], reason: "Two bowls under $30, both gluten-free" }]);
  });

  it("recommend with only unknown ids is an error and emits nothing", async () => {
    const { ctx, events } = makeCtx();
    const res = await recommend.execute({ productIds: ["a", "b"], reason: "x" }, ctx);
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(0);
  });
});

describe("scenario 3: a black hoodie under $150", () => {
  it("exposes availableFrom, purchasableNow=false and a city-time drop note on the Night Shift hoodies", async () => {
    const { ctx, productCards } = makeCtx();
    const res = await searchProducts.execute({ query: "black hoodie", maxPriceCents: 15000 }, ctx);
    const body = parse<ProductsBody>(res.content);
    const ids = body.products.map((p) => p.id);
    expect(ids).toContain(MERIDIAN);
    expect(ids).toContain(NIGHT_SHIFT_INK);

    const meridian = body.products.find((p) => p.id === MERIDIAN)!;
    expect(meridian.priceCents).toBe(12800);
    expect(meridian.purchasableNow).toBe(true);
    expect(meridian.availableFrom).toBeUndefined();
    expect(meridian.variantGroups.find((g) => g.id === "color")?.options.map((o) => o.id)).toContain("ink");

    for (const id of NIGHT_SHIFT) {
      const fact = body.products.find((p) => p.id === id);
      if (!fact) continue;
      expect(fact.purchasableNow).toBe(false);
      expect(fact.availableFrom).toBe(drop.start.toISOString());
      expect(fact.availabilityNote).toMatch(/drops Today 8:00 PM city time/);
      expect(fact.availabilityNote).toMatch(/never call it available now/);
    }
    expect(body.note).toMatch(/purchasableNow=false/);
    // Cards tell the UI which ones read "Drops at 8 PM" instead of "Add".
    expect(productCards().find((c) => c.id === NIGHT_SHIFT_INK)?.availableFrom).toBe(drop.start.toISOString());
    expect(productCards().find((c) => c.id === MERIDIAN)?.availableFrom).toBeUndefined();
  });

  it("open_product emits the action and a card, and tells the model when an item cannot be bought yet", async () => {
    const ok = makeCtx();
    const res = await openProduct.execute({ productId: MERIDIAN }, ok.ctx);
    expect(parse<{ ok: boolean; note: string }>(res.content).note).toMatch(/can add it/);
    expect(ok.actions()).toEqual([{ type: "open_product", productId: MERIDIAN }]);
    expect(ok.productCards().map((c) => c.id)).toEqual([MERIDIAN]);

    const upcoming = makeCtx();
    const drop = await openProduct.execute({ productId: NIGHT_SHIFT_INK }, upcoming.ctx);
    const body = parse<{ product: ProductFactWithOffer; note: string }>(drop.content);
    expect(body.product.purchasableNow).toBe(false);
    expect(body.note).toMatch(/cannot be bought yet/);

    const missing = await openProduct.execute({ productId: "ghost" }, makeCtx().ctx);
    expect(missing.isError).toBe(true);
  });

  it("open_product is pinned to the merchant in employee scope", async () => {
    const { ctx, events } = makeCtx({ scope: "employee", merchantId: SAFFRON });
    const res = await openProduct.execute({ productId: MERIDIAN }, ctx);
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(0);
  });

  it("the Night Shift hoodies become purchasable once the drop is live", async () => {
    const live = new Date(drop.start.getTime() + 30 * 60_000);
    const { ctx } = makeCtx({ now: live });
    const res = await searchProducts.execute({ query: "night shift" }, ctx);
    const facts = parse<ProductsBody>(res.content).products.filter((p) => NIGHT_SHIFT.includes(p.id));
    expect(facts.length).toBe(4);
    for (const f of facts) {
      expect(f.purchasableNow).toBe(true);
      expect(f.availabilityNote).toBeUndefined();
      expect(f.availableFrom).toBe(drop.start.toISOString());
    }
  });
});

describe("scenario 4: somewhere popular", () => {
  it("search_merchants sort=popular ranks by rating × log(reviews) and says so", async () => {
    const { ctx, merchantCards } = makeCtx();
    const res = await searchMerchants.execute({ sort: "popular" }, ctx);
    const body = parse<{ sortedBy: string; merchants: Array<{ id: string; popularity: number; ratingCount: number; sponsored: boolean }> }>(res.content);
    expect(body.sortedBy).toMatch(/popular/);
    expect(body.merchants[0]?.id).toBe(NORTHLINE);
    const scores = body.merchants.map((m) => m.popularity);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(body.merchants.length).toBeLessThanOrEqual(8);
    expect(merchantCards()[0]?.id).toBe(NORTHLINE);
  });

  it("popular sort breaks score ties with sponsorship, then rating", () => {
    const base = snapshot.merchants.find((m) => m.id === EMBER)!;
    const mk = (id: string, patch: Partial<Merchant>): Merchant => ({ ...base, id, slug: id, name: id, ...patch });
    const a = mk("a", { rating: 4.5, ratingCount: 100, sponsored: false });
    const b = mk("b", { rating: 4.5, ratingCount: 100, sponsored: true });
    const c = mk("c", { rating: 4.9, ratingCount: 3, sponsored: true });
    const d = mk("d", { ratingCount: 0, sponsored: true });
    delete (d as Partial<Merchant>).rating;
    expect(popularityScore(a)).toBeCloseTo(4.5 * Math.log(101));
    expect(popularityScore(d)).toBe(0);
    expect(filterMerchants([a, c, d, b], [], { sort: "popular" }).map((m) => m.id)).toEqual(["b", "a", "c", "d"]);
    // Default relevance order is untouched.
    expect(filterMerchants([a, c], [], {}).map((m) => m.id)).toEqual(["c", "a"]);
  });

  it("open_merchant emits a card and an action for a real merchant only", async () => {
    const { ctx, actions, merchantCards } = makeCtx();
    const res = await openMerchant.execute({ merchantId: NORTHLINE }, ctx);
    expect(parse<{ ok: boolean; merchant: { name: string; district: string } }>(res.content)).toMatchObject({
      ok: true,
      merchant: { name: "Northline Supply", district: "Fashion Street" },
    });
    expect(actions()).toEqual([{ type: "open_merchant", merchantId: NORTHLINE }]);
    expect(merchantCards().map((c) => c.id)).toEqual([NORTHLINE]);
    const missing = await openMerchant.execute({ merchantId: "ghost" }, makeCtx().ctx);
    expect(missing.isError).toBe(true);
    const pinned = makeCtx({ scope: "employee", merchantId: EMBER });
    expect((await openMerchant.execute({ merchantId: NORTHLINE }, pinned.ctx)).isError).toBe(true);
  });
});

describe("city map for the cacheable prompt", () => {
  it("lists districts with their storefronts and tonight's events in city time", async () => {
    const map = await buildCityMap(new FixedClockSource(snapshot), NOW);
    expect(map.timezone).toBe("America/Chicago");
    const names = map.districts.map((d) => d.name);
    expect(names).toEqual(["Central Plaza", "Food Street", "Fashion Street", "Event Square"]);
    const food = map.districts.find((d) => d.name === "Food Street")!;
    expect(food.merchants.map((m) => m.id)).toEqual(expect.arrayContaining([EMBER, SAFFRON, KORI, VERDE]));
    const fashion = map.districts.find((d) => d.name === "Fashion Street")!;
    const northline = fashion.merchants.find((m) => m.id === NORTHLINE)!;
    expect(northline).toMatchObject({ sponsored: true, ratingCount: 2140 });
    expect(northline.popupParcelId).toBeUndefined(); // pop-up lot not open before 8 PM
    const dropEvent = map.events.find((e) => e.title === "Northline — Night Shift")!;
    expect(dropEvent).toMatchObject({ phase: "scheduled", starts: "Today 8:00 PM", ends: "Today 10:00 PM", districtName: "Event Square", parcelId: sid.parcel("es-pop1") });
    expect(dropEvent.productIds).toEqual(NIGHT_SHIFT);
    expect(map.events.find((e) => e.title === "Burger Rush")?.phase).toBe("live");
  });

  it("marks the pop-up lot once the drop is live and keeps the flagship as the storefront", async () => {
    const live = new Date(drop.start.getTime() + 60_000);
    const map = await buildCityMap(new FixedClockSource(buildCitySnapshot(live)), live);
    const northline = map.districts.flatMap((d) => d.merchants).find((m) => m.id === NORTHLINE)!;
    expect(northline.popupParcelId).toBe(sid.parcel("es-pop1"));
    expect(storefrontParcelFor(snapshot.parcels, NORTHLINE, live.getTime())?.id).toBe(NORTHLINE_FLAGSHIP);
  });

  it("formats city time relative to today", () => {
    expect(formatCityTime("2026-10-01T01:00:00Z", "America/Chicago", NOW)).toBe("Today 8:00 PM");
    expect(formatCityTime("2026-10-02T01:00:00Z", "America/Chicago", NOW)).toBe("Tomorrow 8:00 PM");
    expect(formatCityTime("2026-10-04T02:00:00Z", "America/Chicago", NOW)).toBe("Oct 3, 9:00 PM");
    expect(formatCityTime("2026-10-01T01:00:00Z", "Not/AZone", NOW)).toBe("Today 8:00 PM");
  });
});

describe("tool roster", () => {
  it("the concierge has every founder action and the employee can open a product", () => {
    expect(conciergeTools.map((t) => t.name)).toEqual([
      "search_merchants",
      "search_products",
      "get_merchant",
      "get_events",
      "recommend",
      "highlight_storefront",
      "open_merchant",
      "open_product",
      "navigate",
      "propose_cart",
    ]);
    expect(employeeTools.map((t) => t.name)).toContain("open_product");
    expect(employeeTools.map((t) => t.name)).not.toContain("highlight_storefront");
  });

  it("actions carry ids only: never prices, names of products or coordinates the client would trust", async () => {
    const { ctx, actions } = makeCtx();
    await recommend.execute({ productIds: [HELLFIRE], reason: "r" }, ctx);
    await openProduct.execute({ productId: HELLFIRE }, ctx);
    await highlightStorefront.execute({ merchantId: EMBER }, ctx);
    for (const action of actions() as AIAction[]) {
      const json = JSON.stringify(action);
      expect(json).not.toMatch(/Cents|price|\$/);
    }
  });
});
