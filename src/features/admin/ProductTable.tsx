"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui";
import type { DietaryTag, LeadTime } from "@/types/domain";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import type { Extraction } from "@/lib/onboarding/types";
import { dietaryTagSchema } from "@/lib/validation/ai";
import { dollarsInput, parseDollars, priceCheck, variantSummary, type PriceCheck, type Proposal, type ProposalProduct } from "./editor";
import { CommaListField, inputClass, Section, Thumb, Toggle } from "./fields";

const DIETARY: readonly DietaryTag[] = dietaryTagSchema.options;
const dietaryLabel = (t: DietaryTag) => t.replace(/_/g, " ");

/**
 * Products as proposed, one row each, with every field a customer will see: include/exclude,
 * title, price, "was" price, category, image, description, and (under "Shown to customers") the
 * featured flag, lead time and attribute chips (dietary, allergens, calories, spice, material,
 * sizes, colours). Each row is checked against its own source product: a price, "was" price or
 * option price the source does not charge, or a claim it does not make, is flagged on the row and
 * needs a second confirmation at approval.
 */
export function ProductTable({ proposal, extraction, onChange }: { proposal: Proposal; extraction: Extraction; onChange: (p: Proposal) => void }) {
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
            <ProductRow key={`${p.slug}-${i}`} product={p} check={priceCheck(p, extraction)} onChange={(next) => replace(i, next)} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Dollar input with local text so "12." can be typed; commits cents (or null for an empty optional field). */
function useDollarField(initial: number | undefined, commit: (cents: number | null) => void, optional: boolean) {
  const [text, setText] = useState(initial === undefined ? "" : dollarsInput(initial));
  const [error, setError] = useState<string | null>(null);
  const onText = (value: string) => {
    setText(value);
    if (optional && value.trim() === "") {
      setError(null);
      commit(null);
      return;
    }
    const cents = parseDollars(value);
    if (cents === null) {
      setError("Use dollars, e.g. 68.00");
      return;
    }
    setError(null);
    commit(cents);
  };
  return { text, error, onText };
}

function ProductRow({ product: p, check, onChange }: { product: ProposalProduct; check: PriceCheck; onChange: (next: ProposalProduct) => void }) {
  const set = (patch: Partial<ProposalProduct>) => onChange({ ...p, ...patch });
  const price = useDollarField(p.priceCents, (cents) => cents !== null && set({ priceCents: cents }), false);
  const compare = useDollarField(
    p.compareAtPriceCents,
    (cents) => {
      const { compareAtPriceCents: _drop, ...rest } = p;
      void _drop;
      onChange(cents === null ? rest : { ...rest, compareAtPriceCents: cents });
    },
    true,
  );
  /** The main image leads `images`; clearing it removes it from both. */
  const setImage = (url: string) => {
    const v = url.trim();
    const { imageUrl: previous, ...rest } = p;
    const others = p.images.filter((x) => x !== previous && x !== v);
    onChange(v ? { ...rest, imageUrl: v, images: [v, ...others].slice(0, 8) } : { ...rest, images: others });
  };
  const sourceDescription = check.source?.description ?? "";
  const descriptionDiffers = check.claims.some((c) => c.startsWith("Description"));
  const flags = [...check.price, ...check.claims.filter((c) => !c.startsWith("Description"))];

  return (
    <li className={cn("rounded-xl border border-line p-3 transition-opacity", !p.active && "opacity-55", p.active && flags.length && "border-sodium/40")} data-testid="product-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 md:min-h-9 md:pt-1">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-signal)]" checked={p.active} onChange={(e) => set({ active: e.target.checked })} aria-label={`Include ${p.title}`} />
          <span className="text-[12px] text-fog-2 md:hidden">{p.active ? "Included" : "Excluded"}</span>
        </label>
        <Thumb src={p.imageUrl} alt={p.title} className="h-16 w-16" />
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem]">
          <RowField label="Title">
            <input className={inputClass} value={p.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </RowField>
          <RowField label="Price (USD)" error={price.error}>
            <input inputMode="decimal" className={cn(inputClass, "tabular", (price.error || check.notInSource) && "border-sodium/60")} value={price.text} onChange={(e) => price.onText(e.target.value)} data-testid="product-price" />
          </RowField>
          <RowField label="Was (optional)" error={compare.error}>
            <input inputMode="decimal" className={cn(inputClass, "tabular", compare.error && "border-sodium/60")} value={compare.text} placeholder="None" onChange={(e) => compare.onText(e.target.value)} data-testid="product-compare-at" />
          </RowField>
          <RowField label="Category">
            <input className={inputClass} value={p.category} maxLength={64} onChange={(e) => set({ category: e.target.value.toLowerCase() })} />
          </RowField>
          <RowField
            label="Description (shown to customers)"
            className="sm:col-span-4"
            note={
              descriptionDiffers ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 text-sodium">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Differs from the source.
                  {check.source ? (
                    <button type="button" className="min-h-11 underline underline-offset-2 hover:text-fog sm:min-h-0" onClick={() => set({ description: sourceDescription })}>
                      Use the store&apos;s text
                    </button>
                  ) : null}
                </span>
              ) : (
                `Same as the source · ${p.description.length}/600`
              )
            }
          >
            <textarea rows={2} className={cn(inputClass, "resize-y leading-relaxed", descriptionDiffers && "border-sodium/60")} value={p.description} maxLength={600} onChange={(e) => set({ description: e.target.value })} data-testid="product-description" />
          </RowField>
          <RowField label="Image URL" className="sm:col-span-4">
            <input type="url" className={inputClass} value={p.imageUrl ?? ""} placeholder="Image URL" onChange={(e) => setImage(e.target.value)} />
          </RowField>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fog-3 sm:col-span-4">
            <span className="tabular">
              Source:{" "}
              {check.sourceCents !== undefined
                ? `${formatCents(check.sourceCents)}${check.sourceCompareAtCents !== undefined ? ` (was ${formatCents(check.sourceCompareAtCents)})` : ""}`
                : "not matched"}
            </span>
            <span className="min-w-0 flex-1 truncate" title={variantSummary(p.variantGroups)}>
              {variantSummary(p.variantGroups)}
            </span>
            <Badge tone={p.inventoryStatus === "in_stock" ? "mint" : p.inventoryStatus === "out_of_stock" ? "danger" : "sodium"}>{p.inventoryStatus.replace("_", " ")}</Badge>
          </div>
          {flags.length ? (
            <ul className="flex flex-col gap-0.5 text-[12px] text-sodium sm:col-span-4" data-testid="product-flags">
              {flags.map((f) => (
                <li key={f} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {f}
                </li>
              ))}
            </ul>
          ) : null}
          <CustomerDetails product={p} check={check} onChange={onChange} />
        </div>
      </div>
    </li>
  );
}

