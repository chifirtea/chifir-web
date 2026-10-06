import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { features } from "@/lib/env.server";
import {
  PLATFORM_PROHIBITED_CLAIMS,
  merchantProposalSchema,
  type ValidatedProposal,
} from "@/lib/validation/merchantDraft";
import { parseHomepage, parseShopifyCollections, parseShopifyProducts } from "./extract";
import { COLLECTIONS_JSON, FIXTURE_ORIGIN, INDEX_HTML, INJECTION_IN_META, INJECTION_IN_PRODUCT, PRODUCTS_JSON } from "./shopify.fixture";
import {
  NotConfiguredError,
  PROPOSE_TOOL_NAME,
  StructureError,
  finalizeProposal,
  inferCategory,
  inferMerchantType,
  paletteFromCandidates,
  proposeMerchantTool,
  sourceVariantGroups,
  structureMerchant,
  structureMerchantHeuristic,
  type StructuringClient,
} from "./structure";
import { variantPriceProblem } from "./sourceCheck";
import type { ExtractedProduct, Extraction } from "./types";

function fixtureExtraction(overrides: Partial<Extraction> = {}): Extraction {
  const home = parseHomepage(INDEX_HTML, `${FIXTURE_ORIGIN}/`);
  return {
    sourceUrl: `${FIXTURE_ORIGIN}/`,
    origin: FIXTURE_ORIGIN,
    platform: "shopify",
    name: "Northwind Goods",
    ...(home.description ? { description: home.description } : {}),
    ...(home.ogImage ? { ogImage: home.ogImage } : {}),
    logoCandidates: home.logoCandidates,
    colorCandidates: home.colorCandidates,
    products: parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN).products,
    categories: parseShopifyCollections(COLLECTIONS_JSON),
    fetchedAt: "2026-10-06T12:00:00.000Z",
    warnings: [],
    meta: {},
    ...overrides,
  };
}

