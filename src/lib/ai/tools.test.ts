import { beforeEach, describe, expect, it } from "vitest";
import { buildCitySnapshot } from "@/data/seed";
import { sid } from "@/data/seed/ids";
import { StaticDataSource } from "@/lib/data/static";
import type { Offer } from "@/types/domain";
import type { ChatStreamEvent } from "./actions";
import { compileToolSchema } from "./provider";
import {
  compactJson,
  compactValue,
  conciergeTools,
  employeeTools,
  escalateToHuman,
  getEvents,
  getMerchant,
  navigate,
  proposeCart,
  recommendItems,
  searchMerchants,
  searchProducts,
  type ToolContext,
} from "./tools";

// Wednesday 18:30 in Chicago (23:30Z): Burger Rush (17:00–21:00) is live, Kori's late bowls are not.
const NOW = new Date("2026-09-30T23:30:00Z");
const snapshot = buildCitySnapshot(NOW);

/** The static source filters offers by the wall clock; pin it to NOW so the test is deterministic. */
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
const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
const HOODIE = sid.product("northline-supply", "meridian-hoodie");
const LASSI = sid.product("saffron-alley", "mango-lassi");

function makeCtx(overrides: Partial<ToolContext> = {}) {
  const events: ChatStreamEvent[] = [];
  const ctx: ToolContext = {
    ds: new FixedClockSource(snapshot),
    emit: (e) => events.push(e),
    now: NOW,
    scope: "concierge",
    ...overrides,
  };
  return { ctx, events };
}

const parse = <T = Record<string, unknown>>(content: string): T => JSON.parse(content) as T;

describe("tool schemas", () => {
  it("compile to strict-compatible JSON schemas", () => {
    for (const tool of [...conciergeTools, ...employeeTools]) {
      const schema = compileToolSchema(tool.schema);
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
    expect(new Set(conciergeTools.map((t) => t.name)).size).toBe(conciergeTools.length);
  });
});

describe("search_products", () => {
  it("'spicy under $25' returns only products <= 2500 with spiceLevel >= 2, featured first then menu order, and emits cards", async () => {
    const { ctx, events } = makeCtx();
    const res = await searchProducts.execute({ maxPriceCents: 2500, minSpiceLevel: 2 }, ctx);
    expect(res.isError).toBeUndefined();
    const body = parse<{ count: number; products: Array<{ id: string; priceCents: number; spiceLevel?: number; merchantName: string; etaLabel?: string }> }>(res.content);
    expect(body.count).toBeGreaterThan(3);
    expect(body.count).toBeLessThanOrEqual(12);
    for (const p of body.products) {
      expect(p.priceCents).toBeLessThanOrEqual(2500);
      expect(p.spiceLevel ?? 0).toBeGreaterThanOrEqual(2);
      expect(p.merchantName).not.toBe("Unknown");
    }
    const byId = new Map(snapshot.products.map((p) => [p.id, p]));
    const ranks = body.products.map((p) => byId.get(p.id)!).map((p) => (p.featured ? 0 : 1) * 10_000 + p.sortOrder);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(body.products.some((p) => p.id === HELLFIRE && p.etaLabel === "25–40 min delivery")).toBe(true);
    const cards = events.find((e) => e.type === "cards");
    expect(cards?.type === "cards" && cards.products?.map((c) => c.id)).toEqual(body.products.map((p) => p.id));
    expect(res.content.length).toBeLessThanOrEqual(6000);
  });

  it("reports the live Burger Rush offer on burgers", async () => {
    const { ctx } = makeCtx();
    const res = await searchProducts.execute({ query: "burger", merchantIds: [EMBER] }, ctx);
    const body = parse<{ products: Array<{ id: string; liveOffer?: { title: string; unitPriceAfterCents: number } }> }>(res.content);
    const hellfire = body.products.find((p) => p.id === HELLFIRE);
    expect(hellfire?.liveOffer).toMatchObject({ title: "Burger Rush: 20% off burgers", unitPriceAfterCents: 1320 });
  });

  it("is pinned to the merchant in employee scope", async () => {
    const { ctx } = makeCtx({ scope: "employee", merchantId: SAFFRON });
    const res = await searchProducts.execute({ minSpiceLevel: 2, merchantIds: [EMBER] }, ctx);
    const body = parse<{ products: Array<{ merchantId: string }> }>(res.content);
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.products.every((p) => p.merchantId === SAFFRON)).toBe(true);
  });

  it("says so when nothing matches", async () => {
    const { ctx, events } = makeCtx();
    const res = await searchProducts.execute({ query: "unicorn steak", maxPriceCents: 100 }, ctx);
    expect(parse(res.content)).toMatchObject({ count: 0 });
    expect(events).toHaveLength(0);
  });
});

