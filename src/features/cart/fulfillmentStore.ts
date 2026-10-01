import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FulfillmentSelection, FulfillmentType } from "@/types/domain";

export interface FulfillmentState {
  /** merchantId -> chosen type. Merchants missing here fall back to `defaultFulfillmentFor`. */
  selection: FulfillmentSelection;
  promoCode: string;
  setType: (merchantId: string, type: FulfillmentType) => void;
  setPromoCode: (code: string) => void;
}

export const FULFILLMENT_STORAGE_KEY = "chifir.fulfillment.v1";

/** How each merchant's lines should be fulfilled, plus the promo code. Persisted with the cart. */
export const useFulfillmentStore = create<FulfillmentState>()(
  persist(
    (set, get) => ({
      selection: {},
      promoCode: "",
      setType: (merchantId, type) => set({ selection: { ...get().selection, [merchantId]: type } }),
      setPromoCode: (code) => set({ promoCode: code.trim().toUpperCase().slice(0, 32) }),
    }),
    {
      name: FULFILLMENT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ selection: s.selection, promoCode: s.promoCode }),
    },
  ),
);
