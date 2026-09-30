import type {
  CartLine,
  CurrencyCode,
  FulfillmentSelection,
  FulfillmentType,
  Merchant,
  Offer,
  Product,
} from "@/types/domain";
import { availabilityProblem } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";

/** Stable, injective identity for a product + variant combination. */
export function lineKey(productId: string, variantSelection: Record<string, string> = {}): string {
  const entries = Object.entries(variantSelection)
    .filter(([, v]) => Boolean(v))
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? `${productId}|${JSON.stringify(entries)}` : productId;
}

/** Base price plus the deltas of every selected, known variant option. Unknown ids are ignored. */
export function unitPriceCents(
  product: Product,
  variantSelection: Record<string, string> = {},
): number {
  let price = product.priceCents;
  for (const group of product.variantGroups) {
    const optionId = variantSelection[group.id];
    if (!optionId) continue;
    const option = group.options.find((o) => o.id === optionId);
    if (option) price += option.priceDeltaCents;
  }
  return price;
}

export function variantLabel(
  product: Product,
  variantSelection: Record<string, string> = {},
): string | undefined {
  const labels: string[] = [];
  for (const group of product.variantGroups) {
    const optionId = variantSelection[group.id];
    if (!optionId) continue;
    const option = group.options.find((o) => o.id === optionId);
    if (option) labels.push(option.name);
  }
  return labels.length ? labels.join(" · ") : undefined;
}

/**
 * Why a product + variant selection cannot be added or bought, else null. `now` defaults to the
 * city clock on the client; server code passes the request's clock explicitly.
 */
export function variantProblem(
  product: Product | undefined,
  variantSelection: Record<string, string>,
  now: number = clockNow(),
): string | null {
  if (!product || !product.active) return "This item is no longer available.";
  const availability = availabilityProblem(product, now);
  if (availability) return availability;
  if (product.inventoryStatus === "out_of_stock") return "Sold out.";
  const known = new Set(product.variantGroups.map((g) => g.id));
  for (const key of Object.keys(variantSelection)) {
    if (variantSelection[key] && !known.has(key)) return "Unknown option.";
  }
  for (const group of product.variantGroups) {
    const optionId = variantSelection[group.id];
    if (group.required && !optionId) return `Choose a ${group.name.toLowerCase()}.`;
    if (optionId) {
      const option = group.options.find((o) => o.id === optionId);
      if (!option) return `Invalid ${group.name.toLowerCase()}.`;
      if (option.inventoryStatus === "out_of_stock") return `${option.name} is sold out.`;
    }
  }
  return null;
}

const TYPE_LABEL: Record<FulfillmentType, string> = {
  delivery: "delivery",
  pickup: "pickup",
  shipping: "shipping",
  booking: "booking",
  ticket: "tickets",
  digital: "digital delivery",
  lead: "inquiry",
};

/** Whether a merchant can fulfil the given type at all, and the fee it charges for it. */
export function merchantFulfillment(
  merchant: Merchant | undefined,
  type: FulfillmentType,
): { supported: boolean; feeCents: number } {
  const f = merchant?.fulfillment;
  if (!f) return { supported: false, feeCents: 0 };
  switch (type) {
    case "delivery":
      return {
        supported: Boolean(f.delivery?.enabled),
        feeCents: f.delivery?.enabled ? f.delivery.feeCents : 0,
      };
    case "shipping":
      return {
        supported: Boolean(f.shipping?.enabled),
        feeCents: f.shipping?.enabled ? f.shipping.feeCents : 0,
      };
    case "pickup":
      return { supported: Boolean(f.pickup?.enabled), feeCents: 0 };
    case "booking":
      return { supported: Boolean(f.booking?.enabled), feeCents: 0 };
    case "ticket":
    case "digital":
    case "lead":
      // No merchant-level configuration: the products themselves declare these types.
      return { supported: true, feeCents: 0 };
  }
}

/** Full purchasability check for a line under a chosen fulfillment type. */
export function lineProblem(
  product: Product | undefined,
  line: CartLine,
  fulfillmentType: FulfillmentType,
  now: number = clockNow(),
): string | null {
  const vp = variantProblem(product, line.variantSelection, now);
  if (vp || !product) return vp ?? "Unavailable.";
  if (!product.fulfillmentTypes.includes(fulfillmentType)) {
    return `${product.title} is not available for ${TYPE_LABEL[fulfillmentType]}.`;
  }
  return null;
}

const FULFILLMENT_PREFERENCE: FulfillmentType[] = [
  "delivery",
  "shipping",
  "pickup",
  "booking",
  "ticket",
  "digital",
  "lead",
];