describe("propose_cart", () => {
  it("rejects a product with a missing required variant and lists the options", async () => {
    const { ctx, events } = makeCtx();
    const res = await proposeCart.execute({ items: [{ productId: HOODIE, quantity: 1 }] }, ctx);
    const body = parse<{ ok: boolean; accepted: unknown[]; rejected: Array<{ productId: string; reason: string }> }>(res.content);
    expect(body.ok).toBe(false);
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected[0]).toMatchObject({ productId: HOODIE });
    expect(body.rejected[0]!.reason).toMatch(/Choose a size/);
    expect(body.rejected[0]!.reason).toMatch(/size: s\|m\|l\|xl/);
    expect(events.some((e) => e.type === "action")).toBe(false);
  });

  it("accepts valid variants, applies the live offer and reports exact totals", async () => {
    const { ctx, events } = makeCtx();
    const res = await proposeCart.execute(
      {
        items: [
          { productId: HELLFIRE, quantity: 2 },
          { productId: HOODIE, quantity: 1, variantSelection: [{ groupId: "size", optionId: "m" }, { groupId: "color", optionId: "ink" }] },
          { productId: "nope", quantity: 1 },
        ],
        note: "Dinner and a hoodie",
      },
      ctx,
    );
    const body = parse<{
      ok: boolean;
      accepted: Array<{ productId: string; quantity: number; unitPriceCents: number; discountCents: number; offer?: string }>;
      rejected: Array<{ productId: string }>;
      subtotalCents: number;
      discountCents: number;
      feesCents: number;
      totalCents: number;
      fulfillment: Array<{ merchantName: string; type: string; feeCents: number }>;
    }>(res.content);
    expect(body.ok).toBe(false); // one unknown id
    expect(body.rejected).toEqual([{ productId: "nope", reason: expect.stringMatching(/Unknown product/) }]);
    expect(body.accepted).toHaveLength(2);
    const burger = body.accepted.find((a) => a.productId === HELLFIRE)!;
    expect(burger).toMatchObject({ quantity: 2, unitPriceCents: 1650, discountCents: 660, offer: "Burger Rush: 20% off burgers" });
    const hoodie = body.accepted.find((a) => a.productId === HOODIE)!;
    expect(hoodie).toMatchObject({ quantity: 1, unitPriceCents: 12800, discountCents: 0 });
    expect(body.subtotalCents).toBe(2 * 1650 + 12800);
    expect(body.discountCents).toBe(660);
    // Ember & Oak delivers ($3.99); Northline ships free.
    expect(body.feesCents).toBe(399);
    expect(body.totalCents).toBe(body.subtotalCents - 660 + 399);
    expect(body.fulfillment).toEqual(
      expect.arrayContaining([
        { merchantName: "Ember & Oak", type: "delivery", feeCents: 399 },
        { merchantName: "Northline Supply", type: "shipping", feeCents: 0 },
      ]),
    );
    const action = events.find((e) => e.type === "action");
    expect(action).toEqual({
      type: "action",
      action: {
        type: "propose_cart",
        items: [
          { productId: HELLFIRE, quantity: 2 },
          { productId: HOODIE, quantity: 1, variantSelection: { size: "m", color: "ink" } },
        ],
        note: "Dinner and a hoodie",
      },
    });
    expect(events.some((e) => e.type === "cards" && (e.products?.length ?? 0) === 2)).toBe(true);
  });

  it("refuses another merchant's items in employee scope", async () => {
    const { ctx } = makeCtx({ scope: "employee", merchantId: SAFFRON });
    const res = await proposeCart.execute({ items: [{ productId: HELLFIRE, quantity: 1 }, { productId: LASSI, quantity: 2 }] }, ctx);
    const body = parse<{ accepted: Array<{ productId: string }>; rejected: Array<{ productId: string; reason: string }> }>(res.content);
    expect(body.accepted.map((a) => a.productId)).toEqual([LASSI]);
    expect(body.rejected[0]).toMatchObject({ productId: HELLFIRE, reason: "Not sold by this merchant." });
  });
});

