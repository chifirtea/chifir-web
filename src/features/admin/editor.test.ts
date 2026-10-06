import { describe, expect, it } from "vitest";
import { parseShopifyProducts } from "@/lib/onboarding/extract";
import { FIXTURE_ORIGIN, PRODUCTS_JSON } from "@/lib/onboarding/shopify.fixture";
import { structureMerchantHeuristic } from "@/lib/onboarding/structure";
import type { Extraction } from "@/lib/onboarding/types";
import {
  changeMerchantType,
  contrastRatio,
  facing,
  forApprovalProposal,
  parcelRect,
  parseDollars,
  priceCheck,
  proposalIssues,
  reviewChecklist,
  toggleChannel,
  variantSummary,
  withoutSponsorship,
} from "./editor";

const extraction: Extraction = {
  sourceUrl: `${FIXTURE_ORIGIN}/`,
  origin: FIXTURE_ORIGIN,
  platform: "shopify",
  name: "Northwind Goods",
  logoCandidates: [],
  colorCandidates: [],
  products: parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN).products,
  categories: [],
  fetchedAt: "2026-10-06T12:00:00.000Z",
  warnings: [],
  meta: {},
};
const proposal = structureMerchantHeuristic(extraction).proposal;

describe("parseDollars", () => {
  it("parses reviewer price input exactly", () => {
    expect(parseDollars("68")).toBe(6800);
    expect(parseDollars("68.5")).toBe(6850);
    expect(parseDollars(" $1,249.00 ")).toBe(124900);
    expect(parseDollars("0.99")).toBe(99);
    expect(parseDollars("68.505")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("")).toBeNull();
  });
});

describe("variantSummary", () => {
  it("lists options with non-zero deltas", () => {
    expect(variantSummary(proposal.products[0]!.variantGroups)).toBe("Size: S, M, L (+$4), XL (+$4)");
    expect(variantSummary([])).toBe("No options");
  });
});

describe("approval helpers", () => {
  it("strips excluded products and re-indexes", () => {
    const edited = { ...proposal, products: proposal.products.map((p, i) => ({ ...p, active: i !== 1 })) };
    const out = forApprovalProposal(edited);
    expect(out.products.map((p) => [p.slug, p.sortOrder])).toEqual([
      ["harbor-hoodie", 0],
      ["lighthouse-jacket", 1],
    ]);
    expect(proposalIssues(edited)).toEqual({ schema: [], readiness: [] });
  });

  it("reports schema problems in the same terms as the server", () => {
    const bad = { ...proposal, merchant: { ...proposal.merchant, brand: { ...proposal.merchant.brand, primary: "navy" } } };
    expect(proposalIssues(bad).schema[0]).toMatch(/^merchant\.brand\.primary/);
    const none = { ...proposal, products: proposal.products.map((p) => ({ ...p, active: false })) };
    expect(proposalIssues(none).readiness).toContain("Add at least one product.");
  });

  it("flags prices that are not in the source", () => {
    const edited = { ...proposal, products: proposal.products.map((p, i) => (i === 0 ? { ...p, priceCents: 5900 } : p)) };
    const hoodie = priceCheck(edited.products[0]!, extraction);
    expect(hoodie).toMatchObject({ sourceCents: 6800, sourceCompareAtCents: 8500, notInSource: true });
    expect(hoodie.price[0]).toBe("$59.00 is not a source price for this product ($68.00, $72.00).");
    expect(priceCheck(edited.products[1]!, extraction)).toMatchObject({ sourceCents: 3200, notInSource: false, price: [], claims: [] });
    const list = reviewChecklist(edited, extraction, { tier: "standard" });
    expect(list.pricesNotInSource).toEqual(["Harbor Hoodie"]);
    expect(list.claimsNotInSource).toEqual([]);
    expect(list.templateProblem).toBeNull();
    expect(reviewChecklist(edited, extraction, { tier: "kiosk" }).templateProblem).toMatch(/kiosk/);
    expect(reviewChecklist(edited, extraction, undefined).placementChosen).toBe(false);
  });

  it("flags a price borrowed from another product (it is in the catalog, but not this product's)", () => {
    const swapped = { ...proposal, products: proposal.products.map((p, i) => (i === 0 ? { ...p, priceCents: 3200 } : p)) };
    expect(priceCheck(swapped.products[0]!, extraction).notInSource).toBe(true);
    expect(reviewChecklist(swapped, extraction, { tier: "standard" }).pricesNotInSource).toEqual(["Harbor Hoodie"]);
  });

  it("flags was-prices, option prices and claims the source does not make", () => {
    const cap = proposal.products[1]!;
    const steered = {
      ...cap,
      compareAtPriceCents: 4800,
      description: "Clinically shown to lower cholesterol.",
      attributes: { dietary: ["vegan" as const], allergens: ["peanuts"], calories: 90 },
      variantGroups: [{ id: "size", name: "Size", required: true, options: [{ id: "xl", name: "XL", priceDeltaCents: 500 }] }],
    };
    const check = priceCheck(steered, extraction);
    expect(check.price).toEqual([
      '"Was" price $48.00 is not a compare-at price the source lists.',
      'Options: "XL" is not a variant the source sells.',
    ]);
    expect(check.claims).toEqual([
      "Description differs from the source.",
      "Dietary claims the source does not make: vegan.",
      "Allergens the source does not mention: peanuts.",
      "90 kcal is not stated in the source.",
    ]);
    const list = reviewChecklist({ ...proposal, products: [proposal.products[0]!, steered] }, extraction, { tier: "standard" });
    expect(list.pricesNotInSource).toEqual(["Dockside Cap"]);
    expect(list.claimsNotInSource).toEqual(["Dockside Cap"]);
  });

  it("flags products it cannot match to the source, and ignores excluded ones", () => {
    const stray = { ...proposal.products[1]!, slug: "mystery", title: "Mystery Box" };
    expect(priceCheck(stray, extraction).price).toEqual(["Not matched to a product in the source catalog."]);
    const excluded = { ...proposal, products: [...proposal.products, { ...stray, active: false }] };
    expect(reviewChecklist(excluded, extraction, { tier: "standard" }).pricesNotInSource).toEqual([]);
  });

  it("never sends sponsorship", () => {
    const legacy = { ...proposal, merchant: { ...proposal.merchant, sponsored: true } };
    expect(withoutSponsorship(legacy).merchant.sponsored).toBe(false);
    expect(withoutSponsorship(proposal)).toBe(proposal);
  });
});

