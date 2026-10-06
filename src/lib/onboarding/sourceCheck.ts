import type { DietaryTag, Product, VariantGroup } from "@/types/domain";
import type { ExtractedProduct, ExtractedVariant, Extraction } from "./types";

/**
 * Per-product comparison of a proposal with the source catalog. The server's post-validation
 * (`finalizeProposal`) and the review UI both use it, so they flag the same things: a price is
 * checked against that product's own source prices (never the whole catalog), option prices against
 * each source variant, and customer-facing claims against what the source text says.
 *
 * Client-safe: pure functions over types.
 */

export type CheckedProduct = Pick<
  Product,
  "slug" | "title" | "priceCents" | "compareAtPriceCents" | "variantGroups" | "description" | "attributes"
>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The source product a proposed product came from: the same handle (the proposal's slug), else
 * the same title. `taken` skips source products already matched, so a duplicate cannot reuse one.
 */
export function matchSourceProduct(
  product: Pick<CheckedProduct, "slug" | "title">,
  extraction: Pick<Extraction, "products">,
  taken?: ReadonlySet<ExtractedProduct>,
): ExtractedProduct | undefined {
  const free = extraction.products.filter((p) => !taken?.has(p));
  const byHandle = free.filter((p) => p.handle === product.slug);
  if (byHandle.length) return byHandle.find((p) => norm(p.title) === norm(product.title)) ?? byHandle[0];
  return free.find((p) => norm(p.title) === norm(product.title));
}

/** Every price the source lists for this one product (its base and each variant). */
export function productSourcePrices(source: ExtractedProduct): Set<number> {
  return new Set([source.priceCents, ...source.variants.map((v) => v.priceCents)]);
}

/** Compare-at ("was") prices the source lists for this product's variants at `priceCents`. */
export function sourceCompareAt(source: ExtractedProduct, priceCents: number): Set<number> {
  const out = new Set<number>();
  for (const v of source.variants) if (v.priceCents === priceCents && v.compareAtPriceCents !== undefined) out.add(v.compareAtPriceCents);
  return out;
}

/** Beyond this many option combinations the check gives up (and says so) rather than enumerate. */
export const MAX_CHECKED_COMBINATIONS = 1000;

/**
 * Option id for a "whole variant" option: names its source variant exactly, so the check below
 * does not depend on (possibly truncated, possibly colliding) titles. Undefined for ids that are
 * not short and plain.
 */
export function variantOptionId(variant: Pick<ExtractedVariant, "id">): string | undefined {
  return /^[A-Za-z0-9_-]{1,60}$/.test(variant.id) ? `v-${variant.id}` : undefined;
}

/**
 * Null when every combination a customer can pick costs exactly what the source charges for that
 * variant (base + the chosen deltas, as the cart adds them), otherwise the first reason. A
 * combination is matched to source variants by, in order: a whole-variant option id
 * (`variantOptionId`), a whole-variant title ("L / Leather"), or option values (every chosen
 * option name among the variant's values). Every matched variant must cost that price.
 */
export function variantPriceProblem(groups: readonly VariantGroup[], basePriceCents: number, source: ExtractedProduct): string | null {
  if (groups.length === 0) return null;
  const count = groups.reduce((n, g) => n * g.options.length, 1);
  if (count > MAX_CHECKED_COMBINATIONS) return `${count} option combinations are too many to check against the source.`;
  const variants = source.variants.map((v) => {
    const values = v.options.filter(Boolean);
    return {
      id: variantOptionId(v),
      price: v.priceCents,
      values: new Set(values.map(norm)),
      titles: new Set([norm(v.title), norm(values.join(" / "))]),
    };
  });
  let combos: Array<{ names: string[]; ids: string[]; delta: number }> = [{ names: [], ids: [], delta: 0 }];
  for (const group of groups) {
    combos = combos.flatMap((c) =>
      group.options.map((o) => ({ names: [...c.names, o.name], ids: [...c.ids, o.id], delta: c.delta + o.priceDeltaCents })),
    );
  }
  for (const combo of combos) {
    const keys = combo.names.map(norm);
    const price = basePriceCents + combo.delta;
    const label = combo.names.join(" / ");
    let matches: typeof variants = [];
    if (keys.length === 1) {
      const [key = "", id = ""] = [keys[0], combo.ids[0]];
      matches = variants.filter((v) => v.id === id);
      if (matches.length === 0) matches = variants.filter((v) => v.titles.has(key));
    }
    if (matches.length === 0) matches = variants.filter((v) => keys.every((k) => v.values.has(k)));
    if (matches.length === 0) return `"${label}" is not a variant the source sells.`;
    const wrong = matches.find((v) => v.price !== price);
    if (wrong) return `"${label}" would cost ${dollars(price)}; the source charges ${dollars(wrong.price)}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------------------------

const DIETARY_EVIDENCE: Record<DietaryTag, RegExp> = {
  vegan: /\bvegan\b/,
  vegetarian: /\bvegetarian\b/,
  gluten_free: /\bgluten[\s_-]?free\b/,
  dairy_free: /\bdairy[\s_-]?free\b/,
  nut_free: /\bnut[\s_-]?free\b/,
  halal: /\bhalal\b/,
  kosher: /\bkosher\b/,
};

function sourceText(source: ExtractedProduct): string {
  return norm([source.title, source.description, source.productType, ...source.tags].join(" "));
}

/** Dietary tags the source never states for this product (tags, type, title or description). */
export function unsourcedDietary(tags: readonly DietaryTag[] | undefined, source: ExtractedProduct | undefined): DietaryTag[] {
  if (!tags?.length) return [];
  const text = source ? sourceText(source) : "";
  return tags.filter((t) => !DIETARY_EVIDENCE[t].test(text));
}

/** Allergens the source text never mentions for this product. */
export function unsourcedAllergens(allergens: readonly string[] | undefined, source: ExtractedProduct | undefined): string[] {
  if (!allergens?.length) return [];
  const text = source ? sourceText(source) : "";
  return allergens.filter((a) => !text.includes(norm(a)));
}

/** True when a calorie count is stated in the source text for this product. */
export function caloriesSourced(calories: number | undefined, source: ExtractedProduct | undefined): boolean {
  if (calories === undefined) return true;
  return source ? new RegExp(`(^|[^\\d])${calories}([^\\d]|$)`).test(sourceText(source)) : false;
}

export function descriptionDiffers(product: Pick<CheckedProduct, "description">, source: ExtractedProduct | undefined): boolean {
  return norm(product.description) !== norm(source?.description ?? "");
}

export interface ProductSourceCheck {
  source?: ExtractedProduct;
  /** What a customer would pay that the source does not charge for this product. */
  price: string[];
  /** Customer-facing claims (description, dietary, allergens, calories) the source does not make. */
  claims: string[];
}

export function checkProductAgainstSource(product: CheckedProduct, extraction: Pick<Extraction, "products">): ProductSourceCheck {
  const source = matchSourceProduct(product, extraction);
  if (!source) {
    return { price: ["Not matched to a product in the source catalog."], claims: [] };
  }
  const price: string[] = [];
  const prices = productSourcePrices(source);
  if (!prices.has(product.priceCents)) {
    price.push(`${dollars(product.priceCents)} is not a source price for this product (${[...prices].sort((a, b) => a - b).map(dollars).join(", ")}).`);
  }
  if (product.compareAtPriceCents !== undefined && !sourceCompareAt(source, product.priceCents).has(product.compareAtPriceCents)) {
    price.push(`"Was" price ${dollars(product.compareAtPriceCents)} is not a compare-at price the source lists.`);
  }
  const variants = variantPriceProblem(product.variantGroups, product.priceCents, source);
  if (variants) price.push(`Options: ${variants}`);

  const claims: string[] = [];
  if (descriptionDiffers(product, source)) claims.push("Description differs from the source.");
  const a = product.attributes;
  const dietary = unsourcedDietary(a.dietary, source);
  if (dietary.length) claims.push(`Dietary claims the source does not make: ${dietary.join(", ").replace(/_/g, " ")}.`);
  const allergens = unsourcedAllergens(a.allergens, source);
  if (allergens.length) claims.push(`Allergens the source does not mention: ${allergens.join(", ")}.`);
  if (!caloriesSourced(a.calories, source)) claims.push(`${a.calories} kcal is not stated in the source.`);
  return { source, price, claims };
}
