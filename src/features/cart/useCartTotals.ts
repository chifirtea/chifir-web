"use client";

import { useMemo } from "react";
import type {
  CartLine,
  FulfillmentSelection,
  FulfillmentType,
  Merchant,
  Offer,
  Product,
} from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { useCartStore } from "./cartStore";
import { useFulfillmentStore } from "./fulfillmentStore";
import {
  availableFulfillmentTypes,
  computeTotals,
  defaultFulfillmentFor,
  type CartTotals,
} from "./pricing";

export interface MerchantGroup {
  merchantId: string;
  merchant: Merchant | undefined;
  lines: CartLine[];
  /** Products for the lines above (missing products are skipped). */
  products: Product[];
  /** Types both the merchant and every product in the group support. */
  availableTypes: FulfillmentType[];
  /** The effective choice for this merchant (persisted choice, else the default), or null when none fits. */
  type: FulfillmentType | null;
}

export interface CartTotalsView {
  totals: CartTotals;
  linesByMerchant: MerchantGroup[];
  /** Effective per-merchant selection (defaults filled in) as sent to checkout. */
  selection: FulfillmentSelection;
  availableTypes: (merchantId: string) => FulfillmentType[];
  promoCode: string;
  /** Live offers from the city index. */
  offers: Offer[];
  /** False until the city index has loaded; totals are zero until then. */
  ready: boolean;
}

const EMPTY_TYPES: FulfillmentType[] = [];

/**
 * The client-side preview of what checkout will charge. Same `computeTotals` the server runs,
 * over the same catalog snapshot the city renders from.
 */
export function useCartTotals(): CartTotalsView {
  const lines = useCartStore((s) => s.lines);
  const index = useCityStore((s) => s.index);
  const stored = useFulfillmentStore((s) => s.selection);
  const promoCode = useFulfillmentStore((s) => s.promoCode);

  return useMemo(() => {
    const productsById = index?.productsById ?? {};
    const merchantsById = index?.merchantsById ?? {};
    const offers = index ? Object.values(index.offersByMerchant).flat() : [];

    const order: string[] = [];
    const byMerchant = new Map<string, CartLine[]>();
    for (const line of lines) {
      const merchantId = productsById[line.productId]?.merchantId ?? line.merchantId;
      if (!byMerchant.has(merchantId)) {
        byMerchant.set(merchantId, []);
        order.push(merchantId);
      }
      byMerchant.get(merchantId)!.push(line);
    }

    const selection: FulfillmentSelection = {};
    const linesByMerchant: MerchantGroup[] = order.map((merchantId) => {
      const groupLines = byMerchant.get(merchantId)!;
      const merchant = merchantsById[merchantId];
      const products = groupLines
        .map((l) => productsById[l.productId])
        .filter((p): p is Product => Boolean(p));
      const availableTypes = availableFulfillmentTypes(merchant, products);
      const chosen = stored[merchantId];
      const type =
        chosen && availableTypes.includes(chosen)
          ? chosen
          : defaultFulfillmentFor(merchant, products);
      if (type) selection[merchantId] = type;
      return { merchantId, merchant, lines: groupLines, products, availableTypes, type };
    });

    const totals = computeTotals(lines, productsById, merchantsById, selection, {
      offers,
      ...(promoCode ? { promoCode } : {}),
    });
    const groups = new Map(linesByMerchant.map((g) => [g.merchantId, g.availableTypes]));
    return {
      totals,
      linesByMerchant,
      selection,
      availableTypes: (merchantId: string) => groups.get(merchantId) ?? EMPTY_TYPES,
      promoCode,
      offers,
      ready: index !== null,
    };
  }, [lines, index, stored, promoCode]);
}
