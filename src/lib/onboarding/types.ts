/**
 * What the extractor found on a store, verbatim and sanitised to plain text. Stored on the draft
 * (`MerchantDraft.extraction`) so the reviewer can compare "what we found" with the proposal.
 *
 * Client-safe (types + a defensive reader); the fetching lives in `extract.ts`.
 */

export interface ExtractedVariant {
  id: string;
  title: string;
  priceCents: number;
  compareAtPriceCents?: number;
  available: boolean;
  /** Option values in option order (e.g. ["M", "Black"]). */
  options: string[];
}

export interface ExtractedOption {
  name: string;
  values: string[];
}

export interface ExtractedProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  productType: string;
  vendor?: string;
  tags: string[];
  images: string[];
  options: ExtractedOption[];
  variants: ExtractedVariant[];
  /** Lowest variant price: the product's base price. */
  priceCents: number;
  url: string;
}

export interface ExtractedCategory {
  handle: string;
  title: string;
  productsCount?: number;
}

export type ProposalSource = "ai" | "heuristic";

export interface ExtractionMeta {
  proposalSource?: ProposalSource;
  model?: string;
  /** Warnings from structuring (dropped prices, fallbacks). */
  structuringWarnings?: string[];
}

/** A type alias (not an interface) so it is assignable to the draft's `Record<string, unknown>`. */
export type Extraction = {
  sourceUrl: string;
  origin: string;
  platform: "shopify" | "generic";
  name?: string;
  description?: string;
  siteName?: string;
  ogImage?: string;
  themeColor?: string;
  logoCandidates: string[];
  colorCandidates: string[];
  products: ExtractedProduct[];
  categories: ExtractedCategory[];
  fetchedAt: string;
  warnings: string[];
  meta: ExtractionMeta;
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a stored extraction defensively (the column is untyped JSON). Never throws. */
export function asExtraction(value: unknown): Extraction {
  const r = isRecord(value) ? value : {};
  const meta = isRecord(r.meta) ? r.meta : {};
  const source = meta.proposalSource === "ai" || meta.proposalSource === "heuristic" ? meta.proposalSource : undefined;
  return {
    sourceUrl: str(r.sourceUrl) ?? "",
    origin: str(r.origin) ?? "",
    platform: r.platform === "shopify" ? "shopify" : "generic",
    ...(str(r.name) ? { name: str(r.name) } : {}),
    ...(str(r.description) ? { description: str(r.description) } : {}),
    ...(str(r.siteName) ? { siteName: str(r.siteName) } : {}),
    ...(str(r.ogImage) ? { ogImage: str(r.ogImage) } : {}),
    ...(str(r.themeColor) ? { themeColor: str(r.themeColor) } : {}),
    logoCandidates: strings(r.logoCandidates),
    colorCandidates: strings(r.colorCandidates),
    products: Array.isArray(r.products) ? r.products.filter(isRecord).map(asProduct) : [],
    categories: Array.isArray(r.categories)
      ? r.categories.filter(isRecord).map((c) => ({
          handle: str(c.handle) ?? "",
          title: str(c.title) ?? "",
          ...(typeof c.productsCount === "number" ? { productsCount: c.productsCount } : {}),
        }))
      : [],
    fetchedAt: str(r.fetchedAt) ?? "",
    warnings: strings(r.warnings),
    meta: {
      ...(source ? { proposalSource: source } : {}),
      ...(str(meta.model) ? { model: str(meta.model) } : {}),
      ...(Array.isArray(meta.structuringWarnings) ? { structuringWarnings: strings(meta.structuringWarnings) } : {}),
    },
  };
}

function asProduct(p: Record<string, unknown>): ExtractedProduct {
  return {
    id: str(p.id) ?? "",
    handle: str(p.handle) ?? "",
    title: str(p.title) ?? "",
    description: str(p.description) ?? "",
    productType: str(p.productType) ?? "",
    ...(str(p.vendor) ? { vendor: str(p.vendor) } : {}),
    tags: strings(p.tags),
    images: strings(p.images),
    options: Array.isArray(p.options)
      ? p.options.filter(isRecord).map((o) => ({ name: str(o.name) ?? "", values: strings(o.values) }))
      : [],
    variants: Array.isArray(p.variants)
      ? p.variants.filter(isRecord).map((v) => ({
          id: str(v.id) ?? "",
          title: str(v.title) ?? "",
          priceCents: typeof v.priceCents === "number" ? v.priceCents : 0,
          ...(typeof v.compareAtPriceCents === "number" ? { compareAtPriceCents: v.compareAtPriceCents } : {}),
          available: v.available === true,
          options: strings(v.options),
        }))
      : [],
    priceCents: typeof p.priceCents === "number" ? p.priceCents : 0,
    url: str(p.url) ?? "",
  };
}

/** Every price the source catalog actually listed; a proposal may only use these. */
export function sourcePrices(extraction: Extraction): Set<number> {
  const prices = new Set<number>();
  for (const p of extraction.products) {
    prices.add(p.priceCents);
    for (const v of p.variants) prices.add(v.priceCents);
  }
  return prices;
}
