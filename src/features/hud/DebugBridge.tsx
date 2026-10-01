"use client";

import { useEffect } from "react";
import { enterMerchant, exitInterior, inspectProduct, talkToEmployee, teleportTo } from "@/city/cityActions";
import { getCityIndex } from "@/city/cityStore";
import { parseDeepLinkTarget } from "@/city/navigation";
import { useWorldStore } from "@/engine/store/worldStore";
import { variantProblem } from "@/features/cart/pricing";
import { useEntitlementStore } from "@/features/entitlements/entitlementStore";
import { useEventPanelStore } from "@/features/events/eventPanelStore";
import { now as clockNow } from "@/lib/time/clock";

export interface ChifirDebugApi {
  teleportTo: typeof teleportTo;
  enterMerchant: typeof enterMerchant;
  exitInterior: typeof exitInterior;
  inspectProduct: typeof inspectProduct;
  talkToEmployee: typeof talkToEmployee;
  /**
   * Opens the first purchasable product of the merchant the player is inside (or the given one).
   * Products that only need a variant choice count as purchasable (the test picks the option).
   */
  inspectFirstProduct: (merchantId?: string) => boolean;
  /** Opens a product by its catalog slug (any merchant). */
  inspectProductBySlug: (slug: string) => boolean;
  world: () => ReturnType<typeof useWorldStore.getState>;
  /** Teleports to a `?to=` style value (merchant slug, `event:`, `district:`, `parcel:`). */
  teleportToDeepLink: (value: string) => boolean;
  /** The city clock (ms), including any demo offset. */
  now: () => number;
  openEvent: (eventId: string) => void;
  /** Grants a reward from the loaded snapshot to this browser and equips it when wearable. */
  grantEntitlement: (rewardId: string) => boolean;
  entitlements: () => ReturnType<typeof useEntitlementStore.getState>;
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
        const parcelId = world.location.kind === "interior" ? world.location.parcelId : undefined;
        const parcel = parcelId ? index.parcelsById[parcelId] : undefined;
        const event = parcel ? index.eventByParcel[parcel.id] : undefined;
        const inPopup = Boolean(parcel && event && parcel.id !== index.parcelByMerchant[id]?.id);
        const pool =
          inPopup && event
            ? event.productIds.map((pid) => index.productsById[pid]).filter((p): p is NonNullable<typeof p> => Boolean(p))
            : (index.productsByMerchant[id] ?? []);
        const product = pool.find((p) => {
          const problem = variantProblem(p, {});
          return problem === null || problem.startsWith("Choose a");
        });
        return product ? inspectProduct(product.id, "panel") : false;
      },
      inspectProductBySlug: (slug) => {
        const index = getCityIndex();
        const product = index ? Object.values(index.productsById).find((p) => p.slug === slug) : undefined;
        return product ? inspectProduct(product.id, "panel") : false;
      },
      world: () => useWorldStore.getState(),
      teleportToDeepLink: (value) => {
        const index = getCityIndex();
        const target = index ? parseDeepLinkTarget(value, index) : null;
        return target ? teleportTo(target, "hud") : false;
      },
      now: () => clockNow(),
      openEvent: (eventId) => useEventPanelStore.getState().open(eventId),
      grantEntitlement: (rewardId) => {
        const reward = getCityIndex()?.rewardsById[rewardId];
        if (!reward) return false;
        const store = useEntitlementStore.getState();
        store.grant([reward], "admin");
        if (reward.avatarSlot) store.equip(reward.id);
        return true;
      },
      entitlements: () => useEntitlementStore.getState(),
    };
    window.__chifirDebug = api;
    return () => {
      if (window.__chifirDebug === api) delete window.__chifirDebug;
    };
  }, []);
  return null;
}
