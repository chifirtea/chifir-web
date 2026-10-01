/* eslint-disable no-restricted-imports -- test only: seed modules never reach the client bundle */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildParcels, districts } from "@/data/seed/districts";
import { buildEvents } from "@/data/seed/events";
import { sid } from "@/data/seed/ids";
import { employees, merchants } from "@/data/seed/merchants";
import { buildOffers } from "@/data/seed/offers";
import { buildProducts } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import type { CitySnapshot } from "@/lib/data/types";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/features/cart/cartStore", async () => {
  const { create } = await import("zustand");
  const useCartStore = create<{ lines: unknown[]; addLine: (input: unknown) => unknown }>((set, get) => ({
    lines: [],
    addLine: (input) => {
      set({ lines: [...get().lines, input] });
      return input;
    },
  }));
  return { useCartStore };
});
// The storefront registry needs the three.js templates; the pose is irrelevant here.
vi.mock("@/city/navigation", () => ({
  resolveNavTarget: vi.fn(() => ({ pose: { x: 1, z: 2, yaw: 0 }, label: "Somewhere" })),
}));

import { track } from "@/lib/analytics/client";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { useCartStore } from "@/features/cart/cartStore";
import { executeAIAction, highlightParcel, openMerchantPanel } from "./cityActions";
import { useCityStore } from "./cityStore";

const NOW = new Date("2026-09-30T23:30:00Z");
const snapshot: CitySnapshot = {
  districts,
  parcels: buildParcels(NOW),
  merchants,
  products: buildProducts(NOW),
  employees,
  events: buildEvents(NOW),
  offers: buildOffers(NOW),
  rewards,
  generatedAt: NOW.toISOString(),
};

const EMBER = sid.merchant("ember-and-oak");
const NORTHLINE = sid.merchant("northline-supply");
const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
const MERIDIAN = sid.product("northline-supply", "meridian-hoodie");
const EMBER_PARCEL = sid.parcel("fs-n1");
const NORTHLINE_FLAGSHIP = sid.parcel("fa-n2");
const POPUP = sid.parcel("es-pop1");

const tracked = vi.mocked(track);

beforeEach(() => {
  useCityStore.getState().setSnapshot(snapshot, NOW.getTime());
  useWorldStore.getState().resetTransition();
  useWorldStore.getState().closeAllPanels();
  useWorldStore.getState().setHighlightedParcel(null);
  useWorldStore.getState().setWaypoint(null);
  useWorldStore.getState().setLocation({ kind: "street" });
  useCartStore.setState({ lines: [] });
  tracked.mockClear();
});

describe("executeAIAction: highlight_storefront", () => {
  it("lights up the resolved parcel and reports acceptance", () => {
    const accepted = executeAIAction({ type: "highlight_storefront", merchantId: EMBER, parcelId: EMBER_PARCEL, label: "Ember & Oak" });
    expect(accepted).toBe(true);
    expect(useWorldStore.getState().highlightedParcelId).toBe(EMBER_PARCEL);
    expect(tracked).toHaveBeenCalledWith("ai_action_executed", { action: "highlight_storefront", accepted: true });
  });

  it("falls back to the merchant's storefront parcel when none is given", () => {
    expect(executeAIAction({ type: "highlight_storefront", merchantId: NORTHLINE, label: "Northline" })).toBe(true);
    expect(useWorldStore.getState().highlightedParcelId).toBe(NORTHLINE_FLAGSHIP);
  });

  it("refuses parcels that are not open now, unknown merchants, and clears on null", () => {
    expect(executeAIAction({ type: "highlight_storefront", merchantId: NORTHLINE, parcelId: POPUP, label: "Pop-up" })).toBe(false);
    expect(useWorldStore.getState().highlightedParcelId).toBeNull();
    expect(executeAIAction({ type: "highlight_storefront", merchantId: "ghost", label: "x" })).toBe(false);
    expect(tracked).toHaveBeenLastCalledWith("ai_action_executed", { action: "highlight_storefront", accepted: false });
    highlightParcel(EMBER_PARCEL, "ai");
    expect(highlightParcel(null, "ai")).toBe(false);
    expect(useWorldStore.getState().highlightedParcelId).toBeNull();
  });
});

describe("executeAIAction: panels", () => {
  it("open_merchant opens the merchant sheet, which locks input and closes with the other panels", () => {
    expect(executeAIAction({ type: "open_merchant", merchantId: EMBER })).toBe(true);
    expect(useWorldStore.getState().merchantPanelId).toBe(EMBER);
    expect(selectInputLocked(useWorldStore.getState())).toBe(true);
    useWorldStore.getState().closeAllPanels();
    expect(useWorldStore.getState().merchantPanelId).toBeNull();
    expect(selectInputLocked(useWorldStore.getState())).toBe(false);
    expect(executeAIAction({ type: "open_merchant", merchantId: "ghost" })).toBe(false);
    expect(openMerchantPanel("ghost")).toBe(false);
  });

  it("open_product focuses the product sign and tracks the inspection as AI-sourced", () => {
    expect(executeAIAction({ type: "open_product", productId: MERIDIAN })).toBe(true);
    expect(useWorldStore.getState().focusedProductId).toBe(MERIDIAN);
    expect(tracked).toHaveBeenCalledWith("product_inspected", { productId: MERIDIAN, merchantId: NORTHLINE, source: "ai" });
    expect(executeAIAction({ type: "open_product", productId: "ghost" })).toBe(false);
    expect(useWorldStore.getState().focusedProductId).toBe(MERIDIAN);
  });
});

describe("executeAIAction: recommend, navigate, propose_cart", () => {
  it("recommend is accepted only when at least one id is in the city", () => {
    expect(executeAIAction({ type: "recommend", productIds: [HELLFIRE], merchantIds: [], reason: "r" })).toBe(true);
    expect(executeAIAction({ type: "recommend", productIds: [], merchantIds: [EMBER] })).toBe(true);
    expect(executeAIAction({ type: "recommend", productIds: ["nope"], merchantIds: ["ghost"] })).toBe(false);
  });

  it("navigate guide sets a waypoint; teleport starts a transition and clears the waypoint", () => {
    expect(executeAIAction({ type: "navigate", target: { kind: "merchant", merchantId: EMBER }, mode: "guide", label: "Ember & Oak" })).toBe(true);
    expect(useWorldStore.getState().waypoint).toMatchObject({ x: 1, z: 2, label: "Somewhere" });
    expect(tracked).toHaveBeenCalledWith("waypoint_set", { targetKind: "merchant", source: "ai" });
    expect(executeAIAction({ type: "navigate", target: { kind: "merchant", merchantId: EMBER }, mode: "teleport", label: "Ember & Oak" })).toBe(true);
    expect(useWorldStore.getState().transition).toBe("out");
    expect(useWorldStore.getState().waypoint).toBeNull();
    expect(tracked).toHaveBeenCalledWith("teleport", { targetKind: "merchant", source: "ai" });
  });

  it("propose_cart adds complete lines and opens the cart; a missing variant opens the product instead", () => {
    expect(executeAIAction({ type: "propose_cart", items: [{ productId: HELLFIRE, quantity: 2 }] })).toBe(true);
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useWorldStore.getState().cartOpen).toBe(true);
    useWorldStore.getState().closeAllPanels();
    expect(executeAIAction({ type: "propose_cart", items: [{ productId: MERIDIAN, quantity: 1 }] })).toBe(true);
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useWorldStore.getState().focusedProductId).toBe(MERIDIAN);
    expect(executeAIAction({ type: "propose_cart", items: [{ productId: "nope", quantity: 1 }] })).toBe(false);
  });
});
