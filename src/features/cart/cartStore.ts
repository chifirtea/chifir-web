import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CartLine } from "@/types/domain";
import { lineKey } from "./pricing";

export interface AddLineInput {
  productId: string;
  merchantId: string;
  quantity?: number;
  variantSelection?: Record<string, string>;
  notes?: string;
}

export interface CartState {
  lines: CartLine[];
  /** Incremented on every add so the HUD can animate. */
  lastAddedAt: number;
  addLine: (input: AddLineInput) => CartLine;
  removeLine: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

export const CART_STORAGE_KEY = "chifir.cart.v1";
export const MAX_LINE_QUANTITY = 99;

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      lastAddedAt: 0,
      addLine: (input) => {
        const variantSelection = input.variantSelection ?? {};
        const key = lineKey(input.productId, variantSelection);
        const raw = input.quantity ?? 1;
        const quantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, Number.isInteger(raw) ? raw : 1));
        const existing = get().lines.find((l) => l.key === key);
        let line: CartLine;
        if (existing) {
          line = {
            ...existing,
            quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + quantity),
            ...(input.notes ? { notes: input.notes } : {}),
          };
          set({ lines: get().lines.map((l) => (l.key === key ? line : l)), lastAddedAt: Date.now() });
        } else {
          line = {
            key,
            productId: input.productId,
            merchantId: input.merchantId,
            quantity,
            variantSelection,
            ...(input.notes ? { notes: input.notes } : {}),
          };
          set({ lines: [...get().lines, line], lastAddedAt: Date.now() });
        }
        return line;
      },
      removeLine: (key) => set({ lines: get().lines.filter((l) => l.key !== key) }),
      setQuantity: (key, quantity) => {
        if (!Number.isInteger(quantity)) return;
        if (quantity <= 0) {
          set({ lines: get().lines.filter((l) => l.key !== key) });
          return;
        }
        set({
          lines: get().lines.map((l) =>
            l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, quantity) } : l,
          ),
        });
      },
      clear: () => set({ lines: [] }),
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: s.lines }),
    },
  ),
);

export const selectCartCount = (s: CartState): number => s.lines.reduce((n, l) => n + l.quantity, 0);
