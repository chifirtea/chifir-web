import { describe, expect, it } from "vitest";
import type { Merchant, Product } from "@/types/domain";
import { computeTotals, lineKey, variantProblem } from "./pricing";

const T0 = Date.parse("2026-09-30T01:00:00Z");

const merchant: Merchant = {
  id: "m1",
  slug: "m1",
  name: "Drop Brand",
  description: "",
  category: "fashion.streetwear",
  merchantType: "retail",
  status: "published",
  tags: [],
  images: [],
  brand: { primary: "#000", secondary: "#fff", accent: "#f00", onPrimary: "#fff" },
  storefrontTemplate: "flagship",
  interiorTemplate: "retail-gallery",
  storefrontConfig: {
    signStyle: "backlit",
    facade: "concrete",
    awning: false,
    floors: 1,
    windowDisplay: "products",
    accentLights: false,
  },
  fulfillment: {
    provider: "simulated",
    shipping: { enabled: true, feeCents: 0, daysMin: 2, daysMax: 4 },
  },
  sponsored: false,
  ratingCount: 0,
  createdAt: "",
  updatedAt: "",
};

const hoodie: Product = {
  id: "p1",
  merchantId: "m1",
  slug: "hoodie",
  title: "Night Shift Hoodie",
  description: "",
  category: "hoodies",
  priceCents: 14200,
  currency: "USD",
  images: [],
  inventoryStatus: "in_stock",
  variantGroups: [],
  attributes: {},
  tags: [],
  fulfillmentTypes: ["shipping"],
  leadTime: {},
  availableFrom: new Date(T0).toISOString(),
  featured: true,
  sortOrder: 1,
  active: true,
};

describe("availability windows in pricing", () => {
  it("variantProblem refuses a product before its window and accepts it after", () => {
    expect(variantProblem(hoodie, {}, T0 - 1)).toMatch(/^Drops at/);
    expect(variantProblem(hoodie, {}, T0)).toBeNull();
  });

  it("computeTotals reports the line as a problem before the drop and prices it once live", () => {
    const line = {
      key: lineKey("p1"),
      productId: "p1",
      merchantId: "m1",
      quantity: 1,
      variantSelection: {},
    };
    const before = computeTotals(
      [line],
      { p1: hoodie },
      { m1: merchant },
      { m1: "shipping" },
      { now: new Date(T0 - 1) },
    );
    expect(before.problems).toEqual([
      { key: line.key, reason: expect.stringMatching(/^Drops at/) },
    ]);
    expect(before.totalCents).toBe(0);
    const live = computeTotals(
      [line],
      { p1: hoodie },
      { m1: merchant },
      { m1: "shipping" },
      { now: new Date(T0) },
    );
    expect(live.problems).toEqual([]);
    expect(live.totalCents).toBe(14200);
  });

  it("closed windows read as no longer available", () => {
    const closed = {
      ...hoodie,
      availableFrom: undefined,
      availableUntil: new Date(T0).toISOString(),
    };
    expect(variantProblem(closed, {}, T0)).toMatch(/no longer available/);
  });
});
