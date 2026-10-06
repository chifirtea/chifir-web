"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import type { Extraction } from "@/lib/onboarding/types";
import { dollarsInput, parseDollars, priceCheck, sourcePriceSet, variantSummary, type Proposal, type ProposalProduct } from "./editor";
import { inputClass, Section, Thumb } from "./fields";

/**
 * Products as proposed, one row each: include/exclude, editable title/price/category/image, the
 * variant summary, and the source price beside the proposed one. A price that is not in the
 * source catalog is flagged on the row and again in the approval checklist.
 */
export function ProductTable({ proposal, extraction, onChange }: { proposal: Proposal; extraction: Extraction; onChange: (p: Proposal) => void }) {
  const prices = useMemo(() => sourcePriceSet(extraction), [extraction]);
  const products = proposal.products;
  const included = products.filter((p) => p.active).length;
  const replace = (index: number, next: ProposalProduct) =>
    onChange({ ...proposal, products: products.map((p, i) => (i === index ? next : p)) });
  const setAll = (active: boolean) => onChange({ ...proposal, products: products.map((p) => ({ ...p, active })) });

  return (
    <Section
      eyebrow="Catalog"
      title={`Products (${included} of ${products.length} included)`}
      aside={
        products.length ? (
          <div className="flex gap-1">
            <button type="button" className="min-h-11 rounded-lg px-2 text-[12px] text-fog-2 hover:bg-white/5 hover:text-fog sm:min-h-9" onClick={() => setAll(true)}>
              Include all
            </button>
            <button type="button" className="min-h-11 rounded-lg px-2 text-[12px] text-fog-2 hover:bg-white/5 hover:text-fog sm:min-h-9" onClick={() => setAll(false)}>
              Exclude all
            </button>
          </div>
        ) : null
      }
    >
      {products.length === 0 ? (
        <p className="text-[14px] text-fog-3">The proposal has no products. A store needs at least one before it can be approved.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="product-table">
          {products.map((p, i) => (
            <ProductRow key={`${p.slug}-${i}`} product={p} check={priceCheck(p, extraction, prices)} onChange={(next) => replace(i, next)} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProductRow({ product: p, check, onChange }: { product: ProposalProduct; check: ReturnType<typeof priceCheck>; onChange: (next: ProposalProduct) => void }) {
  const set = (patch: Partial<ProposalProduct>) => onChange({ ...p, ...patch });
  const [priceText, setPriceText] = useState(dollarsInput(p.priceCents));
  const [priceError, setPriceError] = useState<string | null>(null);
  const commitPrice = (text: string) => {
    setPriceText(text);
    const cents = parseDollars(text);
    if (cents === null) {
      setPriceError("Use dollars, e.g. 68.00");
      return;
    }
    setPriceError(null);
    set({ priceCents: cents });
  };
  /** The main image leads `images`; clearing it removes it from both. */
  const setImage = (url: string) => {
    const v = url.trim();
    const { imageUrl: previous, ...rest } = p;
    const others = p.images.filter((x) => x !== previous && x !== v);
    onChange(v ? { ...rest, imageUrl: v, images: [v, ...others].slice(0, 8) } : { ...rest, images: others });
  };

  return (
    <li className={cn("rounded-xl border border-line p-3 transition-opacity", !p.active && "opacity-55")} data-testid="product-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 md:min-h-9 md:pt-1">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-signal)]" checked={p.active} onChange={(e) => set({ active: e.target.checked })} aria-label={`Include ${p.title}`} />
          <span className="text-[12px] text-fog-2 md:hidden">{p.active ? "Included" : "Excluded"}</span>
        </label>
        <Thumb src={p.imageUrl} alt={p.title} className="h-16 w-16" />
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_8rem_9rem]">
          <RowField label="Title">
            <input className={inputClass} value={p.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </RowField>
          <RowField label="Price (USD)">
            <input inputMode="decimal" className={cn(inputClass, "tabular", (priceError || check.notInSource) && "border-sodium/60")} value={priceText} onChange={(e) => commitPrice(e.target.value)} data-testid="product-price" />
          </RowField>
          <RowField label="Category">
            <input className={inputClass} value={p.category} maxLength={64} onChange={(e) => set({ category: e.target.value.toLowerCase() })} />
          </RowField>
          <RowField label="Image URL" className="sm:col-span-3">
            <input type="url" className={inputClass} value={p.imageUrl ?? ""} placeholder="Image URL" onChange={(e) => setImage(e.target.value)} />
          </RowField>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fog-3 sm:col-span-3">
            <span className="tabular">
              Source: {check.sourceCents !== undefined ? formatCents(check.sourceCents) : "not matched"}
            </span>
            {priceError ? <span className="text-danger">{priceError}</span> : null}
            {check.notInSource && !priceError ? (
              <span className="inline-flex items-center gap-1 text-sodium">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Not a price in the source catalog
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate" title={variantSummary(p.variantGroups)}>
              {variantSummary(p.variantGroups)}
            </span>
            <Badge tone={p.inventoryStatus === "in_stock" ? "mint" : p.inventoryStatus === "out_of_stock" ? "danger" : "sodium"}>{p.inventoryStatus.replace("_", " ")}</Badge>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Labels are visible on phones (stacked fields) and screen-reader only in the desktop grid. */
function RowField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] text-fog-3 sm:sr-only">{label}</span>
      {children}
    </label>
  );
}