describe("structureMerchantHeuristic", () => {
  const extraction = fixtureExtraction();
  const result = structureMerchantHeuristic(extraction);
  const { merchant, products, employee } = result.proposal;

  it("produces a schema-valid proposal marked heuristic", () => {
    expect(result.source).toBe("heuristic");
    expect(merchantProposalSchema.safeParse(result.proposal).success).toBe(true);
    // The jacket's Olive / L has no usable price, so its options are listed as whole variants.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^"Lighthouse Jacket": option prices do not add up/);
  });

  it("maps identity, brand and templates for a retail store", () => {
    expect(merchant.name).toBe("Northwind Goods");
    expect(merchant.slug).toBe("northwind-goods");
    expect(merchant.merchantType).toBe("retail");
    expect(merchant.category).toBe("fashion.apparel");
    expect(merchant.storefrontTemplate).toBe("boutique");
    expect(merchant.interiorTemplate).toBe("retail-racks");
    expect(merchant.brand.primary).toBe("#0b2545");
    expect(merchant.brand.onPrimary).toBe("#fff6ea");
    expect(merchant.logoUrl).toBe(`${FIXTURE_ORIGIN}/apple-touch-icon.png`);
    expect(merchant.heroImageUrl).toBe("https://cdn.shopify.com/s/files/1/0001/og-hero.jpg");
    expect(merchant.websiteUrl).toBe(`${FIXTURE_ORIGIN}/`);
    expect(merchant.fulfillment.provider).toBe("simulated");
    expect(merchant.tags.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("copies products and prices verbatim, with variant deltas from real variant prices", () => {
    expect(products.map((p) => [p.slug, p.title, p.priceCents])).toEqual([
      ["harbor-hoodie", "Harbor Hoodie", 6800],
      ["dockside-cap", "Dockside Cap", 3200],
      ["lighthouse-jacket", "Lighthouse Jacket", 124900],
    ]);
    const hoodie = products[0]!;
    expect(hoodie.compareAtPriceCents).toBe(8500);
    expect(hoodie.variantGroups).toHaveLength(1);
    expect(hoodie.variantGroups[0]?.options.map((o) => [o.name, o.priceDeltaCents, o.inventoryStatus])).toEqual([
      ["S", 0, "in_stock"],
      ["M", 0, "in_stock"],
      ["L", 400, "out_of_stock"],
      ["XL", 400, "in_stock"],
    ]);
    expect(hoodie.attributes.sizes).toEqual(["S", "M", "L", "XL"]);
    // Olive / L is not sold (no usable price), so separate Color and Size groups would let a
    // customer buy it at an invented $1,299: whole variants instead, each priced exactly.
    const jacket = products[2]!;
    expect(jacket.variantGroups.map((g) => g.name)).toEqual(["Color / Size"]);
    expect(jacket.variantGroups[0]?.options.map((o) => [o.name, o.priceDeltaCents])).toEqual([
      ["Navy / M", 0],
      ["Navy / L", 0],
      ["Olive / M", 5000],
    ]);
    expect(products.every((p) => p.fulfillmentTypes.includes("shipping"))).toBe(true);
    expect(merchant.sponsored).toBe(false);
  });

  it("never copies page text into the employee's knowledge (it is stated as fact)", () => {
    for (const rule of PLATFORM_PROHIBITED_CLAIMS) expect(employee.prohibitedClaims).toContain(rule);
    expect(employee.greeting).toContain("Northwind Goods");
    const knowledge = employee.knowledge.join(" ");
    expect(knowledge).not.toContain("Ignore previous instructions");
    expect(knowledge).not.toContain("Heavyweight hoodies"); // the meta description
    expect(knowledge).not.toContain("Outerwear"); // collection titles
    expect(employee.knowledge).toEqual([
      "Northwind Goods lists 3 items in the city.",
      "The online store groups its catalog into 2 collections.",
      "Northwind Goods also sells online at northwind-goods.example.",
    ]);
    // Page text survives only as inert description text, which the reviewer sees and edits.
    expect(merchant.description).toContain(INJECTION_IN_META);
    expect(products[1]?.description).toContain(INJECTION_IN_PRODUCT);
    expect(employee.allowedContext.length).toBeGreaterThan(0);
  });

  it("picks restaurant templates for a food store", () => {
    const food = fixtureExtraction({
      name: "Kori Ramen",
      description: "Tonkotsu ramen and gyoza, late night menu.",
      products: [
        { ...extraction.products[1]!, title: "Tonkotsu Ramen", handle: "tonkotsu", productType: "Ramen", tags: ["noodle"], options: [] },
      ],
      categories: [],
      colorCandidates: [],
    });
    expect(inferMerchantType(food)).toBe("restaurant");
    expect(inferCategory(food, "restaurant")).toBe("food.ramen");
    const r = structureMerchantHeuristic(food);
    expect(r.proposal.merchant.storefrontTemplate).toBe("bistro");
    expect(r.proposal.merchant.interiorTemplate).toBe("restaurant-dining");
    expect(r.proposal.products[0]?.fulfillmentTypes).toEqual(["delivery", "pickup"]);
    expect(r.proposal.employee.role).toBe("host");
    expect(merchantProposalSchema.safeParse(r.proposal).success).toBe(true);
  });

  it("honours reviewer hints and survives an empty generic extraction", () => {
    const generic = fixtureExtraction({ platform: "generic", name: "Kiln", products: [], categories: [], colorCandidates: [], logoCandidates: [] });
    const r = structureMerchantHeuristic(generic, { merchantType: "service", category: "services.ceramics" });
    expect(r.proposal.merchant.merchantType).toBe("service");
    expect(r.proposal.merchant.category).toBe("services.ceramics");
    expect(r.proposal.products).toEqual([]);
    expect(merchantProposalSchema.safeParse(r.proposal).success).toBe(true);
  });

  it("derives a legible palette", () => {
    expect(paletteFromCandidates([])).toMatchObject({ primary: "#1f1b18", onPrimary: "#fff6ea" });
    const light = paletteFromCandidates(["#ffffff", "#f5d76e", "#123456"]);
    expect(light.primary).toBe("#f5d76e"); // white is skipped
    expect(light.onPrimary).toBe("#15130f");
  });
});

describe("finalizeProposal", () => {
  const extraction = fixtureExtraction();
  const base = structureMerchantHeuristic(extraction).proposal;

  it("drops products whose price is not in the source and rebuilds invented options", () => {
    const tampered: ValidatedProposal = structuredClone(base);
    tampered.products[0]!.priceCents = 5900; // invented discount
    tampered.products[1]!.variantGroups = [
      { id: "size", name: "Size", required: true, options: [{ id: "big", name: "Big", priceDeltaCents: 1000 }] },
    ];
    const r = finalizeProposal(tampered, extraction, "ai", "claude-opus-5-5");
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["dockside-cap", "lighthouse-jacket"]);
    expect(r.warnings[0]).toMatch(/Dropped "Harbor Hoodie": \$59\.00/);
    expect(r.proposal.products[0]?.variantGroups).toEqual([]); // the cap has no options at the source
    expect(r.warnings.some((w) => w.includes('"Big" is not a variant the source sells'))).toBe(true);
    expect(r.model).toBe("claude-opus-5-5");
  });

  it("checks each price against its own product, not the whole catalog", () => {
    const swapped: ValidatedProposal = structuredClone(base);
    swapped.products[0]!.priceCents = 3200; // the cap's price on the hoodie
    const r = finalizeProposal(swapped, extraction, "ai");
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["dockside-cap", "lighthouse-jacket"]);
    expect(r.warnings[0]).toMatch(/Dropped "Harbor Hoodie": \$32\.00 is not a price the source lists for this product/);
    // A real variant price of the same product is fine as the base (deltas re-derived).
    const fromVariant: ValidatedProposal = structuredClone(base);
    fromVariant.products[0]!.priceCents = 7200;
    const r2 = finalizeProposal(fromVariant, extraction, "ai");
    expect(r2.proposal.products[0]?.priceCents).toBe(7200);
    expect(r2.proposal.products[0]?.variantGroups[0]?.options.map((o) => o.priceDeltaCents)).toEqual([-400, -400, 0, 0]);
  });

  it("drops invented and duplicated products", () => {
    const invented: ValidatedProposal = structuredClone(base);
    invented.products.push({ ...structuredClone(base.products[1]!), slug: "mystery-box", title: "Mystery Box" });
    invented.products.push(structuredClone(base.products[1]!));
    const r = finalizeProposal(invented, extraction, "ai");
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["harbor-hoodie", "dockside-cap", "lighthouse-jacket"]);
    expect(r.warnings.filter((w) => w.startsWith("Dropped"))).toHaveLength(2);
  });

  it("strips sponsorship, unsourced was-prices and unsourced claims; restores the store's descriptions", () => {
    const steered: ValidatedProposal = structuredClone(base);
    (steered.merchant as { sponsored: boolean }).sponsored = true;
    const cap = steered.products[1]!;
    cap.compareAtPriceCents = 4800; // the source lists no compare-at price for the cap
    cap.description = "Clinically shown to lower cholesterol.";
    cap.attributes = { dietary: ["vegan", "gluten_free"], allergens: ["peanuts"], calories: 120, material: "cotton twill" };
    const r = finalizeProposal(steered, extraction, "ai");
    const out = r.proposal.products[1]!;
    expect(r.proposal.merchant.sponsored).toBe(false);
    expect(out.compareAtPriceCents).toBeUndefined();
    expect(out.description).toBe(extraction.products[1]!.description);
    expect(out.attributes).toEqual({ material: "cotton twill" });
    expect(r.proposal.products[0]?.compareAtPriceCents).toBe(8500); // the hoodie's real compare-at stays
    expect(r.warnings.join("\n")).toMatch(/removed the "was" price \$48\.00/);
    expect(r.warnings.join("\n")).toMatch(/removed dietary claims the source does not make \(vegan, gluten_free\)/);
    expect(r.warnings.join("\n")).toMatch(/removed allergens/);
    expect(r.warnings.join("\n")).toMatch(/removed 120 kcal/);
    expect(r.warnings.join("\n")).toMatch(/Replaced 1 product description with the store's own text/);
  });

  it("keeps dietary claims the source states", () => {
    const vegan = fixtureExtraction({
      products: [{ ...extraction.products[1]!, tags: ["vegan", "gluten-free"], description: "Oat milk latte. Contains oats." }],
    });
    const proposal: ValidatedProposal = structuredClone(structureMerchantHeuristic(vegan).proposal);
    proposal.products[0]!.attributes = { dietary: ["vegan", "gluten_free", "halal"], allergens: ["oats"] };
    const r = finalizeProposal(proposal, vegan, "ai");
    expect(r.proposal.products[0]?.attributes).toEqual({ dietary: ["vegan", "gluten_free"], allergens: ["oats"] });
  });

  it("dedupes slugs, lowercases tags and restores platform rules", () => {
    const messy: ValidatedProposal = structuredClone(base);
    messy.products[1]!.slug = messy.products[0]!.slug;
    messy.products[0]!.tags = ["Fleece", "fleece", " NEW "];
    messy.employee.prohibitedClaims = ["Do not discuss competitors."];
    const r = finalizeProposal(messy, extraction, "ai");
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["harbor-hoodie", "harbor-hoodie-2", "lighthouse-jacket"]);
    expect(r.proposal.products[0]?.tags).toEqual(["fleece", "new"]);
    // Missing platform rules are put first; the store's own rules follow.
    expect(r.proposal.employee.prohibitedClaims).toEqual([
      PLATFORM_PROHIBITED_CLAIMS[1],
      PLATFORM_PROHIBITED_CLAIMS[0],
      "Do not discuss competitors.",
    ]);
  });
});

