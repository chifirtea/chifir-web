import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { features } from "@/lib/env.server";
import {
  PLATFORM_PROHIBITED_CLAIMS,
  merchantProposalSchema,
  type ValidatedProposal,
} from "@/lib/validation/merchantDraft";
import { parseHomepage, parseShopifyCollections, parseShopifyProducts } from "./extract";
import { COLLECTIONS_JSON, FIXTURE_ORIGIN, INDEX_HTML, PRODUCTS_JSON } from "./shopify.fixture";
import {
  NotConfiguredError,
  PROPOSE_TOOL_NAME,
  StructureError,
  finalizeProposal,
  inferCategory,
  inferMerchantType,
  paletteFromCandidates,
  proposeMerchantTool,
  structureMerchant,
  structureMerchantHeuristic,
  type StructuringClient,
} from "./structure";
import type { Extraction } from "./types";

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
    expect(result.warnings).toEqual([]);
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
    const jacket = products[2]!;
    expect(jacket.variantGroups.map((g) => g.name)).toEqual(["Color", "Size"]);
    expect(jacket.variantGroups[0]?.options.find((o) => o.name === "Olive")?.priceDeltaCents).toBe(5000);
    expect(products.every((p) => p.fulfillmentTypes.includes("shipping"))).toBe(true);
  });

  it("gives the employee the platform rules and only sourced knowledge", () => {
    for (const rule of PLATFORM_PROHIBITED_CLAIMS) expect(employee.prohibitedClaims).toContain(rule);
    expect(employee.greeting).toContain("Northwind Goods");
    expect(employee.knowledge.join(" ")).not.toContain("Ignore previous instructions");
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

  it("drops products whose price is not in the source and resets invented deltas", () => {
    const tampered: ValidatedProposal = structuredClone(base);
    tampered.products[0]!.priceCents = 5900; // invented discount
    tampered.products[1]!.variantGroups = [
      { id: "size", name: "Size", required: true, options: [{ id: "big", name: "Big", priceDeltaCents: 1000 }] },
    ];
    const r = finalizeProposal(tampered, extraction, "ai", "claude-opus-5-5");
    expect(r.proposal.products.map((p) => p.slug)).toEqual(["dockside-cap", "lighthouse-jacket"]);
    expect(r.warnings[0]).toMatch(/Dropped "Harbor Hoodie": \$59\.00/);
    expect(r.proposal.products[0]?.variantGroups[0]?.options[0]?.priceDeltaCents).toBe(0);
    expect(r.warnings.some((w) => w.includes("Big"))).toBe(true);
    expect(r.model).toBe("claude-opus-5-5");
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