describe("navigate", () => {
  it("rejects unknown ids without emitting an action", async () => {
    const { ctx, events } = makeCtx();
    const res = await navigate.execute({ target: { kind: "merchant", merchantId: "ghost" }, mode: "teleport", label: "Ghost" }, ctx);
    expect(res.isError).toBe(true);
    expect(events).toHaveLength(0);
    const ev = await navigate.execute({ target: { kind: "event", eventId: "nope" }, mode: "guide", label: "x" }, ctx);
    expect(ev.isError).toBe(true);
  });

  it("emits a navigate action for a real merchant and district", async () => {
    const { ctx, events } = makeCtx();
    const res = await navigate.execute({ target: { kind: "merchant", merchantId: EMBER }, mode: "teleport", label: "Ember & Oak" }, ctx);
    expect(res.isError).toBeUndefined();
    expect(res.content).toMatch(/confirm teleports/);
    expect(events).toEqual([
      { type: "action", action: { type: "navigate", target: { kind: "merchant", merchantId: EMBER }, mode: "teleport", label: "Ember & Oak" } },
    ]);
    const district = snapshot.districts[0]!;
    const guide = await navigate.execute({ target: { kind: "district", districtId: district.id }, mode: "guide", label: district.name }, ctx);
    expect(guide.content).toMatch(/Waypoint/);
  });
});

describe("search_merchants / get_merchant / get_events", () => {
  it("returns merchant cards with district, open status and ETA", async () => {
    const { ctx, events } = makeCtx();
    const res = await searchMerchants.execute({ query: "spicy", merchantType: "restaurant" }, ctx);
    const body = parse<{ merchants: Array<{ id: string; district: string | null; openNow?: boolean; etaLabel?: string }> }>(res.content);
    expect(body.merchants.length).toBeGreaterThan(0);
    expect(body.merchants.length).toBeLessThanOrEqual(8);
    for (const m of body.merchants) {
      expect(typeof m.district).toBe("string");
      expect(typeof m.openNow).toBe("boolean");
    }
    expect(body.merchants.find((m) => m.id === EMBER)?.etaLabel).toBe("25–40 min delivery");
    expect(events[0]?.type).toBe("cards");
  });

  it("get_merchant returns hours, fulfillment, live offers and top products; unknown ids error", async () => {
    const { ctx, events } = makeCtx();
    const res = await getMerchant.execute({ merchantId: EMBER }, ctx);
    const body = parse<{ merchant: { name: string; hoursToday: { day: string } | null; fulfillment: Record<string, unknown>; liveOffers: unknown[]; topProducts: unknown[]; openNow: boolean } }>(res.content);
    expect(body.merchant.name).toBe("Ember & Oak");
    expect(body.merchant.hoursToday?.day).toBe("wed");
    expect(body.merchant.openNow).toBe(true);
    expect(body.merchant.fulfillment).toHaveProperty("delivery");
    expect(body.merchant.liveOffers).toHaveLength(1);
    expect(body.merchant.topProducts.length).toBeGreaterThan(0);
    expect(body.merchant.topProducts.length).toBeLessThanOrEqual(8);
    expect(events[0]?.type === "cards" && events[0].merchants?.[0]?.id).toBe(EMBER);
    expect(res.content.length).toBeLessThanOrEqual(6000);
    const missing = await getMerchant.execute({ merchantId: "ghost" }, ctx);
    expect(missing.isError).toBe(true);
  });

  it("get_events enriches with merchant and district names", async () => {
    const { ctx } = makeCtx();
    const res = await getEvents.execute({}, ctx);
    const body = parse<{ events: Array<{ title: string; merchantName?: string; districtName?: string; status: string }> }>(res.content);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.length).toBeLessThanOrEqual(10);
    const rush = body.events.find((e) => e.title === "Burger Rush");
    expect(rush).toMatchObject({ merchantName: "Ember & Oak", districtName: expect.any(String), status: "live" });
  });
});

