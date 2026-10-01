import { describe, expect, it } from "vitest";
import type { CartLine, Merchant, Offer, Product } from "@/types/domain";
import {
  availableFulfillmentTypes,
  bestOfferFor,
  computeTotals,
  defaultFulfillmentFor,
  lineKey,
  lineProblem,
  unitPriceCents,
  variantLabel,
  variantProblem,
} from "./pricing";

const merchant = (id: string, fulfillment: Merchant["fulfillment"]): Merchant => ({
  id,
  slug: id,
  name: id,
  description: "",
  category: "food.test",
  merchantType: "restaurant",
  status: "published",
  tags: [],
  images: [],
  brand: { primary: "#000", secondary: "#fff", accent: "#f00", onPrimary: "#fff" },
  storefrontTemplate: "bistro",
  interiorTemplate: "restaurant-dining",
  storefrontConfig: { signStyle: "neon", facade: "brick", awning: false, floors: 1, windowDisplay: "menu", accentLights: false },
  fulfillment,
  sponsored: false,
  ratingCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const product = (id: string, merchantId: string, priceCents: number, extra: Partial<Product> = {}): Product => ({
  id,
  merchantId,
  slug: id,
  title: id,
  description: "",
  category: "x",
  priceCents,
  currency: "USD",
  images: [],
  inventoryStatus: "in_stock",
  variantGroups: [],
  attributes: {},
  tags: [],
  fulfillmentTypes: ["delivery", "pickup"],
  leadTime: {},
  featured: false,
  sortOrder: 0,
  active: true,
  ...extra,
});

const burger = product("burger", "m1", 1450, {
  category: "burgers",
  variantGroups: [
    {
      id: "size",
      name: "Size",
      required: true,
      options: [
        { id: "single", name: "Single", priceDeltaCents: 0 },
        { id: "double", name: "Double", priceDeltaCents: 300 },
      ],
    },
  ],
});
const fries = product("fries", "m1", 800, { category: "sides" });
const hoodie = product("hoodie", "m2", 12800, { fulfillmentTypes: ["shipping", "pickup"] });

const m1 = merchant("m1", {
  provider: "simulated",
  delivery: { enabled: true, feeCents: 399, minutesMin: 20, minutesMax: 40 },
  pickup: { enabled: true, minutesMin: 10, minutesMax: 15 },
});
const m2 = merchant("m2", {
  provider: "simulated",
  shipping: { enabled: true, feeCents: 0, daysMin: 3, daysMax: 5 },
  pickup: { enabled: true, minutesMin: 60, minutesMax: 120 },
});

const productsById = { burger, fries, hoodie };
const merchantsById = { m1, m2 };
const NOW = new Date("2026-09-30T18:00:00Z");

const line = (productId: string, merchantId: string, quantity: number, variantSelection: Record<string, string> = {}): CartLine => ({
  key: lineKey(productId, variantSelection),
  productId,
  merchantId,
  quantity,
  variantSelection,
});

const offer = (extra: Partial<Offer>): Offer => ({
  id: "o1",
  slug: "o1",
  merchantId: "m1",
  scope: {},
  title: "Offer",
  description: "",
  kind: "percent_off",
  value: 20,
  startsAt: "2026-09-30T00:00:00Z",
  endsAt: "2026-10-01T00:00:00Z",
  redemptionsCount: 0,
  active: true,
  ...extra,
});

describe("lineKey", () => {
  it("is stable regardless of variant key order", () => {
    expect(lineKey("p", { b: "2", a: "1" })).toBe(lineKey("p", { a: "1", b: "2" }));
  });
  it("differs by variant", () => {
    expect(lineKey("p", { size: "s" })).not.toBe(lineKey("p", { size: "m" }));
  });
});

describe("unitPriceCents / variantLabel", () => {
  it("adds option deltas and ignores unknown groups when pricing", () => {
    expect(unitPriceCents(burger, { size: "double", bogus: "x" })).toBe(1750);
    expect(variantLabel(burger, { size: "double" })).toBe("Double");
  });
  it("lineKey is injective for adversarial ids", () => {
    expect(lineKey("p", { a: "1&b=2" })).not.toBe(lineKey("p", { a: "1", b: "2" }));
    expect(lineKey("p|a=1", {})).not.toBe(lineKey("p", { a: "1" }));
  });
});

describe("variantProblem / lineProblem", () => {
  it("requires required variants and rejects unknown groups", () => {
    expect(variantProblem(burger, {})).toMatch(/Choose a size/);
    expect(variantProblem(burger, { size: "single" })).toBeNull();
    expect(variantProblem(burger, { size: "single", bogus: "x" })).toBe("Unknown option.");
  });
  it("flags missing, inactive and sold-out products", () => {
    expect(variantProblem(undefined, {})).toBeTruthy();
    expect(variantProblem({ ...fries, active: false }, {})).toBeTruthy();
    expect(variantProblem({ ...fries, inventoryStatus: "out_of_stock" }, {})).toBe("Sold out.");
  });
  it("rejects fulfillment types the product does not support", () => {
    expect(lineProblem(hoodie, line("hoodie", "m2", 1), "delivery")).toMatch(/not available for delivery/);
    expect(lineProblem(hoodie, line("hoodie", "m2", 1), "shipping")).toBeNull();
    expect(lineProblem(fries, line("fries", "m1", 1), "digital")).toMatch(/not available/);
  });
});

describe("fulfillment defaults", () => {
  it("picks the first type both merchant and products support", () => {
    expect(defaultFulfillmentFor(m1, [burger, fries])).toBe("delivery");
    expect(defaultFulfillmentFor(m2, [hoodie])).toBe("shipping");
    expect(availableFulfillmentTypes(m2, [hoodie])).toEqual(["shipping", "pickup"]);
    expect(defaultFulfillmentFor(m1, [hoodie])).toBe("pickup");
  });
});

describe("computeTotals", () => {
  it("sums lines and applies one delivery fee per merchant", () => {
    const t = computeTotals(
      [line("burger", "m1", 2, { size: "double" }), line("fries", "m1", 1)],
      productsById,
      merchantsById,
      { m1: "delivery" },
      { now: NOW },
    );
    expect(t.subtotalCents).toBe(1750 * 2 + 800);
    expect(t.deliveryFeeCents).toBe(399);
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(t.subtotalCents + 399);
    expect(t.itemCount).toBe(3);
    expect(t.problems).toEqual([]);
  });
  it("supports mixed carts with different fulfillment per merchant", () => {
    const t = computeTotals(
      [line("fries", "m1", 1), line("hoodie", "m2", 1)],
      productsById,
      merchantsById,
      { m1: "delivery", m2: "shipping" },
      { now: NOW },
    );
    expect(t.problems).toEqual([]);
    expect(t.deliveryFeeCents).toBe(399);
    expect(t.totalCents).toBe(800 + 12800 + 399);
    expect(t.byMerchant.map((m) => [m.merchantId, m.type, m.feeCents])).toEqual([
      ["m1", "delivery", 399],
      ["m2", "shipping", 0],
    ]);
  });
  it("marks lines whose merchant or product cannot do the chosen type", () => {
    const t = computeTotals(
      [line("fries", "m1", 1), line("hoodie", "m2", 1)],
      productsById,
      merchantsById,
      { m1: "delivery", m2: "delivery" },
      { now: NOW },
    );
    expect(t.problems.map((p) => p.key)).toEqual(["hoodie"]);
    expect(t.totalCents).toBe(800 + 399);
  });
  it("flags merchants with no fulfillment chosen", () => {
    const t = computeTotals([line("fries", "m1", 1)], productsById, merchantsById, {}, { now: NOW });
    expect(t.problems[0]?.reason).toMatch(/Choose how/);
    expect(t.totalCents).toBe(0);
  });
  it("excludes problem lines from totals", () => {
    const t = computeTotals([line("burger", "m1", 1)], productsById, merchantsById, { m1: "delivery" }, { now: NOW });
    expect(t.subtotalCents).toBe(0);
    expect(t.problems).toHaveLength(1);
  });
});

describe("offers", () => {
  const burgerRush = offer({ id: "rush", slug: "rush", scope: { categories: ["burgers"] }, value: 20 });
  const date5 = offer({ id: "date5", slug: "date5", kind: "amount_off", value: 500, code: "DATE5", productId: "fries" });

  it("applies a category-scoped percent offer automatically to matching lines only", () => {
    const t = computeTotals(
      [line("burger", "m1", 2, { size: "single" }), line("fries", "m1", 1)],
      productsById,
      merchantsById,
      { m1: "pickup" },
      { now: NOW, offers: [burgerRush] },
    );
    expect(t.discountCents).toBe(Math.round(1450 * 0.2) * 2);
    expect(t.totalCents).toBe(1450 * 2 + 800 - t.discountCents);
    expect(t.appliedOffers).toEqual([{ offerId: "rush", title: "Offer", merchantId: "m1", discountCents: t.discountCents }]);
    expect(t.lines.find((l) => l.productId === "fries")?.discountCents).toBe(0);
  });
  it("requires the promo code for coded offers and reports whether it applied", () => {
    const without = computeTotals([line("fries", "m1", 1)], productsById, merchantsById, { m1: "pickup" }, { now: NOW, offers: [date5] });
    expect(without.discountCents).toBe(0);
    const wrong = computeTotals([line("fries", "m1", 1)], productsById, merchantsById, { m1: "pickup" }, { now: NOW, offers: [date5], promoCode: "NOPE" });
    expect(wrong.discountCents).toBe(0);
    expect(wrong.promoCodeApplied).toBe(false);
    const right = computeTotals([line("fries", "m1", 1)], productsById, merchantsById, { m1: "pickup" }, { now: NOW, offers: [date5], promoCode: "date5" });
    expect(right.discountCents).toBe(500);
    expect(right.promoCodeApplied).toBe(true);
  });
  it("ignores expired, exhausted, inactive and non-priceable offers", () => {
    expect(bestOfferFor(burger, 1450, [offer({ endsAt: "2026-09-30T01:00:00Z" })], NOW)).toBeNull();
    expect(bestOfferFor(burger, 1450, [offer({ maxRedemptions: 5, redemptionsCount: 5 })], NOW)).toBeNull();
    expect(bestOfferFor(burger, 1450, [offer({ active: false })], NOW)).toBeNull();
    expect(bestOfferFor(burger, 1450, [offer({ kind: "free_item" })], NOW)).toBeNull();
    expect(bestOfferFor(burger, 1450, [offer({ merchantId: "m2" })], NOW)).toBeNull();
  });
  it("never discounts below zero and picks the best single offer", () => {
    const big = offer({ id: "big", kind: "amount_off", value: 99999 });
    const small = offer({ id: "small", value: 10 });
    const best = bestOfferFor(fries, 800, [small, big], NOW);
    expect(best?.id).toBe("big");
    const t = computeTotals([line("fries", "m1", 1)], productsById, merchantsById, { m1: "pickup" }, { now: NOW, offers: [small, big] });
    expect(t.totalCents).toBe(0);
    expect(t.discountCents).toBe(800);
  });
});
