import "server-only";
import { z } from "zod";
import type { CatalogSource } from "@/lib/data/types";
import { isOpenNow } from "@/lib/data/search";
import {
  bestOfferFor,
  computeTotals,
  defaultFulfillmentFor,
  lineKey,
  unitDiscountCents,
  unitPriceCents,
  variantProblem,
} from "@/features/cart/pricing";
import type {
  CartLine,
  CityEvent,
  District,
  Merchant,
  Offer,
  Parcel,
  Product,
  ProductCard,
  ProductFact,
  MerchantCard,
  Weekday,
} from "@/types/domain";
import type { ChatScope, ChatStreamEvent } from "./actions";
import { defineTool, type ToolDef } from "./provider";

/**
 * The only source of facts for the AI. Every tool reads the same `DataSource` the UI uses and
 * returns compact JSON the model can quote; merchant/product cards are pushed to the stream as a
 * side effect so the UI can render them before the text arrives.
 */

export interface ToolContext {
  ds: CatalogSource;
  emit: (event: ChatStreamEvent) => void;
  now: Date;
  scope: ChatScope;
  /** Employee scope: every catalog tool is pinned to this merchant. */
  merchantId?: string;
}

export type AiTool = ToolDef<ToolContext>;

export const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_MERCHANTS = 8;
const MAX_PRODUCTS = 12;
const MAX_EVENTS = 10;

// ------------------------------------------------------------------------------------ schemas

const shortString = (max: number) => z.string().trim().min(1).max(max);
const merchantTypeSchema = z.enum(["restaurant", "retail", "service", "venue", "popup"]);
const dietarySchema = z.enum(["vegan", "vegetarian", "gluten_free", "dairy_free", "nut_free", "halal", "kosher"]);
const fulfillmentTypeSchema = z.enum(["delivery", "pickup", "shipping", "booking", "ticket", "digital", "lead"]);
const eventStatusSchema = z.enum(["scheduled", "live", "ended", "cancelled"]);

const searchMerchantsSchema = z.object({
  query: shortString(120).optional().describe("Free text: cuisine, vibe, product type, name."),
  merchantType: merchantTypeSchema.optional(),
  category: shortString(60).optional().describe('Category prefix such as "food", "food.ramen", "fashion", "gifts".'),
  openNow: z.boolean().optional().describe("Only places open right now."),
  maxPriceLevel: z.number().int().min(1).max(4).optional().describe("1 budget … 4 premium."),
  tags: z.array(shortString(40)).max(6).optional().describe('Any-of tags, e.g. ["spicy","late-night","date-night"].'),
  limit: z.number().int().min(1).max(MAX_MERCHANTS).optional(),
});

const searchProductsSchema = z.object({
  query: shortString(120).optional().describe("Free text matched against title, description, tags and merchant."),
  maxPriceCents: z.number().int().min(0).max(10_000_000).optional().describe("Base price ceiling in cents (2500 = $25)."),
  minPriceCents: z.number().int().min(0).max(10_000_000).optional(),
  merchantIds: z.array(shortString(64)).max(20).optional(),
  merchantType: merchantTypeSchema.optional(),
  category: shortString(60).optional(),
  dietary: z.array(dietarySchema).max(7).optional().describe("Every listed tag must be present on the product."),
  minSpiceLevel: z.number().int().min(0).max(4).optional().describe("0 none … 4 extreme. Use 2 for 'spicy'."),
  occasion: shortString(40).optional().describe('e.g. "date-night", "gift", "birthday".'),
  fulfillmentType: fulfillmentTypeSchema.optional(),
  tags: z.array(shortString(40)).max(6).optional(),
  limit: z.number().int().min(1).max(MAX_PRODUCTS).optional(),
});

const getMerchantSchema = z.object({ merchantId: shortString(64) });

const getEventsSchema = z.object({
  from: shortString(40).optional().describe("ISO date-time; defaults to now (live and upcoming)."),
  to: shortString(40).optional().describe("ISO date-time upper bound on start time."),
  status: z.array(eventStatusSchema).max(4).optional(),
});

const navTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("merchant"), merchantId: shortString(64) }),
  z.object({ kind: z.literal("district"), districtId: shortString(64) }),
  z.object({ kind: z.literal("event"), eventId: shortString(64) }),
]);

const navigateSchema = z.object({
  target: navTargetSchema,
  mode: z.enum(["teleport", "guide"]).describe("teleport = jump there (user confirms); guide = show a waypoint."),
  label: shortString(80).describe("Button label, e.g. the place name."),
});

const variantPairSchema = z.object({
  groupId: shortString(40).describe('Variant group id from the product, e.g. "size".'),
  optionId: shortString(40).describe('Option id within that group, e.g. "m".'),
});

const proposeCartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: shortString(64),
        quantity: z.number().int().min(1).max(10),
        variantSelection: z.array(variantPairSchema).max(6).optional().describe("Required for products with required variant groups."),
      }),
    )
    .min(1)
    .max(8),
  note: shortString(160).optional().describe("One line shown to the user with the proposal."),
});

const escalateSchema = z.object({
  merchantId: shortString(64),
  reason: shortString(200).describe("Why a person should follow up (allergy detail, complaint, custom request…)."),
});

const recommendItemsSchema = z.object({
  productIds: z.array(shortString(64)).min(1).max(8).describe("Ids from this merchant's catalog."),
});

// ------------------------------------------------------------------------------------ helpers

interface Geo {
  districtById: Map<string, District>;
  districtByMerchant: Map<string, District>;
  merchantById: Map<string, Merchant>;
  offers: Offer[];
}

const geoCache = new WeakMap<ToolContext, Promise<Geo>>();

/** Districts, parcels, merchants and live offers are loaded once per request and shared by all tool calls. */
function geoFor(ctx: ToolContext): Promise<Geo> {
  let cached = geoCache.get(ctx);
  if (!cached) {
    cached = (async () => {
      const [districts, parcels, merchants, offers] = await Promise.all([
        ctx.ds.listDistricts(),
        ctx.ds.listParcels(),
        ctx.ds.listMerchants(),
        ctx.ds.listOffers(),
      ]);
      const districtById = new Map(districts.map((d) => [d.id, d]));
      const districtByMerchant = new Map<string, District>();
      for (const parcel of parcels as Parcel[]) {
        if (!parcel.merchantId || parcel.tier === "billboard" || districtByMerchant.has(parcel.merchantId)) continue;
        const district = districtById.get(parcel.districtId);
        if (district) districtByMerchant.set(parcel.merchantId, district);
      }
      return { districtById, districtByMerchant, merchantById: new Map(merchants.map((m) => [m.id, m])), offers };
    })();
    geoCache.set(ctx, cached);
  }
  return cached;
}

