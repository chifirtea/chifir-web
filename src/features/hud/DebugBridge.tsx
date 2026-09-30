"use client";

import { useEffect } from "react";
import { enterMerchant, exitInterior, inspectProduct, talkToEmployee, teleportTo } from "@/city/cityActions";
import { getCityIndex } from "@/city/cityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { variantProblem } from "@/features/cart/pricing";

export interface ChifirDebugApi {
  teleportTo: typeof teleportTo;
  enterMerchant: typeof enterMerchant;
  exitInterior: typeof exitInterior;
  inspectProduct: typeof inspectProduct;
  talkToEmployee: typeof talkToEmployee;
  /** Opens the first purchasable product of the merchant the player is inside (or the given one). */
  inspectFirstProduct: (merchantId?: string) => boolean;
  world: () => ReturnType<typeof useWorldStore.getState>;
}

declare global {
  interface Window {
    __chifirDebug?: ChifirDebugApi;
  }
}

/**
 * Development-only bridge for QA and end-to-end tests: exposes the action bus on `window` so a
 * test can open panels deterministically instead of depending on frame-rate-bound walking.
 * Never rendered in production builds.
 */
export function DebugBridge() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const api: ChifirDebugApi = {
      teleportTo,
      enterMerchant,
      exitInterior,
      inspectProduct,
      talkToEmployee,
      inspectFirstProduct: (merchantId) => {
        const index = getCityIndex();
        const world = useWorldStore.getState();
        const id = merchantId ?? (world.location.kind === "interior" ? world.location.merchantId : undefined);
        if (!index || !id) return false;
        const product = (index.productsByMerchant[id] ?? []).find((p) => variantProblem(p, {}) === null);
        return product ? inspectProduct(product.id, "panel") : false;
      },
      world: () => useWorldStore.getState(),
    };
    window.__chifirDebug = api;
    return () => {
      if (window.__chifirDebug === api) delete window.__chifirDebug;
    };
  }, []);
  return null;
}