/** The default fulfillment type for a merchant's lines: first type both the merchant and every product support. */
export function defaultFulfillmentFor(
  merchant: Merchant | undefined,
  products: Product[],
): FulfillmentType | null {
  for (const type of FULFILLMENT_PREFERENCE) {
    if (!merchantFulfillment(merchant, type).supported) continue;
    if (products.length && !products.every((p) => p.fulfillmentTypes.includes(type))) continue;
    return type;
  }
  return null;
}

/** Fulfillment types a merchant offers that every given product supports. */
export function availableFulfillmentTypes(
  merchant: Merchant | undefined,
  products: Product[],
): FulfillmentType[] {
  return FULFILLMENT_PREFERENCE.filter(
    (type) =>
      merchantFulfillment(merchant, type).supported &&
      products.every((p) => p.fulfillmentTypes.includes(type)),
  );
}

// ---------------------------------------------------------------------------------- offers

function offerAppliesToProduct(offer: Offer, product: Product): boolean {
  if (offer.merchantId !== product.merchantId) return false;
  const scopeIds = offer.productId
    ? [offer.productId, ...(offer.scope.productIds ?? [])]
    : offer.scope.productIds;
  const hasScope = Boolean(
    scopeIds?.length || offer.scope.categories?.length || offer.scope.tags?.length,
  );
  if (!hasScope) return true;
  if (scopeIds?.includes(product.id)) return true;
  if (offer.scope.categories?.includes(product.category)) return true;
  if (offer.scope.tags?.some((t) => product.tags.includes(t))) return true;
  return false;
}

export function offerIsLive(offer: Offer, now: Date, promoCode?: string): boolean {
  if (!offer.active) return false;
  if (offer.kind !== "percent_off" && offer.kind !== "amount_off") return false; // only priceable kinds
  const t = now.getTime();
  if (Date.parse(offer.startsAt) > t || Date.parse(offer.endsAt) < t) return false;
  if (offer.maxRedemptions !== undefined && offer.redemptionsCount >= offer.maxRedemptions)
    return false;
  if (offer.code && offer.code.toLowerCase() !== (promoCode ?? "").toLowerCase()) return false;
  return true;
}

/** Per-unit discount of one offer on one unit price. */
export function unitDiscountCents(offer: Offer, unitCents: number): number {
  if (offer.kind === "percent_off")
    return Math.min(unitCents, Math.round((unitCents * offer.value) / 100));
  if (offer.kind === "amount_off") return Math.min(unitCents, offer.value);
  return 0;
}

