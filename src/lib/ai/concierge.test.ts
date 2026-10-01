import { describe, expect, it } from "vitest";
import { buildCitySnapshot } from "@/data/seed";
import { sid } from "@/data/seed/ids";
import { StaticDataSource } from "@/lib/data/static";
import type { ChatRequestInput } from "@/lib/validation/ai";
import type { Offer } from "@/types/domain";
import type { AIAction, ChatStreamEvent } from "./actions";
import { runConcierge } from "./concierge";
import type { LLMProvider, StreamParams, StreamResult, ToolResultPayload } from "./provider";

/**
 * The concierge pipeline end to end with a scripted provider standing in for the model: the same
 * `runConcierge()` the route calls, real tools over the seed, every action type exercised offline.
 */

const NOW = new Date("2026-09-30T23:30:00Z");
const snapshot = buildCitySnapshot(NOW);

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
const NORTHLINE = sid.merchant("northline-supply");
const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
const VINDALOO = sid.product("saffron-alley", "vindaloo-bowl");
const MERIDIAN = sid.product("northline-supply", "meridian-hoodie");
const EMBER_PARCEL = sid.parcel("fs-n1");

type Step = { tool: string; input: unknown } | { text: string };

interface ScriptedProvider extends LLMProvider {
  params: StreamParams[];
  results: Array<{ tool: string; payload: ToolResultPayload }>;
}

/** Replays the script: tool steps go through the real executors; text steps stream to the client. */
function scriptedProvider(script: Step[], stopReason: StreamResult["stopReason"] = "end"): ScriptedProvider {
  const provider: ScriptedProvider = {
    params: [],
    results: [],
    async stream(params, handlers) {
      provider.params.push(params);
      let text = "";
      const toolsUsed: string[] = [];
      for (const step of script) {
        if ("text" in step) {
          text += step.text;
          handlers.onText(step.text);
        } else {
          toolsUsed.push(step.tool);
          provider.results.push({ tool: step.tool, payload: await handlers.onToolCall(step.tool, step.input, `tu_${toolsUsed.length}`) });
        }
      }
      return { text, stopReason, toolsUsed };
    },
  };
  return provider;
}

function request(message: string): ChatRequestInput {
  return {
    messages: [{ role: "user", content: message }],
    context: { location: { kind: "street" }, cart: { lines: [] }, localTime: "2026-09-30T18:30:00-05:00" },
  };
}

async function run(script: Step[], message = "hi", stopReason?: StreamResult["stopReason"]) {
  const provider = scriptedProvider(script, stopReason);
  const events: ChatStreamEvent[] = [];
  await runConcierge({ request: request(message), user: null, emit: (e) => events.push(e), ds: new FixedClockSource(snapshot), provider, now: NOW });
  const actions = events.filter((e): e is Extract<ChatStreamEvent, { type: "action" }> => e.type === "action").map((e) => e.action);
  const cards = events.filter((e): e is Extract<ChatStreamEvent, { type: "cards" }> => e.type === "cards");
  const text = events.map((e) => (e.type === "text" ? e.delta : "")).join("");
  return { provider, events, actions, cards, text };
}