describe("employee-only tools", () => {
  it("escalate_to_human emits an escalate action and only shares a contact when enabled", async () => {
    const ember = makeCtx({ scope: "employee", merchantId: EMBER });
    const res = await escalateToHuman.execute({ merchantId: EMBER, reason: "Severe nut allergy question" }, ember.ctx);
    expect(parse(res.content)).toMatchObject({ ok: true, humanFollowUp: true, contact: "hello@example.com" });
    expect(ember.events).toEqual([{ type: "action", action: { type: "escalate", merchantId: EMBER, reason: "Severe nut allergy question" } }]);

    const kori = makeCtx({ scope: "employee", merchantId: sid.merchant("kori-ramen") });
    const off = await escalateToHuman.execute({ merchantId: sid.merchant("kori-ramen"), reason: "wants a person" }, kori.ctx);
    const body = parse<{ humanFollowUp: boolean; contact?: string }>(off.content);
    expect(body.humanFollowUp).toBe(false);
    expect(body.contact).toBeUndefined();

    const other = await escalateToHuman.execute({ merchantId: SAFFRON, reason: "x" }, ember.ctx);
    expect(other.isError).toBe(true);
  });

  it("recommend_items only returns this merchant's products", async () => {
    const { ctx, events } = makeCtx({ scope: "employee", merchantId: SAFFRON });
    const res = await recommendItems.execute({ productIds: [LASSI, HELLFIRE] }, ctx);
    const body = parse<{ count: number; products: Array<{ id: string }>; unknownIds?: string[] }>(res.content);
    expect(body.count).toBe(1);
    expect(body.products[0]?.id).toBe(LASSI);
    expect(body.unknownIds).toEqual([HELLFIRE]);
    expect(events[0]?.type).toBe("cards");
  });
});

describe("compactJson", () => {
  it("shortens descriptions and drops images before trimming lists", () => {
    const big = { products: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, description: "x".repeat(400), imageUrl: "https://example.com/very/long/url".repeat(3) })) };
    const json = compactJson(big, 6000);
    expect(json.length).toBeLessThanOrEqual(6000);
    const parsed = JSON.parse(json) as { products: Array<{ id: string; description: string; imageUrl?: string }>; truncated?: boolean };
    expect(parsed.products).toHaveLength(40);
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.products[0]!.imageUrl).toBeUndefined();
    expect(parsed.products[0]!.description.length).toBeLessThan(400);
  });

  it("trims the largest shallow list (even when nested) and never emits invalid JSON", () => {
    const big = {
      merchant: {
        name: "x",
        tags: ["a", "b", "c", "d", "e", "f", "g"],
        topProducts: Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, variantGroups: [{ options: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] })),
      },
    };
    const { json, value } = compactValue(big, 4000);
    expect(json.length).toBeLessThanOrEqual(4000);
    const parsed = JSON.parse(json) as { merchant: { tags: string[]; topProducts: unknown[]; truncated?: boolean } };
    expect(parsed.merchant.truncated).toBe(true);
    expect(parsed.merchant.tags).toHaveLength(7);
    expect(parsed.merchant.topProducts.length).toBeGreaterThan(10);
    expect(parsed.merchant.topProducts.length).toBeLessThan(300);
    expect(value.merchant.topProducts.length).toBe(parsed.merchant.topProducts.length);
  });
});

describe("static source sanity", () => {
  let ds: StaticDataSource;
  beforeEach(() => {
    ds = new FixedClockSource(snapshot);
  });
  it("offers pinned to NOW include Burger Rush but not late bowls", async () => {
    const offers = await ds.listOffers();
    expect(offers.map((o) => o.slug)).toContain("ember-burger-rush");
    expect(offers.map((o) => o.slug)).not.toContain("kori-late-bowls");
  });
});