/** The best single live offer for a product (no stacking). */
export function bestOfferFor(
  product: Product,
  unitCents: number,
  offers: Offer[],
  now: Date,
  promoCode?: string,
): Offer | null {
  let best: Offer | null = null;
  let bestDiscount = 0;
  for (const offer of offers) {
    if (!offerIsLive(offer, now, promoCode) || !offerAppliesToProduct(offer, product)) continue;
    const d = unitDiscountCents(offer, unitCents);
    if (d > bestDiscount) {
      best = offer;
      bestDiscount = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------- totals

export interface PricedLine {
  key: string;
  productId: string;
  merchantId: string;
  quantity: number;
  unitPriceCents: number;
  /** Total discount across all units of the line. */
  discountCents: number;
  offerId?: string;
  offerTitle?: string;
  lineTotalCents: number;
}

export interface MerchantTotals {
  merchantId: string;
  type: FulfillmentType | null;
  supported: boolean;
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
}

export interface CartTotals {
  currency: CurrencyCode;
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
  byMerchant: MerchantTotals[];
  appliedOffers: Array<{
    offerId: string;
    title: string;
    merchantId: string;
    discountCents: number;
  }>;
  /** Whether the promo code matched any live offer. Undefined when no code was given. */
  promoCodeApplied?: boolean;
  /** Line keys that cannot be purchased, with reasons. */
  problems: Array<{ key: string; reason: string }>;
}

export interface TotalsOptions {
  offers?: Offer[];
  now?: Date;
  promoCode?: string;
}

/**
 * Pure, side-effect-free totals. Used by the client for display and by the server as the
 * authoritative computation at checkout. Fulfillment is chosen per merchant. Discounts come only
 * from live offers in `options.offers`. Taxes are 0 in the MVP (Stripe Tax can be enabled later).
 */
export function computeTotals(
  lines: CartLine[],
  productsById: Record<string, Product | undefined>,
  merchantsById: Record<string, Merchant | undefined>,
  fulfillment: FulfillmentSelection,
  options: TotalsOptions = {},
): CartTotals {
  const now = options.now ?? new Date(clockNow());
  const offers = options.offers ?? [];
  const promoCode = options.promoCode?.trim() || undefined;
  const problems: CartTotals["problems"] = [];
  const priced: PricedLine[] = [];
  const perMerchant = new Map<string, MerchantTotals>();
  const applied = new Map<
    string,
    { offerId: string; title: string; merchantId: string; discountCents: number }
  >();
  let currency: CurrencyCode | null = null;
  let itemCount = 0;

  for (const line of lines) {
    const product = productsById[line.productId];
    const merchantId = product?.merchantId ?? line.merchantId;
    const type = fulfillment[merchantId];
    const entry = perMerchant.get(merchantId) ?? {
      merchantId,
      type: type ?? null,
      supported: false,
      subtotalCents: 0,
      discountCents: 0,
      feeCents: 0,
    };
    perMerchant.set(merchantId, entry);

    if (!product) {
      problems.push({ key: line.key, reason: "This item is no longer available." });
      continue;
    }
    if (!type) {
      problems.push({ key: line.key, reason: "Choose how you want this delivered." });
      continue;
    }
    const problem = lineProblem(product, line, type, now.getTime());
    if (problem) {
      problems.push({ key: line.key, reason: problem });
      continue;
    }
    if (currency && product.currency !== currency) {
      problems.push({ key: line.key, reason: "Mixed currencies are not supported yet." });
      continue;
    }
    currency = product.currency;

    const unit = unitPriceCents(product, line.variantSelection);
    const offer = bestOfferFor(product, unit, offers, now, promoCode);
    const discount = offer ? unitDiscountCents(offer, unit) * line.quantity : 0;
    const lineTotal = unit * line.quantity - discount;
    priced.push({
      key: line.key,
      productId: product.id,
      merchantId,
      quantity: line.quantity,
      unitPriceCents: unit,
      discountCents: discount,
      ...(offer ? { offerId: offer.id, offerTitle: offer.title } : {}),
      lineTotalCents: lineTotal,
    });
    if (offer) {
      const a = applied.get(offer.id) ?? {
        offerId: offer.id,
        title: offer.title,
        merchantId: offer.merchantId,
        discountCents: 0,
      };
      a.discountCents += discount;
      applied.set(offer.id, a);
    }
    itemCount += line.quantity;
    entry.subtotalCents += unit * line.quantity;
    entry.discountCents += discount;
  }

  for (const entry of perMerchant.values()) {
    const merchant = merchantsById[entry.merchantId];
    if (!entry.type) continue;
    const mf = merchantFulfillment(merchant, entry.type);
    entry.supported = mf.supported;
    entry.feeCents = mf.supported && entry.subtotalCents > 0 ? mf.feeCents : 0;
    if (!mf.supported) {
      for (const line of lines) {
        const product = productsById[line.productId];
        const mid = product?.merchantId ?? line.merchantId;
        if (mid === entry.merchantId && !problems.some((p) => p.key === line.key)) {
          problems.push({
            key: line.key,
            reason: `${merchant?.name ?? "This place"} does not offer ${TYPE_LABEL[entry.type]}.`,
          });
        }
      }
      entry.subtotalCents = 0;
      entry.discountCents = 0;
      entry.feeCents = 0;
    }
  }

  const problemKeys = new Set(problems.map((p) => p.key));
  const validLines = priced.filter((l) => !problemKeys.has(l.key));
  const byMerchant = [...perMerchant.values()];
  const subtotalCents = validLines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const discountCents = validLines.reduce((s, l) => s + l.discountCents, 0);
  const deliveryFeeCents = byMerchant.reduce((s, m) => s + m.feeCents, 0);
  const taxCents = 0;
  const appliedOffers = [...applied.values()].filter((a) => a.discountCents > 0);

  return {
    currency: currency ?? "USD",
    lines: validLines,
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    taxCents,
    totalCents: Math.max(0, subtotalCents - discountCents + deliveryFeeCents + taxCents),
    itemCount: validLines.reduce((n, l) => n + l.quantity, 0) || itemCount,
    byMerchant,
    appliedOffers,
    ...(promoCode !== undefined
      ? {
          promoCodeApplied: offers.some(
            (o) =>
              o.code?.toLowerCase() === promoCode.toLowerCase() &&
              appliedOffers.some((a) => a.offerId === o.id),
          ),
        }
      : {}),
    problems,
  };
}