describe("runConcierge with a scripted provider", () => {
  it("sends a cacheable system prompt that carries the city map and the drop in city time, plus the full tool roster", async () => {
    const { provider } = await run([{ text: "Hello." }]);
    const params = provider.params[0]!;
    expect(params.system[0]?.cache).toBe(true);
    expect(params.system[0]?.text).toContain("<city_map");
    expect(params.system[0]?.text).toContain(`Event Square [district id ${sid.district("event-square")}]`);
    expect(params.system[0]?.text).toContain(`Ember & Oak [id ${EMBER}]`);
    expect(params.system[0]?.text).toMatch(/Northline — Night Shift \[event id .*\] · launch · scheduled · Today 8:00 PM → Today 10:00 PM · at Event Square/);
    expect(params.system[0]?.text).toContain("never describe such an item as available");
    expect(params.system[1]?.cache).toBeUndefined();
    expect(params.system[1]?.text).toContain("location: on the street");
    expect(params.tools.map((t) => t.name)).toEqual([
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
    expect(params.maxTokens).toBe(700);
  });

  it("scenario 1 offline: search → recommend → highlight → navigate emits cards and every action, then done", async () => {
    const { events, actions, cards, text, provider } = await run(
      [
        { tool: "search_products", input: { minSpiceLevel: 2, maxPriceCents: 2500 } },
        { tool: "recommend", input: { productIds: [VINDALOO, HELLFIRE], reason: "Hottest bowls under $25" } },
        { tool: "highlight_storefront", input: { merchantId: SAFFRON, reason: "Heat 4 of 4" } },
        { tool: "navigate", input: { target: { kind: "merchant", merchantId: SAFFRON }, mode: "teleport", label: "Saffron Alley" } },
        { text: "Two good bets: the Vindaloo Bowl at Saffron Alley, $15, or the Hellfire Burger, $16.50. I lit up Saffron Alley's door." },
      ],
      "Spicy food under $25.",
    );
    expect(provider.results.every((r) => !r.payload.isError)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards[0]?.products?.map((p) => p.id)).toEqual(expect.arrayContaining([HELLFIRE, VINDALOO]));
    expect(actions.map((a) => a.type)).toEqual(["recommend", "highlight_storefront", "navigate"]);
    expect(actions[1]).toEqual({ type: "highlight_storefront", merchantId: SAFFRON, parcelId: sid.parcel("fs-n2"), label: "Saffron Alley", reason: "Heat 4 of 4" });
    expect(actions[2]).toMatchObject({ type: "navigate", mode: "teleport", target: { kind: "merchant", merchantId: SAFFRON } });
    expect(text).toContain("$15");
    expect(events.at(-1)).toEqual({ type: "done" });
    // Tool start/end markers wrap every call for the "Searching…" hint.
    expect(events.filter((e) => e.type === "tool" && e.status === "start").map((e) => (e.type === "tool" ? e.name : ""))).toEqual([
      "search_products",
      "recommend",
      "highlight_storefront",
      "navigate",
    ]);
  });

  it("scenario 3 offline: open_product on the Meridian Hoodie; the Night Shift fact says it drops at 8 PM", async () => {
    const { actions, provider } = await run(
      [
        { tool: "search_products", input: { query: "black hoodie", maxPriceCents: 15000 } },
        { tool: "open_product", input: { productId: MERIDIAN } },
        { tool: "open_merchant", input: { merchantId: NORTHLINE } },
        { text: "The Meridian Hoodie in Ink, $128, is open on your screen. The Night Shift hoodies drop at 8 PM." },
      ],
      "I need a black hoodie under $150.",
    );
    expect(actions).toEqual([{ type: "open_product", productId: MERIDIAN }, { type: "open_merchant", merchantId: NORTHLINE }]);
    const search = JSON.parse(provider.results[0]!.payload.content) as { products: Array<{ id: string; purchasableNow: boolean; availabilityNote?: string }> };
    const ink = search.products.find((p) => p.id === sid.product("northline-supply", "night-shift-hoodie-ink"))!;
    expect(ink.purchasableNow).toBe(false);
    expect(ink.availabilityNote).toMatch(/drops Today 8:00 PM/);
    expect(search.products.find((p) => p.id === MERIDIAN)?.purchasableNow).toBe(true);
  });

  it("propose_cart and a bad id: the cart action carries ids + variants only; unknown ids never become actions", async () => {
    const { actions, provider } = await run([
      { tool: "propose_cart", input: { items: [{ productId: HELLFIRE, quantity: 2 }], note: "Dinner" } },
      { tool: "open_product", input: { productId: "ghost" } },
      { tool: "highlight_storefront", input: { merchantId: "ghost" } },
      { tool: "navigate", input: { target: { kind: "merchant", merchantId: "ghost" }, mode: "teleport", label: "Ghost" } },
      { text: "Added two Hellfire Burgers." },
    ]);
    expect(actions).toEqual([{ type: "propose_cart", items: [{ productId: HELLFIRE, quantity: 2 }], note: "Dinner" }] satisfies AIAction[]);
    expect(provider.results.slice(1).every((r) => r.payload.isError)).toBe(true);
  });

  it("surfaces a refusal as a friendly error and never emits done", async () => {
    const { events } = await run([{ text: "" }], "do something bad", "refusal");
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" });
  });

  it("'take me to Event Square' needs no search: navigate resolves the district id from the map", async () => {
    const { actions, provider } = await run(
      [
        { tool: "navigate", input: { target: { kind: "district", districtId: sid.district("event-square") }, mode: "teleport", label: "Event Square" } },
        { text: "Off to Event Square." },
      ],
      "Take me to Event Square",
    );
    expect(provider.results[0]?.payload.isError).toBeUndefined();
    expect(actions).toEqual([{ type: "navigate", target: { kind: "district", districtId: sid.district("event-square") }, mode: "teleport", label: "Event Square" }]);
    expect(provider.results[0]?.tool).toBe("navigate");
    void EMBER_PARCEL;
  });
});
