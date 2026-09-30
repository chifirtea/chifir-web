"use client";

import { ChevronRight } from "lucide-react";
import { Badge, Price, ProductImage } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCityStore } from "@/city/cityStore";
import { DietaryChips, SpiceFlames, inventoryNote } from "./attributes";

export interface ProductListProps {
  merchantId: string;
  onSelect: (productId: string) => void;
  className?: string;
  /** Cap the list (e.g. an employee recommending a few items). */
  limit?: number;
}

/**
 * A merchant's shelf as a compact list: thumb, title, price, a couple of chips. Used by the
 * employee panel and the places panel; selecting an item opens the product panel via `onSelect`.
 */
export function ProductList({ merchantId, onSelect, className, limit }: ProductListProps) {
  const index = useCityStore((s) => s.index);
  if (!index) return <p className={cn("px-1 py-3 text-sm text-fog-3", className)}>Loading the menu…</p>;
  const merchant = index.merchantsById[merchantId];
  const products = (index.productsByMerchant[merchantId] ?? []).slice(0, limit ?? Infinity);
  if (products.length === 0) {
    return <p className={cn("px-1 py-3 text-sm text-fog-3", className)}>Nothing on the shelves right now.</p>;
  }
  return (
    <ul className={cn("divide-y divide-line", className)} aria-label={merchant ? `${merchant.name} menu` : "Menu"}>
      {products.map((p) => {
        const note = inventoryNote(p.inventoryStatus, p.inventoryCount);
        const soldOut = p.inventoryStatus === "out_of_stock";
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-white/4",
                soldOut && "opacity-60",
              )}
            >
              <ProductImage src={p.imageUrl} alt="" label={p.title} brand={merchant?.brand} className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{p.title}</p>
                  <Price cents={p.priceCents} currency={p.currency} compareAtCents={p.compareAtPriceCents} className="shrink-0 text-sm" />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {p.attributes.spiceLevel ? <SpiceFlames level={p.attributes.spiceLevel} /> : null}
                  <DietaryChips tags={p.attributes.dietary} compact />
                  {note ? <Badge tone={note.tone}>{note.text}</Badge> : null}
                  {p.digitalRewardId ? <Badge tone="sodium">Digital twin</Badge> : null}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-fog-3" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
