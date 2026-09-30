import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  CartLine,
  FulfillmentSelection,
  FulfillmentType,
  Merchant,
  Order,
  OrderFulfillment,
  OrderStatus,
  PaymentProvider,
  Product,
} from "@/types/domain";
import type { CreateOrderInput, DataSource } from "@/lib/data/types";
import { getDataSource } from "@/lib/data";
import type { CheckoutRequestInput } from "@/lib/validation/checkout";
import type { AnalyticsRecord } from "@/lib/analytics/events";
import { computeTotals, lineKey, variantLabel, type CartTotals } from "@/features/cart/pricing";
import { getFulfillmentProvider, isTerminalFulfillment } from "./fulfillment/provider";
import type { CheckoutProblem, PublicOrder } from "./types";

/**
 * Commerce service: the only code that turns a cart into an order and an order into fulfillment.
 * Money is never computed here; `computeTotals` (shared with the client preview) is authoritative.
 * Every function takes the DataSource as its last argument so tests inject `StaticDataSource`.
 */

export class CheckoutError extends Error {
  readonly status: number;
  readonly problems: CheckoutProblem[];
  constructor(status: number, message: string, problems: CheckoutProblem[] = []) {
    super(message);
    this.name = "CheckoutError";
    this.status = status;
    this.problems = problems;
  }
}

export const PAID_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "paid",
  "in_fulfillment",
  "completed",
]);
export const XP_BASE_PER_PURCHASE = 50;
const NEEDS_ADDRESS: ReadonlySet<FulfillmentType> = new Set(["delivery", "shipping"]);
const MAX_LINE_QUANTITY = 99;

// ------------------------------------------------------------------------ tokens & access

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function issueAccessToken(): { accessToken: string; accessTokenHash: string } {
  const accessToken = randomBytes(32).toString("hex");
  return { accessToken, accessTokenHash: sha256(accessToken) };
}

/** Owner (signed in) or bearer of the guest token issued at checkout. */
export function authorizeOrderAccess(
  order: Pick<Order, "userId" | "accessTokenHash">,
  who: { userId?: string | null; token?: string | null },
): boolean {
  if (order.userId && who.userId && who.userId === order.userId) return true;
  if (who.token && order.accessTokenHash && hashesMatch(sha256(who.token), order.accessTokenHash))
    return true;
  return false;
}

/** Strips server-only fields before an order leaves the process. */
export function publicOrder(order: Order): PublicOrder {
  const { accessTokenHash: _hash, ...rest } = order;
  void _hash;
  return rest;
}

// ------------------------------------------------------------------------ checkout

export interface CreateCheckoutOrderInput {
  body: CheckoutRequestInput;
  userId?: string | undefined;
  /** Which rail will collect payment. Decided by the route from feature flags. */
  paymentProvider?: PaymentProvider;
}

export interface CreateCheckoutOrderResult {
  order: Order;
  totals: CartTotals;
  /** Plain guest token. Returned once; only its hash is stored. */
  accessToken: string;
}

/** Merges duplicate product+variant lines so quantities cannot be split to dodge caps. */
function toCartLines(
  body: CheckoutRequestInput,
  productsById: Record<string, Product | undefined>,
): CartLine[] {
  const byKey = new Map<string, CartLine>();
  for (const input of body.lines) {
    const key = lineKey(input.productId, input.variantSelection);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + input.quantity);
      if (input.notes) existing.notes = input.notes;
      continue;
    }
    byKey.set(key, {
      key,
      productId: input.productId,
      merchantId: productsById[input.productId]?.merchantId ?? "",
      quantity: input.quantity,
      variantSelection: input.variantSelection,
      ...(input.notes ? { notes: input.notes } : {}),
    });
  }
  return [...byKey.values()];
}

