import type { CityIndex } from "@/city/cityIndex";
import { aiActionSchema } from "@/lib/validation/ai";
import type { AIAction } from "./actions";

/**
 * Client-side gate for every action the AI proposes: the shape must match the protocol and every
 * id must exist in the city index the player is looking at. Unknown ids are dropped (for lists)
 * or reject the whole action (for singletons); nothing the AI says can make the client act on a
 * merchant or product that is not in the city right now.
 */
export type ActionValidation =
  | { ok: true; action: AIAction }
  | { ok: false; reason: string };

export function validateAIAction(input: unknown, index: CityIndex | null): ActionValidation {
  const parsed = aiActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "malformed action" };
  if (!index) return { ok: false, reason: "city not loaded" };
  const action = parsed.data as AIAction;

  switch (action.type) {
    case "navigate":
      return validNavTarget(action.target, index)
        ? { ok: true, action }
        : { ok: false, reason: "unknown navigation target" };
    case "propose_cart": {
      const items = action.items.filter((i) => index.productsById[i.productId]);
      if (items.length === 0) return { ok: false, reason: "no known products" };
      return { ok: true, action: { ...action, items } };
    }
    case "escalate":
      return index.merchantsById[action.merchantId]
        ? { ok: true, action }
        : { ok: false, reason: "unknown merchant" };
    case "highlight_storefront": {
      const merchant = index.merchantsById[action.merchantId];
      if (!merchant) return { ok: false, reason: "unknown merchant" };
      const parcel = action.parcelId
        ? index.parcelsById[action.parcelId]
        : index.parcelByMerchant[action.merchantId];
      if (!parcel || parcel.merchantId !== merchant.id) return { ok: false, reason: "unknown parcel" };
      if (!index.occupiedParcels.some((p) => p.id === parcel.id)) {
        return { ok: false, reason: "parcel not open right now" };
      }
      return { ok: true, action: { ...action, parcelId: parcel.id } };
    }
    case "open_merchant":
      return index.merchantsById[action.merchantId]
        ? { ok: true, action }
        : { ok: false, reason: "unknown merchant" };
    case "open_product":
      return index.productsById[action.productId]
        ? { ok: true, action }
        : { ok: false, reason: "unknown product" };
    case "recommend": {
      const productIds = action.productIds.filter((id) => index.productsById[id]);
      const merchantIds = action.merchantIds.filter((id) => index.merchantsById[id]);
      if (productIds.length === 0 && merchantIds.length === 0) {
        return { ok: false, reason: "no known ids" };
      }
      return { ok: true, action: { ...action, productIds, merchantIds } };
    }
  }
}

function validNavTarget(target: Extract<AIAction, { type: "navigate" }>["target"], index: CityIndex): boolean {
  switch (target.kind) {
    case "merchant":
      return Boolean(index.merchantsById[target.merchantId] && index.parcelByMerchant[target.merchantId]);
    case "district":
      return Boolean(index.districtsById[target.districtId]);
    case "parcel":
      return Boolean(index.parcelsById[target.parcelId]);
    case "event":
      return Boolean(index.eventsById[target.eventId]);
    case "point":
      return Number.isFinite(target.x) && Number.isFinite(target.z);
  }
}
