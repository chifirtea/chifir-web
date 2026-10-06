import "server-only";
import { OnboardingError, checkUrlPolicy, safeFetch, type FetchDeps, type UrlPolicyOptions } from "./ssrf";
import type { ExtractedCategory, ExtractedProduct, ExtractedVariant, Extraction } from "./types";

/**
 * Raw extraction of a store: Shopify's public `/products.json` (+ `/collections.json`) first, then
 * the homepage for name, description, logo and colour candidates. Everything coming back is
 * untrusted web content: it is reduced to plain text, capped, and never interpreted.
 *
 * Shopify-shaped stores are the target. Other sites yield a "generic" extraction (identity only,
 * no products) that a reviewer completes by hand.
 */

export const LIMITS = {
  name: 80,
  description: 600,
  products: 50,
  productTitle: 120,
  productDescription: 600,
  productType: 60,
  variants: 30,
  images: 8,
  tags: 20,
  tag: 32,
  options: 3,
  optionValues: 30,
  optionValue: 60,
  logoCandidates: 6,
  colorCandidates: 8,
  categories: 30,
  url: 2048,
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------
// Text sanitising
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text, single-spaced, control characters removed, capped at `max` characters. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  const text = decodeEntities(input)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** HTML fragment → plain text (scripts/styles removed, block boundaries become spaces). */
export function htmlToText(html: unknown, max: number): string {
  if (typeof html !== "string") return "";
  const stripped = html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|tr|td|th|section|article)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return cleanText(stripped, max);
}

export function slugify(input: string, max = 48): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug;
}

/** "29.00" | "1,299.50" | 29 → integer cents; anything else → null (never guessed). */
export function parsePriceToCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  if (typeof value !== "string") return null;
  const m = value.trim().replace(/,/g, "").match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m?.[1]) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Absolute http(s) URL or null. Shopify uses protocol-relative `//cdn.shopify.com/...`. */
export function normalizeUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > LIMITS.url) return null;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** #rgb / #rgba / #rrggbb / #rrggbbaa → #rrggbb (lowercase) or null. */
export function normalizeHex(value: string): string | null {
  const m = value.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m?.[1]) return null;
  const h = m[1].toLowerCase();
  if (h.length === 3 || h.length === 4) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length === 6 || h.length === 8) return `#${h.slice(0, 6)}`;
  return null;
}

const unique = <T>(list: T[]): T[] => [...new Set(list)];

function tagList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return unique(
    raw
      .filter((t): t is string => typeof t === "string")
      .map((t) => cleanText(t, LIMITS.tag).toLowerCase())
      .filter(Boolean),
  ).slice(0, LIMITS.tags);
}

// ---------------------------------------------------------------------------------------------
// Shopify parsers (pure, unit-tested on fixtures)
// ---------------------------------------------------------------------------------------------

export interface ParsedCatalog {
  products: ExtractedProduct[];
  warnings: string[];
}

const DEFAULT_OPTION = /^(title|default title)$/i;

function parseVariant(v: Record<string, unknown>, options: number): ExtractedVariant | null {
  const priceCents = parsePriceToCents(v.price);
  if (priceCents === null) return null;
  const compare = parsePriceToCents(v.compare_at_price);
  const values = [v.option1, v.option2, v.option3]
    .slice(0, options)
    .map((o) => cleanText(o, LIMITS.optionValue));
  return {
    id: String(v.id ?? ""),
    title: cleanText(v.title, LIMITS.optionValue) || "Default",
    priceCents,
    ...(compare !== null && compare > priceCents ? { compareAtPriceCents: compare } : {}),
    available: v.available !== false,
    options: values,
  };
}

/** `GET {origin}/products.json` body → products. Prices are copied exactly; unparseable ones drop the variant. */
export function parseShopifyProducts(json: unknown, origin: string): ParsedCatalog {
  const warnings: string[] = [];
  const list = isRecord(json) && Array.isArray(json.products) ? json.products : [];
  if (list.length > LIMITS.products) warnings.push(`Only the first ${LIMITS.products} of ${list.length} products were read.`);
  const products: ExtractedProduct[] = [];
  for (const raw of list.slice(0, LIMITS.products)) {
    if (!isRecord(raw)) continue;
    const title = cleanText(raw.title, LIMITS.productTitle);
    if (!title) continue;
    const handle = slugify(typeof raw.handle === "string" ? raw.handle : title) || slugify(title) || `product-${products.length + 1}`;
    const options = (Array.isArray(raw.options) ? raw.options : [])
      .filter(isRecord)
      .map((o) => ({
        name: cleanText(o.name, LIMITS.optionValue),
        values: unique(
          (Array.isArray(o.values) ? o.values : []).map((v) => cleanText(v, LIMITS.optionValue)).filter(Boolean),
        ).slice(0, LIMITS.optionValues),
      }))
      .filter((o) => o.name && !(DEFAULT_OPTION.test(o.name) && o.values.length <= 1))
      .slice(0, LIMITS.options);
    const rawVariants = Array.isArray(raw.variants) ? raw.variants.filter(isRecord) : [];
    const variants: ExtractedVariant[] = [];
    for (const v of rawVariants.slice(0, LIMITS.variants)) {
      const parsed = parseVariant(v, options.length);
      if (parsed) variants.push(parsed);
      else warnings.push(`"${title}": variant "${cleanText(v.title, 40) || v.id}" has no usable price; skipped.`);
    }
    if (variants.length === 0) {
      warnings.push(`"${title}" has no priced variants; skipped.`);
      continue;
    }
    const images = unique(
      (Array.isArray(raw.images) ? raw.images : [])
        .map((img) => normalizeUrl(isRecord(img) ? img.src : img, origin))
        .filter((u): u is string => Boolean(u)),
    ).slice(0, LIMITS.images);
    const vendor = cleanText(raw.vendor, 60);
    products.push({
      id: String(raw.id ?? handle),
      handle,
      title,
      description: htmlToText(raw.body_html, LIMITS.productDescription),
      productType: cleanText(raw.product_type, LIMITS.productType),
      ...(vendor ? { vendor } : {}),
      tags: tagList(raw.tags),
      images,
      options,
      variants,
      priceCents: Math.min(...variants.map((v) => v.priceCents)),
      url: `${origin}/products/${handle}`,
    });
  }
  return { products, warnings };
}