export async function createCheckoutOrder(
  input: CreateCheckoutOrderInput,
  ds: DataSource = getDataSource(),
): Promise<CreateCheckoutOrderResult> {
  const { body } = input;
  const paymentProvider = input.paymentProvider ?? "stripe";
  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const [products, merchants, offers] = await Promise.all([
    ds.getProducts(productIds),
    ds.listMerchants(),
    ds.listOffers(),
  ]);
  const productsById: Record<string, Product | undefined> = Object.fromEntries(
    products.map((p) => [p.id, p]),
  );
  const merchantsById: Record<string, Merchant | undefined> = Object.fromEntries(
    merchants.map((m) => [m.id, m]),
  );

  const lines = toCartLines(body, productsById);
  const fulfillment: FulfillmentSelection = {};
  for (const f of body.fulfillment) fulfillment[f.merchantId] = f.type;

  const unassigned = lines.filter((l) => l.merchantId && !fulfillment[l.merchantId]);
  if (unassigned.length > 0) {
    throw new CheckoutError(
      400,
      "Choose how you want each order delivered.",
      unassigned.map((l) => ({ key: l.key, reason: "Choose how you want this delivered." })),
    );
  }

  const totals = computeTotals(lines, productsById, merchantsById, fulfillment, {
    offers,
    ...(body.promoCode ? { promoCode: body.promoCode } : {}),
  });
  if (totals.problems.length > 0) {
    throw new CheckoutError(400, "Some items need attention", totals.problems);
  }
  if (totals.lines.length === 0) {
    throw new CheckoutError(400, "Your cart is empty.");
  }

  const { accessToken, accessTokenHash } = issueAccessToken();
  const linesByKey = new Map(lines.map((l) => [l.key, l]));
  const items: CreateOrderInput["items"] = totals.lines.map((priced) => {
    const product = productsById[priced.productId]!;
    const line = linesByKey.get(priced.key)!;
    const merchant = merchantsById[priced.merchantId];
    const label = variantLabel(product, line.variantSelection);
    return {
      productId: product.id,
      merchantId: priced.merchantId,
      merchantNameSnapshot: merchant?.name ?? "",
      titleSnapshot: product.title,
      ...(product.imageUrl ? { imageUrlSnapshot: product.imageUrl } : {}),
      unitPriceCents: priced.unitPriceCents,
      discountCents: priced.discountCents,
      ...(priced.offerId ? { offerId: priced.offerId } : {}),
      quantity: priced.quantity,
      variantSelection: line.variantSelection,
      ...(label ? { variantLabel: label } : {}),
      ...(product.digitalRewardId ? { digitalRewardId: product.digitalRewardId } : {}),
    };
  });

  const created = await ds.createOrder({
    status: "pending_payment",
    currency: totals.currency,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    ...(body.deliveryAddress ? { deliveryAddress: body.deliveryAddress } : {}),
    contact: body.contact,
    ...(body.promoCode ? { promoCode: body.promoCode } : {}),
    accessTokenHash,
    ...(body.analytics
      ? { sessionId: body.analytics.sessionId, anonymousId: body.analytics.anonymousId }
      : {}),
    paymentProvider,
    ...(input.userId ? { userId: input.userId } : {}),
    items,
  });

  for (const m of totals.byMerchant) {
    if (!m.type || !m.supported || m.subtotalCents === 0) continue;
    const merchant = merchantsById[m.merchantId];
    await ds.upsertFulfillment({
      orderId: created.id,
      merchantId: m.merchantId,
      merchantNameSnapshot: merchant?.name ?? "",
      provider: merchant?.fulfillment.provider ?? "simulated",
      type: m.type,
      status: "pending",
      subtotalCents: m.subtotalCents,
      feeCents: m.feeCents,
      recipient: body.contact,
      ...(NEEDS_ADDRESS.has(m.type) && body.deliveryAddress
        ? { deliveryAddress: body.deliveryAddress }
        : {}),
      events: [],
    });
  }

  const order = (await ds.getOrder(created.id)) ?? created;
  return { order, totals, accessToken };
}

// ------------------------------------------------------------------------ after payment