export function trimText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function range(min: number | undefined, max: number | undefined, unit: string): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  const lo = min ?? max;
  const hi = max ?? min;
  return lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`;
}

/** "25–40 min delivery" style label from the merchant's fulfillment (and the product's lead time). */
export function etaLabelFor(merchant: Merchant | undefined, product?: Product): string | undefined {
  const f = merchant?.fulfillment;
  const types = product?.fulfillmentTypes ?? ["delivery", "pickup", "shipping", "booking"];
  if (types.includes("delivery") && f?.delivery?.enabled) {
    return `${range(f.delivery.minutesMin, f.delivery.minutesMax, "min")} delivery`;
  }
  if (types.includes("pickup") && f?.pickup?.enabled) {
    return `${range(f.pickup.minutesMin, f.pickup.minutesMax, "min")} pickup`;
  }
  if (types.includes("shipping") && f?.shipping?.enabled) {
    const days = range(product?.leadTime.daysMin ?? f.shipping.daysMin, product?.leadTime.daysMax ?? f.shipping.daysMax, "day");
    return `${days} shipping`;
  }
  if (types.includes("booking") && f?.booking?.enabled) return "Book a time";
  if (types.includes("ticket")) return "Ticket";
  if (types.includes("digital")) return "Instant";
  return undefined;
}

export function toMerchantCard(m: Merchant, now: Date): MerchantCard {
  const openNow = isOpenNow(m.openingHours, now);
  const etaLabel = etaLabelFor(m);
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    ...(m.tagline ? { tagline: m.tagline } : {}),
    category: m.category,
    merchantType: m.merchantType,
    ...(m.priceLevel !== undefined ? { priceLevel: m.priceLevel } : {}),
    ...(m.rating !== undefined ? { rating: m.rating } : {}),
    ...(m.logoUrl ? { logoUrl: m.logoUrl } : {}),
    brand: m.brand,
    ...(openNow !== undefined ? { openNow } : {}),
    ...(etaLabel ? { etaLabel } : {}),
  };
}

export interface LiveOfferSummary {
  offerId: string;
  title: string;
  /** Present when the user must enter a code at checkout. */
  code?: string;
  discountCents: number;
  unitPriceAfterCents: number;
}

/** Tool-result shape: the UI's ProductFact plus allergens (for strict dietary answers) and the best live offer. */
export type ProductFactWithOffer = ProductFact & { allergens?: string[]; liveOffer?: LiveOfferSummary };

/** Best applicable live offer, including code-gated ones (reported with their code). */
export function liveOfferFor(product: Product, offers: Offer[], now: Date): LiveOfferSummary | undefined {
  const unit = unitPriceCents(product);
  const auto = bestOfferFor(product, unit, offers, now);
  let best: Offer | null = auto;
  let bestDiscount = auto ? unitDiscountCents(auto, unit) : 0;
  for (const offer of offers) {
    if (!offer.code) continue;
    const match = bestOfferFor(product, unit, [offer], now, offer.code);
    if (!match) continue;
    const d = unitDiscountCents(match, unit);
    if (d > bestDiscount) {
      best = match;
      bestDiscount = d;
    }
  }
  if (!best || bestDiscount <= 0) return undefined;
  return {
    offerId: best.id,
    title: best.title,
    ...(best.code ? { code: best.code } : {}),
    discountCents: bestDiscount,
    unitPriceAfterCents: unit - bestDiscount,
  };
}

export function toProductFact(p: Product, merchant: Merchant | undefined, offers: Offer[], now: Date): ProductFactWithOffer {
  const etaLabel = etaLabelFor(merchant, p);
  const liveOffer = liveOfferFor(p, offers, now);
  return {
    id: p.id,
    merchantId: p.merchantId,
    merchantName: merchant?.name ?? "Unknown",
    title: p.title,
    priceCents: p.priceCents,
    currency: p.currency,
    ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    inventoryStatus: p.inventoryStatus,
    ...(p.attributes.spiceLevel !== undefined ? { spiceLevel: p.attributes.spiceLevel } : {}),
    ...(p.attributes.dietary?.length ? { dietary: p.attributes.dietary } : {}),
    ...(p.attributes.allergens?.length ? { allergens: p.attributes.allergens } : {}),
    ...(etaLabel ? { etaLabel } : {}),
    description: trimText(p.description, 200),
    category: p.category,
    variantGroups: p.variantGroups,
    fulfillmentTypes: p.fulfillmentTypes,
    leadTime: p.leadTime,
    tags: p.tags,
    ...(p.attributes.occasion?.length ? { occasion: p.attributes.occasion } : {}),
    ...(p.attributes.serves !== undefined ? { serves: p.attributes.serves } : {}),
    ...(liveOffer ? { liveOffer } : {}),
  };
}

export function toProductCard(fact: ProductFact): ProductCard {
  return {
    id: fact.id,
    merchantId: fact.merchantId,
    merchantName: fact.merchantName,
    title: fact.title,
    priceCents: fact.priceCents,
    currency: fact.currency,
    ...(fact.imageUrl ? { imageUrl: fact.imageUrl } : {}),
    inventoryStatus: fact.inventoryStatus,
    ...(fact.spiceLevel !== undefined ? { spiceLevel: fact.spiceLevel } : {}),
    ...(fact.dietary?.length ? { dietary: fact.dietary } : {}),
    ...(fact.etaLabel ? { etaLabel: fact.etaLabel } : {}),
  };
}

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function hoursToday(m: Merchant, now: Date): { day: Weekday; intervals: Array<{ open: string; close: string }> } | undefined {
  const hours = m.openingHours;
  if (!hours) return undefined;
  let local: Date;
  try {
    local = new Date(now.toLocaleString("en-US", { timeZone: hours.timezone }));
  } catch {
    local = now;
  }
  const day = WEEKDAYS[local.getDay()]!;
  return { day, intervals: hours.weekly[day] ?? [] };
}

/**
 * Serializes a tool result and shrinks it below the character cap without ever producing invalid
 * JSON: image urls go first, then descriptions are shortened, then the largest shallow list is
 * trimmed from the end (marking its parent `truncated: true`). Returns the compacted value too so
 * callers emit cards for exactly what the model can see.
 */
export function compactValue<T>(value: T, maxChars = MAX_TOOL_RESULT_CHARS): { json: string; value: T } {
  let current: unknown = value;
  let json = JSON.stringify(current);
  const stages: Array<(v: unknown) => unknown> = [
    (v) => shrinkStrings(v, 200, true),
    (v) => shrinkStrings(v, 100, true),
    (v) => shrinkStrings(v, 60, true),
  ];
  for (const stage of stages) {
    if (json.length <= maxChars) break;
    current = stage(current);
    json = JSON.stringify(current);
  }
  for (let guard = 0; json.length > maxChars && guard < 1000; guard++) {
    const target = largestShallowArray(current);
    if (!target) break;
    current = trimArrayAt(current, target.path);
    json = JSON.stringify(current);
  }
  if (json.length > maxChars) {
    current = { error: "Result too large to show. Narrow the query." };
    json = JSON.stringify(current);
  }
  return { json, value: current as T };
}

export function compactJson(value: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string {
  return compactValue(value, maxChars).json;
}

function shrinkStrings(value: unknown, descLen: number, dropImages: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => shrinkStrings(v, descLen, dropImages));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (dropImages && k === "imageUrl") continue;
      if (k === "description" && typeof v === "string") out[k] = trimText(v, descLen);
      else out[k] = shrinkStrings(v, descLen, dropImages);
    }
    return out;
  }
  return value;
}

type Path = Array<string | number>;

/** The non-empty array closest to the root (ties: the longest). Lists of results live near the top. */
function largestShallowArray(value: unknown, path: Path = [], best: { path: Path; size: number } | null = null): { path: Path; size: number } | null {
  if (Array.isArray(value)) {
    if (value.length > 0 && (!best || path.length < best.path.length || (path.length === best.path.length && value.length > best.size))) {
      best = { path, size: value.length };
    }
    value.forEach((v, i) => {
      best = largestShallowArray(v, [...path, i], best);
    });
    return best;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) best = largestShallowArray(v, [...path, k], best);
  }
  return best;
}

function trimArrayAt(value: unknown, path: Path): unknown {
  if (path.length === 0) return Array.isArray(value) ? value.slice(0, -1) : value;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    return value.map((v, i) => (i === head ? trimArrayAt(v, rest) : v));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return { ...record, [head as string]: trimArrayAt(record[head as string], rest), ...(rest.length === 0 ? { truncated: true } : {}) };
  }
  return value;
}

function errorResult(message: string) {
  return { content: JSON.stringify({ error: message }), isError: true };
}

function scopedMerchantId(ctx: ToolContext): string | undefined {
  return ctx.scope === "employee" ? ctx.merchantId : undefined;
}

/** Cards for exactly the products that survived compaction (the ones the model can quote). */
function emitProductCards(ctx: ToolContext, facts: ProductFactWithOffer[], kept: Array<{ id: string }>): void {
  const ids = new Set(kept.map((p) => p.id));
  const cards = facts.filter((f) => ids.has(f.id)).map(toProductCard);
  if (cards.length) ctx.emit({ type: "cards", products: cards });
}

// -------------------------------------------------------------------------------------- tools

export const searchMerchants: AiTool = defineTool({
  name: "search_merchants",
  description:
    "Find places in the city (restaurants, stores, venues) by text, type, category, tags, price level or open-now. Returns up to 8 merchants with district, open status and delivery/pickup ETA. Results render as cards for the user.",
  schema: searchMerchantsSchema,
  execute: async (input, ctx) => {
    const merchants = await ctx.ds.searchMerchants({ ...input, limit: Math.min(input.limit ?? MAX_MERCHANTS, MAX_MERCHANTS) });
    const geo = await geoFor(ctx);
    const cards = merchants.map((m) => toMerchantCard(m, ctx.now));
    const { json, value } = compactValue({
      count: cards.length,
      merchants: merchants.map((m, i) => ({
        ...cards[i]!,
        district: geo.districtByMerchant.get(m.id)?.name ?? null,
        tags: m.tags,
        description: trimText(m.description, 160),
      })),
      ...(cards.length === 0 ? { note: "No merchants matched. Relax a filter or search products directly." } : {}),
    });
    const shown = new Set(value.merchants.map((m) => m.id));
    if (shown.size) ctx.emit({ type: "cards", merchants: cards.filter((c) => shown.has(c.id)) });
    return json;
  },
});

export const searchProducts: AiTool = defineTool({
  name: "search_products",
  description:
    "Search menu items and products across the city (or within this merchant). Filter by price in cents, dietary tags, spice level, occasion, fulfillment type, tags or merchant ids. Returns up to 12 products with base price, variant groups (price deltas), ETA and any live offer. Results render as cards for the user.",
  schema: searchProductsSchema,
  execute: async (input, ctx) => {
    const pinned = scopedMerchantId(ctx);
    const products = await ctx.ds.searchProducts({
      ...input,
      ...(pinned ? { merchantIds: [pinned] } : input.merchantIds ? { merchantIds: input.merchantIds } : {}),
      limit: Math.min(input.limit ?? MAX_PRODUCTS, MAX_PRODUCTS),
    });
    const geo = await geoFor(ctx);
    const facts = products.map((p) => toProductFact(p, geo.merchantById.get(p.merchantId), geo.offers, ctx.now));
    const { json, value } = compactValue({
      count: facts.length,
      products: facts,
      ...(facts.length === 0 ? { note: "Nothing matched. Try fewer filters, a higher price ceiling or a broader query, then offer the closest real alternative." } : {}),
    });
    emitProductCards(ctx, facts, value.products);
    return json;
  },
});

export const getMerchant: AiTool = defineTool({
  name: "get_merchant",
  description:
    "Full details for one merchant: description, tags, price level, rating, today's hours and open status, fulfillment options with fees and ETAs, district, live offers, upcoming events and its top products.",
  schema: getMerchantSchema,
  execute: async (input, ctx) => {
    const pinned = scopedMerchantId(ctx);
    if (pinned && input.merchantId !== pinned) {
      return errorResult("Only this merchant is available here. Point the user to the city concierge for other places.");
    }
    const m = await ctx.ds.getMerchant(input.merchantId);
    if (!m) return errorResult(`Unknown merchant id "${input.merchantId}". Use search_merchants to find real ids.`);
    const [products, offers, events, geo] = await Promise.all([
      ctx.ds.listProducts(m.id),
      ctx.ds.listOffers(m.id),
      ctx.ds.listEvents({ from: ctx.now.toISOString(), limit: 50 }),
      geoFor(ctx),
    ]);
    const top = [...products]
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder)
      .slice(0, 8)
      .map((p) => toProductFact(p, m, offers, ctx.now));
    const card = toMerchantCard(m, ctx.now);
    const f = m.fulfillment;
    const today = hoursToday(m, ctx.now);
    const { json, value } = compactValue({
      merchant: {
        ...card,
        description: trimText(m.description, 300),
        tags: m.tags,
        ratingCount: m.ratingCount,
        district: geo.districtByMerchant.get(m.id)?.name ?? null,
        timezone: m.openingHours?.timezone ?? null,
        hoursToday: today ? { day: today.day, intervals: today.intervals } : null,
        fulfillment: {
          ...(f.delivery?.enabled ? { delivery: { feeCents: f.delivery.feeCents, eta: `${range(f.delivery.minutesMin, f.delivery.minutesMax, "min")}` } } : {}),
          ...(f.pickup?.enabled ? { pickup: { feeCents: 0, eta: `${range(f.pickup.minutesMin, f.pickup.minutesMax, "min")}` } } : {}),
          ...(f.shipping?.enabled ? { shipping: { feeCents: f.shipping.feeCents, eta: `${range(f.shipping.daysMin, f.shipping.daysMax, "day")}` } } : {}),
          ...(f.booking?.enabled ? { booking: { slotMinutes: f.booking.slotMinutes } } : {}),
        },
        liveOffers: offers.map((o) => ({
          id: o.id,
          title: o.title,
          description: trimText(o.description, 140),
          kind: o.kind,
          value: o.value,
          ...(o.code ? { code: o.code } : {}),
          endsAt: o.endsAt,
        })),
        upcomingEvents: events
          .filter((e) => e.merchantId === m.id)
          .slice(0, 5)
          .map((e) => ({ id: e.id, title: e.title, kind: e.kind, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt })),
        topProducts: top,
      },
    });
    ctx.emit({ type: "cards", merchants: [card] });
    emitProductCards(ctx, top, value.merchant.topProducts);
    return json;
  },
});

export const getEvents: AiTool = defineTool({
  name: "get_events",
  description:
    "Live and upcoming city events (launches, live sets, promos, flash deals) with their merchant and district. Defaults to events that have not ended yet. Returns up to 10.",
  schema: getEventsSchema,
  execute: async (input, ctx) => {
    const events = await ctx.ds.listEvents({
      from: input.from ?? ctx.now.toISOString(),
      ...(input.to ? { to: input.to } : {}),
      ...(input.status?.length ? { status: input.status } : {}),
      limit: MAX_EVENTS,
    });
    const geo = await geoFor(ctx);
    return compactJson({
      now: ctx.now.toISOString(),
      count: events.length,
      events: events.map((e: CityEvent) => ({
        id: e.id,
        title: e.title,
        description: trimText(e.description, 160),
        kind: e.kind,
        status: e.status,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        ...(e.merchantId ? { merchantId: e.merchantId, merchantName: geo.merchantById.get(e.merchantId)?.name ?? null } : {}),
        ...(e.districtId ? { districtId: e.districtId, districtName: geo.districtById.get(e.districtId)?.name ?? null } : {}),
        ...(e.productId ? { productId: e.productId } : {}),
      })),
      ...(events.length === 0 ? { note: "Nothing scheduled in that window." } : {}),
    });
  },
});

export const navigate: AiTool = defineTool({
  name: "navigate",
  description:
    'Offer to take the user somewhere: "teleport" shows a confirm button that jumps them to the merchant door, district or event; "guide" drops a waypoint they can walk to. Only use ids returned by other tools in this turn. Call at most once per recommendation.',
  schema: navigateSchema,
  execute: async (input, ctx) => {
    const { target } = input;
    let name: string | undefined;
    if (target.kind === "merchant") {
      name = (await ctx.ds.getMerchant(target.merchantId))?.name;
      if (!name) return errorResult(`Unknown merchant id "${target.merchantId}".`);
    } else if (target.kind === "district") {
      name = (await ctx.ds.listDistricts()).find((d) => d.id === target.districtId)?.name;
      if (!name) return errorResult(`Unknown district id "${target.districtId}".`);
    } else {
      name = (await ctx.ds.getEvent(target.eventId))?.title;
      if (!name) return errorResult(`Unknown event id "${target.eventId}".`);
    }
    ctx.emit({ type: "action", action: { type: "navigate", target, mode: input.mode, label: input.label || name } });
    return input.mode === "teleport"
      ? `Navigation offered to the user (they confirm teleports). Destination: ${name}.`
      : `Waypoint to ${name} offered to the user.`;
  },
});

export const proposeCart: AiTool = defineTool({
  name: "propose_cart",
  description:
    "Propose adding items to the user's cart. Validates each product and variant selection against the live catalog, applies live offers, and returns the exact unit prices, subtotal, discount, fees and total in cents so you can quote real numbers. Accepted items are added to the user's cart; rejected ones are returned with a reason (e.g. a required size). Use only when the user expresses intent to order.",
  schema: proposeCartSchema,
  execute: async (input, ctx) => {
    const pinned = scopedMerchantId(ctx);
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await ctx.ds.getProducts(ids);
    const productsById: Record<string, Product | undefined> = Object.fromEntries(products.map((p) => [p.id, p]));
    const rejected: Array<{ productId: string; reason: string }> = [];
    const lines: CartLine[] = [];
    const selections = new Map<string, Record<string, string>>();

    for (const item of input.items) {
      const product = productsById[item.productId];
      if (!product) {
        rejected.push({ productId: item.productId, reason: "Unknown product id; use ids from search results." });
        continue;
      }
      if (pinned && product.merchantId !== pinned) {
        rejected.push({ productId: item.productId, reason: "Not sold by this merchant." });
        continue;
      }
      const selection: Record<string, string> = {};
      for (const pair of item.variantSelection ?? []) selection[pair.groupId] = pair.optionId;
      const problem = variantProblem(product, selection);
      if (problem) {
        const groups = product.variantGroups
          .filter((g) => g.required)
          .map((g) => `${g.id}: ${g.options.map((o) => o.id).join("|")}`)
          .join("; ");
        rejected.push({ productId: item.productId, reason: groups ? `${problem} Options → ${groups}` : problem });
        continue;
      }
      const key = lineKey(product.id, selection);
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        existing.quantity = Math.min(10, existing.quantity + item.quantity);
        continue;
      }
      lines.push({ key, productId: product.id, merchantId: product.merchantId, quantity: item.quantity, variantSelection: selection });
      selections.set(key, selection);
    }

    const merchantIds = [...new Set(lines.map((l) => l.merchantId))];
    const merchants = await Promise.all(merchantIds.map((id) => ctx.ds.getMerchant(id)));
    const merchantsById: Record<string, Merchant | undefined> = {};
    const fulfillment: Record<string, "delivery" | "pickup" | "shipping" | "booking" | "ticket" | "digital" | "lead"> = {};
    merchantIds.forEach((id, i) => {
      const merchant = merchants[i] ?? undefined;
      merchantsById[id] = merchant;
      const type = defaultFulfillmentFor(
        merchant,
        lines.filter((l) => l.merchantId === id).map((l) => productsById[l.productId]!),
      );
      if (type) fulfillment[id] = type;
    });
    const offerLists = await Promise.all(merchantIds.map((id) => ctx.ds.listOffers(id)));
    const offers = offerLists.flat();
    const totals = computeTotals(lines, productsById, merchantsById, fulfillment, { offers, now: ctx.now });

    for (const problem of totals.problems) {
      const line = lines.find((l) => l.key === problem.key);
      if (line) rejected.push({ productId: line.productId, reason: problem.reason });
    }
    const accepted = totals.lines.map((l) => {
      const product = productsById[l.productId]!;
      return {
        productId: l.productId,
        title: product.title,
        merchantName: merchantsById[l.merchantId]?.name ?? "Unknown",
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        lineTotalCents: l.lineTotalCents,
        ...(l.offerTitle ? { offer: l.offerTitle } : {}),
        variantSelection: selections.get(l.key) ?? {},
      };
    });

    if (accepted.length) {
      ctx.emit({
        type: "action",
        action: {
          type: "propose_cart",
          items: accepted.map((a) => ({
            productId: a.productId,
            quantity: a.quantity,
            ...(Object.keys(a.variantSelection).length ? { variantSelection: a.variantSelection } : {}),
          })),
          ...(input.note ? { note: input.note } : {}),
        },
      });
      const geo = await geoFor(ctx);
      ctx.emit({
        type: "cards",
        products: accepted.map((a) => toProductCard(toProductFact(productsById[a.productId]!, geo.merchantById.get(productsById[a.productId]!.merchantId), offers, ctx.now))),
      });
    }

    return compactJson({
      ok: rejected.length === 0 && accepted.length > 0,
      accepted,
      rejected,
      currency: totals.currency,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      feesCents: totals.deliveryFeeCents,
      totalCents: totals.totalCents,
      fulfillment: totals.byMerchant.map((b) => ({
        merchantName: merchantsById[b.merchantId]?.name ?? "Unknown",
        type: b.type,
        feeCents: b.feeCents,
      })),
      appliedOffers: totals.appliedOffers.map((a) => ({ title: a.title, discountCents: a.discountCents })),
      ...(accepted.length ? { note: "Accepted items were added to the user's cart; they review and pay at checkout." } : {}),
    });
  },
});

export const escalateToHuman: AiTool = defineTool({
  name: "escalate_to_human",
  description:
    "Hand the conversation to a person at this merchant. Use when the user asks for a human, or when you are unsure about safety or allergy specifics. Returns an acknowledgement (and a contact only when the merchant enabled escalation).",
  schema: escalateSchema,
  execute: async (input, ctx) => {
    const pinned = scopedMerchantId(ctx);
    if (pinned && input.merchantId !== pinned) return errorResult("You can only escalate to this merchant.");
    const [merchant, employee] = await Promise.all([ctx.ds.getMerchant(input.merchantId), ctx.ds.getEmployee(input.merchantId)]);
    if (!merchant) return errorResult(`Unknown merchant id "${input.merchantId}".`);
    ctx.emit({ type: "action", action: { type: "escalate", merchantId: merchant.id, reason: input.reason } });
    const enabled = Boolean(employee?.escalation.enabled);
    return JSON.stringify({
      ok: true,
      acknowledged: true,
      merchantName: merchant.name,
      humanFollowUp: enabled,
      ...(enabled && employee?.escalation.contact ? { contact: employee.escalation.contact } : {}),
      note: enabled
        ? "Tell the user someone from the merchant will follow up; keep helping in the meantime."
        : "This merchant has no live escalation. Apologise, suggest confirming directly with the merchant, and keep helping.",
    });
  },
});

export const recommendItems: AiTool = defineTool({
  name: "recommend_items",
  description:
    "Show specific items from this merchant's catalog as cards (use the product ids from your catalog). Returns their live details, variants and any live offer so you can quote exact prices.",
  schema: recommendItemsSchema,
  execute: async (input, ctx) => {
    const pinned = scopedMerchantId(ctx);
    const products = (await ctx.ds.getProducts(input.productIds)).filter((p) => !pinned || p.merchantId === pinned);
    const geo = await geoFor(ctx);
    const facts = products.map((p) => toProductFact(p, geo.merchantById.get(p.merchantId), geo.offers, ctx.now));
    const missing = input.productIds.filter((id) => !products.some((p) => p.id === id));
    const { json, value } = compactValue({ count: facts.length, products: facts, ...(missing.length ? { unknownIds: missing } : {}) });
    emitProductCards(ctx, facts, value.products);
    return json;
  },
});

/** Deterministic order matters for prompt caching: never reorder or filter per request. */
export const conciergeTools: AiTool[] = [searchMerchants, searchProducts, getMerchant, getEvents, navigate, proposeCart];
export const employeeTools: AiTool[] = [recommendItems, searchProducts, getMerchant, proposeCart, escalateToHuman];

export function toolsFor(scope: ChatScope): AiTool[] {
  return scope === "employee" ? employeeTools : conciergeTools;
}
