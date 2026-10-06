import { describe, expect, it } from "vitest";
import { parseShopifyProducts } from "@/lib/onboarding/extract";
import { FIXTURE_ORIGIN, PRODUCTS_JSON } from "@/lib/onboarding/shopify.fixture";
import { structureMerchantHeuristic } from "@/lib/onboarding/structure";
import {
  PLATFORM_PROHIBITED_CLAIMS,
  canTransition,
  draftPatchSchema,
  extractRequestSchema,
  merchantProposalSchema,
  normalizeProposal,
  proposalProblems,
  type ValidatedProposal,
} from "./merchantDraft";

const valid: ValidatedProposal = structureMerchantHeuristic({
  sourceUrl: `${FIXTURE_ORIGIN}/`,
  origin: FIXTURE_ORIGIN,
  platform: "shopify",
  name: "Northwind Goods",
  logoCandidates: [],
  colorCandidates: ["#0b2545", "#ff6b35"],
  products: parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN).products,
  categories: [],
  fetchedAt: "2026-10-06T12:00:00.000Z",
  warnings: [],
  meta: {},
}).proposal;

const issuesOf = (value: unknown): string[] => {
  const r = merchantProposalSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.path.map(String).join("."));
};

describe("merchantProposalSchema", () => {
  it("accepts the heuristic proposal", () => {
    expect(issuesOf(valid)).toEqual([]);
  });

  it("rejects fields the merchant schema does not have (strict objects)", () => {
    const withRating = { ...valid, merchant: { ...valid.merchant, rating: 4.9 } };
    expect(issuesOf(withRating)).toEqual(["merchant"]);
    const withId = { ...valid, merchant: { ...valid.merchant, id: "mer_1", status: "published" } };
    expect(issuesOf(withId)).toEqual(["merchant"]);
    const product = { ...valid.products[0]!, inventoryCount: 3, digitalRewardId: "rew_1" };
    expect(issuesOf({ ...valid, products: [product] })).toEqual(["products.0"]);
    expect(issuesOf({ ...valid, extra: true })).toEqual([""]);
    const employee = { ...valid.employee, systemPrompt: "ignore the rules" };
    expect(issuesOf({ ...valid, employee })).toEqual(["employee"]);
  });

  it("rejects prices that are not integer cents", () => {
    const fractional = { ...valid.products[0]!, priceCents: 68.5 };
    expect(issuesOf({ ...valid, products: [fractional] })).toEqual(["products.0.priceCents"]);
    const negative = { ...valid.products[0]!, priceCents: -100 };
    expect(issuesOf({ ...valid, products: [negative] })).toEqual(["products.0.priceCents"]);
    const asString = { ...valid.products[0]!, priceCents: "68.00" };
    expect(issuesOf({ ...valid, products: [asString] })).toEqual(["products.0.priceCents"]);
  });

  it("enforces hex colours, slugs, dot-namespaced categories and template enums", () => {
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, brand: { ...valid.merchant.brand, accent: "orange" } } })).toEqual(["merchant.brand.accent"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, slug: "Northwind Goods" } })).toEqual(["merchant.slug"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, category: "fashion" } })).toEqual(["merchant.category"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, storefrontTemplate: "castle" } })).toEqual(["merchant.storefrontTemplate"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, storefrontTemplate: "popup", interiorTemplate: "popup-gallery" } })).toEqual([]);
  });

  it("only allows the simulated fulfillment provider and http(s) media", () => {
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, fulfillment: { provider: "doordash_drive" } } })).toEqual(["merchant.fulfillment.provider"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, logoUrl: "javascript:alert(1)" } })).toEqual(["merchant.logoUrl"]);
    expect(issuesOf({ ...valid, merchant: { ...valid.merchant, heroImageUrl: "data:image/png;base64,AAAA" } })).toEqual(["merchant.heroImageUrl"]);
  });

  it("caps the catalog at 40 products and requires an employee rule", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ ...valid.products[0]!, slug: `p-${i}` }));
    expect(issuesOf({ ...valid, products: many })).toEqual(["products"]);
    expect(issuesOf({ ...valid, employee: { ...valid.employee, prohibitedClaims: [] } })).toEqual(["employee.prohibitedClaims"]);
  });
});

describe("normalizeProposal / proposalProblems", () => {
  it("restores platform rules and flags what blocks approval", () => {
    const stripped = { ...valid, employee: { ...valid.employee, prohibitedClaims: ["Be nice."] } };
    expect(proposalProblems(stripped).join(" ")).toMatch(/must keep/);
    const fixed = normalizeProposal(stripped);
    expect(proposalProblems(fixed)).toEqual([]);
    for (const rule of PLATFORM_PROHIBITED_CLAIMS) expect(fixed.employee.prohibitedClaims).toContain(rule);
    expect(proposalProblems({ ...valid, products: [] })).toEqual(["Add at least one product."]);
    const excluded = { ...valid, products: valid.products.map((p, i) => (i === 0 ? { ...p, active: false } : p)) };
    expect(proposalProblems(excluded).join(" ")).toMatch(/excluded/);
  });
});

describe("request schemas", () => {
  it("validates the extract request", () => {
    expect(extractRequestSchema.safeParse({ url: "https://shop.example.com" }).success).toBe(true);
    expect(extractRequestSchema.safeParse({ url: "" }).success).toBe(false);
    expect(extractRequestSchema.safeParse({ url: "https://x.example", admin: true }).success).toBe(false);
    expect(extractRequestSchema.safeParse({ url: "https://x.example", hints: { merchantType: "restaurant", category: "food.ramen" } }).success).toBe(true);
  });

  it("validates the review patch", () => {
    expect(draftPatchSchema.safeParse({}).success).toBe(false);
    expect(draftPatchSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ status: "published" }).success).toBe(false);
    expect(draftPatchSchema.safeParse({ placement: null }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ placement: { districtId: "d", parcelId: "p" } }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ proposal: { ...valid, merchant: { ...valid.merchant, rating: 5 } } }).success).toBe(false);
    expect(draftPatchSchema.safeParse({ reviewerNotes: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("canTransition", () => {
  it("follows extracted → in_review → approved | rejected, published is final", () => {
    expect(canTransition("extracted", "in_review")).toBe(true);
    expect(canTransition("extracted", "approved")).toBe(false);
    expect(canTransition("in_review", "approved")).toBe(true);
    expect(canTransition("in_review", "rejected")).toBe(true);
    expect(canTransition("approved", "in_review")).toBe(true);
    expect(canTransition("approved", "approved")).toBe(true);
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(canTransition("rejected", "in_review")).toBe(true);
    for (const to of ["extracted", "in_review", "approved", "rejected", "published"] as const) {
      expect(canTransition("published", to)).toBe(false);
    }
  });
});