function distinct(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/**
 * Grants the order's digital twins and purchase XP to a user. Idempotent: `grantReward` upserts
 * and `addXp` is keyed by (user, reason, order). Safe to call from the webhook and from a later claim.
 */
export async function grantOrderRewards(
  order: Order,
  userId: string,
  ds: DataSource = getDataSource(),
): Promise<void> {
  if (!PAID_ORDER_STATUSES.has(order.status)) return;
  for (const rewardId of distinct(order.items.map((i) => i.digitalRewardId))) {
    await ds.grantReward(userId, rewardId, order.id);
  }
  await ds.addXp(
    userId,
    XP_BASE_PER_PURCHASE + Math.floor(order.totalCents / 100),
    "purchase",
    order.id,
  );
}

/**
 * Runs once per order, right after `markOrderPaid` returned non-null (the atomic transition is the
 * idempotency guard). Redeems offers, hands each merchant's fulfillment to its provider, grants
 * rewards and XP for signed-in buyers, and records `purchase_completed`.
 */
export async function completeOrder(
  order: Order,
  ds: DataSource = getDataSource(),
): Promise<Order> {
  const now = new Date();

  for (const offerId of distinct(order.items.map((i) => i.offerId))) {
    const counted = await ds.redeemOffer(offerId);
    if (!counted)
      console.warn(
        `[commerce] offer ${offerId} could not be redeemed for order ${order.id} (cap reached or expired after pricing)`,
      );
  }

  for (const fulfillment of order.fulfillments) {
    if (fulfillment.status !== "pending") continue; // already handed off on a previous attempt
    const merchant = fulfillment.merchantId ? await ds.getMerchant(fulfillment.merchantId) : null;
    const items = order.items.filter((i) => i.merchantId === fulfillment.merchantId);
    const provider = getFulfillmentProvider(fulfillment.provider);
    const next = await provider.create({ order, fulfillment, merchant, items }, now);
    await ds.upsertFulfillment(next);
  }

  if (order.userId) await grantOrderRewards(order, order.userId, ds);

  const merchantIds = distinct(order.items.map((i) => i.merchantId));
  const record: AnalyticsRecord<"purchase_completed"> = {
    name: "purchase_completed",
    props: {
      orderId: order.id,
      totalCents: order.totalCents,
      discountCents: order.discountCents,
      lines: order.items.length,
      merchants: merchantIds.length,
      merchantIds,
      productIds: distinct(order.items.map((i) => i.productId)),
      provider: order.paymentProvider,
    },
    ts: Date.now(),
    sessionId: order.sessionId ?? "server",
    anonymousId: order.anonymousId ?? "server",
    ...(order.userId ? { userId: order.userId } : {}),
  };
  await ds.recordAnalytics([record]);

  const fresh = (await ds.getOrder(order.id)) ?? order;
  return refreshOrderStatus(fresh, now, ds);
}

/**
 * Polls each live fulfillment's provider and persists what changed, then derives the order status:
 * paid + fulfillments -> in_fulfillment; every fulfillment delivered -> completed.
 */
export async function refreshOrderStatus(
  order: Order,
  now: Date = new Date(),
  ds: DataSource = getDataSource(),
): Promise<Order> {
  if (!PAID_ORDER_STATUSES.has(order.status)) return order;

  let changed = false;
  const fulfillments: OrderFulfillment[] = [];
  for (const f of order.fulfillments) {
    if (isTerminalFulfillment(f.status)) {
      fulfillments.push(f);
      continue;
    }
    const next = await getFulfillmentProvider(f.provider).getStatus(f, now);
    if (next !== f) {
      await ds.upsertFulfillment(next);
      changed = true;
    }
    fulfillments.push(next);
  }

  let result: Order = changed ? { ...order, fulfillments } : order;
  let status: OrderStatus = result.status;
  const allDelivered =
    fulfillments.length > 0 && fulfillments.every((f) => f.status === "delivered");
  if (allDelivered) status = "completed";
  else if (fulfillments.length > 0 && status === "paid") status = "in_fulfillment";
  if (status !== result.status) result = await ds.updateOrder(order.id, { status });
  return result;
}
