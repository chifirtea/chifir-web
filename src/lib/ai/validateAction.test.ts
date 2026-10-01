import { describe, expect, it } from "vitest";
import { buildCityIndex } from "@/city/cityIndex";
import { buildCitySnapshot } from "@/data/seed";
import { sid } from "@/data/seed/ids";
import { dropWindow } from "@/data/seed/time";
import type { AIAction } from "./actions";
import { validateAIAction } from "./validateAction";

const NOW = new Date("2026-09-30T23:30:00Z");
const snapshot = buildCitySnapshot(NOW);
const index = buildCityIndex(snapshot, NOW.getTime());

const EMBER = sid.merchant("ember-and-oak");
const NORTHLINE = sid.merchant("northline-supply");
const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
const MERIDIAN = sid.product("northline-supply", "meridian-hoodie");
const EMBER_PARCEL = sid.parcel("fs-n1");
const POPUP = sid.parcel("es-pop1");
const EVENT_SQUARE = sid.district("event-square");

const ok = (action: AIAction) => {
  const v = validateAIAction(action, index);
  expect(v.ok, JSON.stringify(v)).toBe(true);
  return v.ok ? v.action : action;
};
const bad = (action: unknown) => {
  const v = validateAIAction(action, index);
  expect(v.ok).toBe(false);
  return v.ok ? "" : v.reason;
};

describe("validateAIAction", () => {
  it("rejects malformed payloads and anything before the city has loaded", () => {
    expect(bad({ type: "teleport_anywhere" })).toBe("malformed action");
    expect(bad({ type: "open_product" })).toBe("malformed action");
    expect(bad({ type: "navigate", target: { kind: "merchant", merchantId: EMBER }, mode: "fly", label: "x" })).toBe("malformed action");
    expect(validateAIAction({ type: "open_merchant", merchantId: EMBER }, null)).toEqual({ ok: false, reason: "city not loaded" });
  });

  it("navigate: merchants need a storefront parcel; districts, parcels, events and points resolve", () => {
    ok({ type: "navigate", target: { kind: "merchant", merchantId: EMBER }, mode: "teleport", label: "Ember & Oak" });
    ok({ type: "navigate", target: { kind: "district", districtId: EVENT_SQUARE }, mode: "teleport", label: "Event Square" });
    ok({ type: "navigate", target: { kind: "parcel", parcelId: POPUP }, mode: "guide", label: "Pop-up" });
    ok({ type: "navigate", target: { kind: "event", eventId: sid.event("northline-night-shift") }, mode: "guide", label: "Drop" });
    ok({ type: "navigate", target: { kind: "point", x: 1, z: 2 }, mode: "guide", label: "Here" });
    expect(bad({ type: "navigate", target: { kind: "merchant", merchantId: "ghost" }, mode: "teleport", label: "Ghost" })).toBe("unknown navigation target");
    expect(bad({ type: "navigate", target: { kind: "district", districtId: "nowhere" }, mode: "guide", label: "x" })).toBe("unknown navigation target");
  });

  it("propose_cart: unknown products are dropped; an all-unknown proposal is rejected", () => {
    const action = ok({ type: "propose_cart", items: [{ productId: HELLFIRE, quantity: 2 }, { productId: "nope", quantity: 1 }], note: "Dinner" });
    expect(action.type === "propose_cart" && action.items).toEqual([{ productId: HELLFIRE, quantity: 2 }]);
    expect(bad({ type: "propose_cart", items: [{ productId: "nope", quantity: 1 }] })).toBe("no known products");
    expect(bad({ type: "propose_cart", items: [{ productId: HELLFIRE, quantity: 99 }] })).toBe("malformed action");
  });

  it("highlight_storefront: resolves the storefront parcel, rejects foreign or closed parcels", () => {
    const resolved = ok({ type: "highlight_storefront", merchantId: EMBER, label: "Ember & Oak" });
    expect(resolved.type === "highlight_storefront" && resolved.parcelId).toBe(EMBER_PARCEL);
    ok({ type: "highlight_storefront", merchantId: EMBER, parcelId: EMBER_PARCEL, label: "Ember & Oak" });
    expect(bad({ type: "highlight_storefront", merchantId: "ghost", label: "x" })).toBe("unknown merchant");
    expect(bad({ type: "highlight_storefront", merchantId: EMBER, parcelId: POPUP, label: "x" })).toBe("unknown parcel");
    // Northline's pop-up lot exists but is not open before 8 PM.
    expect(bad({ type: "highlight_storefront", merchantId: NORTHLINE, parcelId: POPUP, label: "x" })).toBe("parcel not open right now");
    const live = buildCityIndex(snapshot, dropWindow(NOW).start.getTime() + 1000);
    expect(validateAIAction({ type: "highlight_storefront", merchantId: NORTHLINE, parcelId: POPUP, label: "x" }, live).ok).toBe(true);
  });

  it("open_merchant / open_product / escalate: singletons must exist", () => {
    ok({ type: "open_merchant", merchantId: NORTHLINE });
    ok({ type: "open_product", productId: MERIDIAN });
    ok({ type: "escalate", merchantId: EMBER, reason: "allergy" });
    expect(bad({ type: "open_merchant", merchantId: "ghost" })).toBe("unknown merchant");
    expect(bad({ type: "open_product", productId: "ghost" })).toBe("unknown product");
    expect(bad({ type: "escalate", merchantId: "ghost", reason: "x" })).toBe("unknown merchant");
  });

  it("recommend: filters ids down to the ones in the city and rejects an empty result", () => {
    const action = ok({ type: "recommend", productIds: [MERIDIAN, "nope"], merchantIds: ["ghost", EMBER], reason: "r" });
    expect(action).toEqual({ type: "recommend", productIds: [MERIDIAN], merchantIds: [EMBER], reason: "r" });
    expect(bad({ type: "recommend", productIds: ["nope"], merchantIds: [] })).toBe("no known ids");
  });
});