describe("propose_merchant tool", () => {
  it("compiles the proposal schema to a strict tool", () => {
    const tool = proposeMerchantTool();
    expect(tool.name).toBe(PROPOSE_TOOL_NAME);
    expect(tool.strict).toBe(true);
    const schema = tool.input_schema as { type: string; additionalProperties: boolean; required: string[] };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["merchant", "products", "employee"]);
    // Sponsorship is a business decision: the AI is never offered the field.
    const merchant = (tool.input_schema as { properties: { merchant: { properties: Record<string, unknown> } } }).properties.merchant;
    expect(Object.keys(merchant.properties)).not.toContain("sponsored");
    expect(Object.keys(merchant.properties)).toContain("storefrontTemplate");
  });
});

describe("structureMerchant (fake SDK client)", () => {
  type BetaMessage = Anthropic.Beta.BetaMessage;
  type Params = Parameters<StructuringClient["beta"]["messages"]["stream"]>[0];
  const extraction = fixtureExtraction();
  const good = structureMerchantHeuristic(extraction).proposal;

  const message = (content: unknown[], stop_reason = "tool_use"): BetaMessage =>
    ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, usage: {} }) as unknown as BetaMessage;
  const toolUse = (input: unknown, id = "tu_1") => ({ type: "tool_use", id, name: PROPOSE_TOOL_NAME, input });

  function fakeClient(replies: BetaMessage[]) {
    const calls: Params[] = [];
    const client: StructuringClient = {
      beta: {
        messages: {
          stream(params) {
            calls.push(structuredClone(params));
            const reply = replies.shift();
            return { finalMessage: async () => reply ?? message([], "end_turn") };
          },
        },
      },
    };
    return { client, calls };
  }

  it("returns a validated AI proposal; nulls from the strict schema are stripped", async () => {
    const withNulls = { ...structuredClone(good), merchant: { ...structuredClone(good.merchant), tagline: null, openingHours: null } };
    const { client, calls } = fakeClient([message([toolUse(withNulls)])]);
    const r = await structureMerchant(extraction, { merchantType: "retail" }, { client, model: "claude-opus-5-5" });
    expect(r.source).toBe("ai");
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.proposal.products).toHaveLength(3);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe("claude-opus-5-5");
    expect(call.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(call.tools?.map((t) => ("name" in t ? t.name : ""))).toEqual([PROPOSE_TOOL_NAME]);
    const user = call.messages[0]?.content as string;
    expect(user).toContain("<extraction>");
    expect(user).toContain("Reviewer hints: merchantType: retail.");
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const bad = { ...structuredClone(good), merchant: { ...structuredClone(good.merchant), brand: { ...good.merchant.brand, primary: "navy" } } };
    const { client, calls } = fakeClient([message([toolUse(bad, "tu_bad")]), message([toolUse(good, "tu_ok")])]);
    const r = await structureMerchant(extraction, {}, { client });
    expect(r.proposal.merchant.brand.primary).toBe("#0b2545");
    expect(calls).toHaveLength(2);
    const retry = calls[1]!.messages;
    expect(retry).toHaveLength(3);
    const toolResult = (retry[2]?.content as Array<{ type: string; tool_use_id: string; is_error: boolean; content: string }>)[0]!;
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "tu_bad", is_error: true });
    expect(toolResult.content).toContain("merchant.brand.primary");
  });

  it("fails readably after two invalid proposals", async () => {
    const invented = { ...structuredClone(good), merchant: { ...structuredClone(good.merchant), rating: 5 } };
    const { client } = fakeClient([message([toolUse(invented)]), message([toolUse(invented)])]);
    const err = await structureMerchant(extraction, {}, { client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StructureError);
    expect((err as StructureError).code).toBe("invalid_proposal");
    expect((err as StructureError).message).toMatch(/rating/);
  });

  it("nudges once when the model answers in prose, then gives up", async () => {
    const prose = message([{ type: "text", text: "Here is the store." }], "end_turn");
    const { client, calls } = fakeClient([prose, structuredClone(prose)]);
    await expect(structureMerchant(extraction, {}, { client })).rejects.toMatchObject({ code: "no_proposal" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages.at(-1)?.content).toMatch(/must call propose_merchant/);
  });

  it("treats refusal and truncation as terminal", async () => {
    const refused = fakeClient([message([], "refusal")]);
    await expect(structureMerchant(extraction, {}, { client: refused.client })).rejects.toMatchObject({ code: "refused" });
    expect(refused.calls).toHaveLength(1);
    const cut = fakeClient([message([toolUse({ merchant: {} })], "max_tokens")]);
    await expect(structureMerchant(extraction, {}, { client: cut.client })).rejects.toMatchObject({ code: "truncated" });
  });

  it("rebuilds AI option groups whose combinations do not cost what the source charges", async () => {
    const lying = structuredClone(good);
    // Pretend Color and Size add up, which would sell Olive / L (not offered) at $1,299.
    lying.products[2]!.variantGroups = [
      { id: "color", name: "Color", required: true, options: [{ id: "navy", name: "Navy", priceDeltaCents: 0 }, { id: "olive", name: "Olive", priceDeltaCents: 5000 }] },
      { id: "size", name: "Size", required: true, options: [{ id: "m", name: "M", priceDeltaCents: 0 }, { id: "l", name: "L", priceDeltaCents: 0 }] },
    ];
    const { client } = fakeClient([message([toolUse(lying)])]);
    const r = await structureMerchant(extraction, {}, { client });
    expect(r.proposal.products[2]?.variantGroups.map((g) => g.name)).toEqual(["Color / Size"]);
    expect(r.warnings.some((w) => w.includes('"Olive / L" is not a variant the source sells'))).toBe(true);
  });

  it("drops AI products with invented prices after validation", async () => {
    const lying = structuredClone(good);
    lying.products[2]!.priceCents = 99900;
    const { client } = fakeClient([message([toolUse(lying)])]);
    const r = await structureMerchant(extraction, {}, { client });
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["harbor-hoodie", "dockside-cap"]);
    expect(r.warnings[0]).toMatch(/Lighthouse Jacket/);
  });

  it.skipIf(features.ai)("throws NotConfiguredError without an API key", async () => {
    await expect(structureMerchant(extraction)).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

describe("heuristic variant pricing", () => {
  const product = (variants: Array<[string, string, number]>): ExtractedProduct => ({
    id: "p1",
    handle: "field-bag",
    title: "Field Bag",
    description: "A bag.",
    productType: "Bags",
    tags: [],
    images: [],
    options: [
      { name: "Size", values: [...new Set(variants.map((v) => v[0]))] },
      { name: "Material", values: [...new Set(variants.map((v) => v[1]))] },
    ],
    variants: variants.map(([size, material, price], i) => ({
      id: String(i),
      title: `${size} / ${material}`,
      priceCents: price,
      available: true,
      options: [size, material],
    })),
    priceCents: Math.min(...variants.map((v) => v[2])),
    url: "https://bags.example/products/field-bag",
  });

  it("keeps separate groups when option prices add up", () => {
    const additive = product([
      ["S", "Cotton", 5000],
      ["S", "Leather", 8000],
      ["L", "Cotton", 6000],
      ["L", "Leather", 9000],
    ]);
    const { groups, wholeVariants } = sourceVariantGroups(additive);
    expect(wholeVariants).toBe(false);
    expect(groups.map((g) => g.name)).toEqual(["Size", "Material"]);
    expect(variantPriceProblem(groups, 5000, additive)).toBeNull();
  });

  it("lists whole variants when option prices do not add up, so every combination costs its source price", () => {
    const matrix = product([
      ["S", "Cotton", 5000],
      ["S", "Leather", 5000],
      ["L", "Cotton", 5000],
      ["L", "Leather", 8000],
    ]);
    const { groups, wholeVariants } = sourceVariantGroups(matrix);
    expect(wholeVariants).toBe(true);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.options.map((o) => [o.name, o.priceDeltaCents])).toEqual([
      ["S / Cotton", 0],
      ["S / Leather", 0],
      ["L / Cotton", 0],
      ["L / Leather", 3000],
    ]);
    expect(variantPriceProblem(groups, 5000, matrix)).toBeNull();

    const r = structureMerchantHeuristic(fixtureExtraction({ products: [matrix], categories: [] }));
    expect(r.proposal.products[0]?.variantGroups).toEqual(groups);
    expect(r.warnings[0]).toMatch(/"Field Bag": option prices do not add up/);
  });

  it("flags the additive shortcut on a non-additive matrix", () => {
    const matrix = product([
      ["S", "Cotton", 5000],
      ["S", "Leather", 5000],
      ["L", "Cotton", 5000],
      ["L", "Leather", 8000],
    ]);
    const additive = [
      { id: "size", name: "Size", required: true, options: [{ id: "s", name: "S", priceDeltaCents: 0 }, { id: "l", name: "L", priceDeltaCents: 0 }] },
      { id: "material", name: "Material", required: true, options: [{ id: "c", name: "Cotton", priceDeltaCents: 0 }, { id: "le", name: "Leather", priceDeltaCents: 0 }] },
    ];
    expect(variantPriceProblem(additive, 5000, matrix)).toBe('"L / Leather" would cost $50.00; the source charges $80.00.');
  });
});

describe("structureMerchantHeuristic on long, realistic inputs (property-style)", () => {
  /** Small deterministic PRNG so failures reproduce. */
  function rng(seed: number) {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 0x1_0000_0000;
    };
  }
  const WORDS = ["Heather", "Charcoal", "with", "Ivory", "Stripe", "Small", "Regular", "Length", "Outerwear,", "Jackets", "and", "Heavy", "Layers", "Bags,", "Caps", "Everyday", "Accessories", "Extra", "Tall"];
  const phrase = (r: () => number, min: number, max: number) => {
    let out = "";
    const target = min + Math.floor(r() * (max - min + 1));
    while (out.length < target) out += `${out ? " " : ""}${WORDS[Math.floor(r() * WORDS.length)]}`;
    return out.slice(0, max).trim();
  };

  function randomStore(seed: number): Extraction {
    const r = rng(seed);
    const utm = `?utm_source=${"newsletter".repeat(1 + Math.floor(r() * 6))}&utm_medium=email&utm_campaign=${"autumn-launch-".repeat(1 + Math.floor(r() * 8))}`;
    const origin = `https://${"long-store-name".repeat(1 + Math.floor(r() * 3))}.example`;
    const products: ExtractedProduct[] = Array.from({ length: 1 + Math.floor(r() * 45) }, (_, i) => {
      const sizes = Array.from({ length: 2 + Math.floor(r() * 4) }, () => phrase(r, 1, 60));
      const colors = Array.from({ length: 1 + Math.floor(r() * 4) }, () => phrase(r, 1, 60));
      const uniqueSizes = [...new Set(sizes)];
      const uniqueColors = [...new Set(colors)];
      const variants = uniqueSizes.flatMap((size, si) =>
        uniqueColors.map((color, ci) => ({
          id: `${i}-${si}-${ci}`,
          title: `${size} / ${color}`.slice(0, 60),
          priceCents: r() < 0.02 ? 900_000_000 : 1000 + Math.floor(r() * 50) * 100 + (r() < 0.3 ? si * 500 + ci * 300 : 0),
          ...(r() < 0.3 ? { compareAtPriceCents: 999_999_999 } : {}),
          available: r() > 0.2,
          options: [size, color],
        })),
      ).slice(0, 30);
      return {
        id: String(i),
        handle: `product-${i}`,
        title: phrase(r, 1, 120),
        description: phrase(r, 0, 600),
        productType: phrase(r, 0, 60),
        tags: [phrase(r, 1, 32).toLowerCase()],
        images: [`${origin}/images/${"x".repeat(Math.floor(r() * 2100))}.jpg`],
        options: [
          { name: "Size", values: uniqueSizes },
          { name: "Colour", values: uniqueColors },
        ],
        variants,
        priceCents: Math.min(...variants.map((v) => v.priceCents)),
        url: `${origin}/products/product-${i}`,
      };
    });
    return {
      sourceUrl: `${origin}/collections/all${utm}`,
      origin,
      platform: "shopify",
      name: phrase(r, 1, 80),
      ...(r() < 0.7 ? { description: phrase(r, 1, 600) } : {}),
      logoCandidates: [`${origin}/${"logo".repeat(Math.floor(r() * 600))}.png`],
      colorCandidates: ["#0b2545", "#ff6b35"],
      products,
      categories: Array.from({ length: Math.floor(r() * 30) }, (_, i) => ({ handle: `c-${i}`, title: phrase(r, 20, 80) })),
      fetchedAt: "2026-10-06T12:00:00.000Z",
      warnings: [],
      meta: {},
    };
  }

  it("the reviewer's reported store: six long collection titles and a long UTM URL", () => {
    const store = fixtureExtraction({
      sourceUrl: `${FIXTURE_ORIGIN}/collections/all?utm_source=newsletter-autumn-2026&utm_medium=email&utm_campaign=heavyweight-layers-launch-weekend&utm_content=hero-banner-variant-b&utm_term=hoodies-and-jackets-sale`,
      categories: [
        "Outerwear, Jackets and Heavy Layers",
        "Bags, Caps and Everyday Accessories",
        "Hoodies, Crewnecks and Sweatshirts",
        "Tees, Polos and Lightweight Tops",
        "Denim, Chinos and Workwear Pants",
        "Gift Cards, Bundles and Last Chance",
      ].map((title, i) => ({ handle: `c${i}`, title })),
      products: [
        {
          ...parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN).products[0]!,
          options: [
            { name: "Size", values: ["Small / Regular Length", "Large / Regular Length"] },
            { name: "Color", values: ["Heather Charcoal with Ivory Stripe", "Navy"] },
          ],
        },
      ],
    });
    expect(store.sourceUrl.length).toBeGreaterThan(185);
    const r = structureMerchantHeuristic(store);
    expect(merchantProposalSchema.safeParse(r.proposal).success).toBe(true);
    const attrs = r.proposal.products[0]?.attributes;
    expect(attrs?.sizes).toBeUndefined(); // "Small / Regular Length" is over the 20-char chip limit
    expect(attrs?.colors).toEqual(["Navy"]); // the 34-char colour is left out of the chips
    expect(r.proposal.employee.knowledge.every((k) => k.length <= 200)).toBe(true);
  });

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i yields a schema-valid proposal whose option prices match the source", (seed) => {
    const store = randomStore(seed);
    const r = structureMerchantHeuristic(store);
    const parsed = merchantProposalSchema.safeParse(r.proposal);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."))).toEqual([]);
    expect(r.proposal.products.every((p) => p.priceCents <= 100_000_000)).toBe(true);
    for (const p of r.proposal.products) {
      const src = store.products.find((x) => x.handle === p.slug)!;
      expect(variantPriceProblem(p.variantGroups, p.priceCents, src)).toBeNull();
    }
  });

  it("heals stored extractions that skipped the extractor's caps", () => {
    const store = fixtureExtraction();
    const hoodie = { ...store.products[0]!, tags: ["x".repeat(50)], title: "T".repeat(300), description: "D".repeat(900) };
    const r = structureMerchantHeuristic({ ...store, products: [hoodie] });
    expect(merchantProposalSchema.safeParse(r.proposal).success).toBe(true);
    expect(r.proposal.products[0]?.tags).toEqual([]);
    expect(r.proposal.products[0]?.title.length).toBe(120);
    expect(r.warnings.some((w) => w.includes("left out its tags"))).toBe(true);
  });
});