describe("toggleChannel / changeMerchantType", () => {
  it("keeps product fulfillment types in step with the store", () => {
    const withDelivery = toggleChannel(proposal, "delivery", true);
    expect(withDelivery.merchant.fulfillment.delivery).toMatchObject({ enabled: true, feeCents: 399 });
    expect(withDelivery.products.every((p) => p.fulfillmentTypes.join() === "delivery,pickup,shipping")).toBe(true);
    const shippingOnly = toggleChannel(toggleChannel(withDelivery, "delivery", false), "pickup", false);
    expect(shippingOnly.products[0]?.fulfillmentTypes).toEqual(["shipping"]);
    const none = toggleChannel(shippingOnly, "shipping", false);
    expect(none.products[0]?.fulfillmentTypes).toEqual(["shipping"]); // left alone; the checklist blocks approval
    expect(reviewChecklist(none, extraction, { tier: "standard" }).noFulfillment).toBe(true);
  });

  it("swaps templates that no longer suit the type", () => {
    const food = changeMerchantType(proposal, "restaurant");
    expect(food.merchant.storefrontTemplate).toBe("bistro");
    expect(food.merchant.interiorTemplate).toBe("restaurant-dining");
    const service = changeMerchantType(proposal, "service");
    expect(service.merchant.storefrontTemplate).toBe("boutique"); // boutique suits services too
    expect(service.merchant.interiorTemplate).toBe("retail-racks");
  });
});

describe("geometry and colour", () => {
  it("swaps footprint axes for quarter turns and finds the facade side", () => {
    const p = { position: { x: 10, z: 0 }, size: { width: 16, depth: 14 } };
    expect(parcelRect({ ...p, rotationY: 0 })).toEqual({ minX: 2, maxX: 18, minZ: -7, maxZ: 7 });
    expect(parcelRect({ ...p, rotationY: Math.PI / 2 })).toEqual({ minX: 3, maxX: 17, minZ: -8, maxZ: 8 });
    expect(parcelRect({ ...p, rotationY: Math.PI })).toEqual({ minX: 2, maxX: 18, minZ: -7, maxZ: 7 });
    expect(facing(0)).toEqual({ x: 0, z: 1 });
    expect(facing(Math.PI)).toEqual({ x: 0, z: -1 });
    expect(facing(Math.PI / 2)).toEqual({ x: 1, z: 0 });
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#0b2545", "#fff6ea")).toBeGreaterThan(4.5);
  });
});