function leadTimeText(lt: LeadTime): string | null {
  const range = (a: number | undefined, b: number | undefined, unit: string) => {
    const lo = a ?? b;
    const hi = b ?? a;
    return lo === undefined ? null : lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`;
  };
  return range(lt.daysMin, lt.daysMax, "days") ?? range(lt.minutesMin, lt.minutesMax, "min");
}

/** One-line summary of everything else a customer sees, so nothing is hidden behind the toggle. */
function detailSummary(p: ProposalProduct): string {
  const a = p.attributes;
  const lead = leadTimeText(p.leadTime);
  return [
    p.featured ? "Featured" : null,
    lead ? `Lead time ${lead}` : null,
    a.dietary?.length ? a.dietary.map(dietaryLabel).join(", ") : null,
    a.allergens?.length ? `Contains: ${a.allergens.join(", ")}` : null,
    a.calories !== undefined ? `${a.calories} kcal` : null,
    a.spiceLevel !== undefined ? `Spice ${a.spiceLevel}/4` : null,
    a.material ? a.material : null,
    a.sizes?.length ? `Sizes ${a.sizes.join(" · ")}` : null,
    a.colors?.length ? `Colours ${a.colors.join(" · ")}` : null,
    a.occasion?.length ? `For ${a.occasion.join(", ")}` : null,
    a.serves ? `Serves ${a.serves}` : null,
    a.gender ? a.gender : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const numberOrUndefined = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v)));

function CustomerDetails({ product: p, check, onChange }: { product: ProposalProduct; check: PriceCheck; onChange: (next: ProposalProduct) => void }) {
  const a = p.attributes;
  const unsourcedClaim = check.claims.some((c) => !c.startsWith("Description"));
  const setAttr = <K extends keyof ProposalProduct["attributes"]>(key: K, value: ProposalProduct["attributes"][K] | undefined) => {
    const next = { ...a };
    const empty = value === undefined || (Array.isArray(value) && value.length === 0) || value === "";
    if (empty) delete next[key];
    else next[key] = value;
    onChange({ ...p, attributes: next });
  };
  const days = p.leadTime.daysMin !== undefined || p.leadTime.daysMax !== undefined || (p.leadTime.minutesMin === undefined && p.leadTime.minutesMax === undefined);
  const [minKey, maxKey] = days ? (["daysMin", "daysMax"] as const) : (["minutesMin", "minutesMax"] as const);
  const setLead = (key: keyof LeadTime, raw: string) => {
    const next = { ...p.leadTime };
    const n = numberOrUndefined(raw);
    if (n === undefined) delete next[key];
    else next[key] = Math.max(0, n);
    onChange({ ...p, leadTime: next });
  };
  const summary = detailSummary(p);
  // Opens by itself when a claim needs checking; after that the reviewer controls it.
  const [initiallyOpen] = useState(unsourcedClaim);

  return (
    <details className="group rounded-lg border border-line/70 sm:col-span-4" open={initiallyOpen} data-testid="product-details">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[12px] text-fog-2 sm:min-h-9">
        <span className="font-medium text-fog">Shown to customers</span>
        <span className="min-w-0 flex-1 truncate text-fog-3" title={summary}>
          {summary || "No extra details"}
        </span>
      </summary>
      <div className="grid gap-3 border-t border-line/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="mb-1 text-[12px] font-medium text-fog-2">Dietary (only what the store states)</legend>
          <div className="flex flex-wrap gap-1.5">
            {DIETARY.map((tag) => {
              const on = Boolean(a.dietary?.includes(tag));
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAttr("dietary", on ? (a.dietary ?? []).filter((t) => t !== tag) : [...(a.dietary ?? []), tag])}
                  className={cn("min-h-11 rounded-full border px-3 text-[12px] capitalize transition-colors sm:min-h-8", on ? "border-mint/50 bg-mint/15 text-fog" : "border-line text-fog-3 hover:bg-white/5 hover:text-fog")}
                >
                  {dietaryLabel(tag)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <CommaListField label="Allergens (Contains: …)" value={a.allergens ?? []} onChange={(v) => setAttr("allergens", v)} placeholder="e.g. milk, wheat" />
        <RowField label="Calories">
          <input inputMode="numeric" className={inputClass} value={a.calories ?? ""} placeholder="Not stated" onChange={(e) => setAttr("calories", numberOrUndefined(e.target.value))} />
        </RowField>
        <RowField label="Spice level">
          <select className={inputClass} value={a.spiceLevel ?? ""} onChange={(e) => setAttr("spiceLevel", e.target.value === "" ? undefined : (Number(e.target.value) as 0 | 1 | 2 | 3 | 4))}>
            <option value="">Not set</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} of 4
              </option>
            ))}
          </select>
        </RowField>
        <RowField label="Material">
          <input className={inputClass} value={a.material ?? ""} maxLength={80} placeholder="Not stated" onChange={(e) => setAttr("material", e.target.value || undefined)} />
        </RowField>
        <CommaListField label="Sizes" value={a.sizes ?? []} onChange={(v) => setAttr("sizes", v)} />
        <CommaListField label="Colours" value={a.colors ?? []} onChange={(v) => setAttr("colors", v)} />
        <RowField label={`Lead time min (${days ? "days" : "minutes"})`}>
          <input inputMode="numeric" className={inputClass} value={p.leadTime[minKey] ?? ""} onChange={(e) => setLead(minKey, e.target.value)} />
        </RowField>
        <RowField label={`Lead time max (${days ? "days" : "minutes"})`}>
          <input inputMode="numeric" className={inputClass} value={p.leadTime[maxKey] ?? ""} onChange={(e) => setLead(maxKey, e.target.value)} />
        </RowField>
        <div className="sm:col-span-2 lg:col-span-4">
          <Toggle label="Featured" hint="Listed first in the store and its window display." checked={p.featured} onChange={(featured) => onChange({ ...p, featured })} />
        </div>
      </div>
    </details>
  );
}

/** Label wraps the control; the note sits outside it, so a button in the note is not inside a label. */
function RowField({ label, className, error, note, children }: { label: string; className?: string; error?: string | null; note?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] text-fog-3">{label}</span>
        {children}
      </label>
      {error ? <span className="text-[12px] text-danger">{error}</span> : note ? <span className="text-[12px] text-fog-3">{note}</span> : null}
    </div>
  );
}