/** `GET {origin}/collections.json` body → categories (optional signal for the category picker). */
export function parseShopifyCollections(json: unknown): ExtractedCategory[] {
  const list = isRecord(json) && Array.isArray(json.collections) ? json.collections : [];
  const out: ExtractedCategory[] = [];
  for (const raw of list.slice(0, LIMITS.categories)) {
    if (!isRecord(raw)) continue;
    const title = cleanText(raw.title, 80);
    const handle = slugify(typeof raw.handle === "string" ? raw.handle : title);
    if (!title || !handle) continue;
    out.push({
      handle,
      title,
      ...(typeof raw.products_count === "number" ? { productsCount: raw.products_count } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Homepage metadata (hand-written; regex over tags is enough for <title>/<meta>/<link>)
// ---------------------------------------------------------------------------------------------

export interface HomepageMeta {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogImage?: string;
  siteName?: string;
  themeColor?: string;
  logoCandidates: string[];
  colorCandidates: string[];
}

/** Attribute map of one tag (`<meta name="x" content='y'>`), keys lowercased, values decoded. */
export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = tag.replace(/^<\s*[a-zA-Z][\w:-]*/, "").replace(/\/?>\s*$/, "");
  for (const m of body.matchAll(re)) {
    const key = m[1]?.toLowerCase();
    if (!key) continue;
    attrs[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const COLOR_VAR = /--(?:color-[\w-]*|primary[\w-]*|secondary[\w-]*|accent[\w-]*|brand[\w-]*|background[\w-]*|text[\w-]*|button[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;

export function parseHomepage(html: string, baseUrl: string): HomepageMeta {
  const meta: HomepageMeta = { logoCandidates: [], colorCandidates: [] };
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const t = htmlToText(titleMatch[1], LIMITS.name);
    if (t) meta.title = t;
  }

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const metas: Record<string, string> = {};
  for (const tag of metaTags) {
    const a = parseAttrs(tag);
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (!key || a.content === undefined || metas[key] !== undefined) continue;
    metas[key] = a.content;
  }
  const description = cleanText(metas["description"] ?? metas["og:description"], LIMITS.description);
  if (description) meta.description = description;
  const ogTitle = cleanText(metas["og:title"], LIMITS.name);
  if (ogTitle) meta.ogTitle = ogTitle;
  const siteName = cleanText(metas["og:site_name"], LIMITS.name);
  if (siteName) meta.siteName = siteName;
  const ogImage = normalizeUrl(metas["og:image"] ?? metas["og:image:url"] ?? metas["twitter:image"], baseUrl);
  if (ogImage) meta.ogImage = ogImage;
  const themeColor = metas["theme-color"] ? normalizeHex(metas["theme-color"]) : null;
  if (themeColor) meta.themeColor = themeColor;

  // Logo candidates: apple-touch-icon first (largest, usually the mark), then icons, then <img> tagged "logo".
  const touch: string[] = [];
  const icons: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const a = parseAttrs(tag);
    const rel = (a.rel ?? "").toLowerCase();
    const href = normalizeUrl(a.href, baseUrl);
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) touch.push(href);
    else if (rel.split(/\s+/).includes("icon")) icons.push(href);
  }
  const imgLogos: string[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const a = parseAttrs(tag);
    const hint = `${a.class ?? ""} ${a.id ?? ""} ${a.alt ?? ""} ${a.src ?? ""}`.toLowerCase();
    if (!hint.includes("logo")) continue;
    const src = normalizeUrl(a.src ?? a["data-src"], baseUrl);
    if (src) imgLogos.push(src);
    if (imgLogos.length >= 3) break;
  }
  meta.logoCandidates = unique([...touch, ...imgLogos, ...icons, ...(ogImage ? [ogImage] : [])]).slice(0, LIMITS.logoCandidates);

  // Colour candidates: theme-color, then CSS custom properties by frequency.
  const counts = new Map<string, number>();
  for (const block of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []) {
    for (const m of block.matchAll(COLOR_VAR)) {
      const hex = m[1] ? normalizeHex(m[1]) : null;
      if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  for (const m of html.matchAll(/style\s*=\s*"([^"]*--[^"]*)"/gi)) {
    for (const v of (m[1] ?? "").matchAll(COLOR_VAR)) {
      const hex = v[1] ? normalizeHex(v[1]) : null;
      if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  meta.colorCandidates = unique([...(themeColor ? [themeColor] : []), ...ranked]).slice(0, LIMITS.colorCandidates);
  return meta;
}

/** "Northline Supply – Streetwear & Hoodies" → "Northline Supply". */
export function storeNameFromTitle(title: string): string {
  const first = title.split(/\s+[|–—·•-]\s+/)[0]?.trim() ?? title;
  return cleanText(first, LIMITS.name) || cleanText(title, LIMITS.name);
}

function titleCase(s: string): string {
  return s.replace(/(^|[-_\s])([a-z])/g, (_, sep: string, ch: string) => `${sep === "" ? "" : " "}${ch.toUpperCase()}`);
}

export function nameFromHost(hostname: string): string {
  const label = hostname.replace(/^www\./, "").split(".")[0] ?? "store";
  return titleCase(label) || "Store";
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

export interface ExtractOptions extends UrlPolicyOptions {
  deps?: FetchDeps;
  now?: () => Date;
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const isPolicyError = (err: unknown): err is OnboardingError =>
  err instanceof OnboardingError && (err.code === "blocked_host" || err.code === "invalid_url");

const describe = (err: unknown): string => (err instanceof Error ? err.message : "Unknown error");

/**
 * Extracts a store. Throws `OnboardingError` when the URL fails the policy or when nothing at
 * all could be fetched; partial failures (no catalog, no homepage) become warnings.
 */
export async function extractMerchant(url: string, opts: ExtractOptions = {}): Promise<Extraction> {
  const policy: UrlPolicyOptions = { allowLocal: opts.allowLocal === true };
  const base = checkUrlPolicy(url, policy);
  const origin = base.origin;
  const warnings: string[] = [];
  let platform: Extraction["platform"] = "generic";
  let products: ExtractedProduct[] = [];
  let categories: ExtractedCategory[] = [];

  try {
    const res = await safeFetch(`${origin}/products.json?limit=${LIMITS.products}`, { accept: "json", ...policy }, opts.deps);
    const json = res.ok ? tryJson(res.text) : null;
    if (isRecord(json) && Array.isArray(json.products)) {
      platform = "shopify";
      const parsed = parseShopifyProducts(json, origin);
      products = parsed.products;
      warnings.push(...parsed.warnings);
      if (products.length === 0) warnings.push("The Shopify catalog is empty or unpublished.");
    } else {
      warnings.push(
        res.ok ? "/products.json is not a Shopify catalog; products must be added by hand." : `No Shopify catalog (/products.json returned ${res.status}).`,
      );
    }
  } catch (err) {
    if (isPolicyError(err)) throw err;
    warnings.push(`Catalog fetch failed: ${describe(err)}`);
  }

  if (platform === "shopify") {
    try {
      const res = await safeFetch(`${origin}/collections.json`, { accept: "json", ...policy }, opts.deps);
      if (res.ok) categories = parseShopifyCollections(tryJson(res.text));
    } catch (err) {
      if (isPolicyError(err)) throw err;
      warnings.push(`Collections fetch failed: ${describe(err)}`);
    }
  }

  let home: HomepageMeta = { logoCandidates: [], colorCandidates: [] };
  let homeFetched = false;
  try {
    const res = await safeFetch(base.toString(), { accept: "html", ...policy }, opts.deps);
    if (res.ok) {
      home = parseHomepage(res.text, res.url);
      homeFetched = true;
    } else {
      warnings.push(`The homepage returned ${res.status}.`);
    }
  } catch (err) {
    if (isPolicyError(err)) throw err;
    warnings.push(`Homepage fetch failed: ${describe(err)}`);
  }

  if (!homeFetched && products.length === 0) {
    throw new OnboardingError("fetch_failed", `Nothing could be read from ${base.hostname}: ${warnings.join(" ")}`);
  }

  const name = home.siteName ?? (home.ogTitle ? storeNameFromTitle(home.ogTitle) : undefined) ?? (home.title ? storeNameFromTitle(home.title) : undefined) ?? nameFromHost(base.hostname);
  const colorCandidates = unique([...home.colorCandidates]).slice(0, LIMITS.colorCandidates);

  return {
    sourceUrl: base.toString(),
    origin,
    platform,
    name,
    ...(home.description ? { description: home.description } : {}),
    ...(home.siteName ? { siteName: home.siteName } : {}),
    ...(home.ogImage ? { ogImage: home.ogImage } : {}),
    ...(home.themeColor ? { themeColor: home.themeColor } : {}),
    logoCandidates: home.logoCandidates,
    colorCandidates,
    products,
    categories,
    fetchedAt: (opts.now ?? (() => new Date()))().toISOString(),
    warnings,
    meta: {},
  };
}
