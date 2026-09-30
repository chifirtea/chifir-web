import "server-only";
import type Stripe from "stripe";
import type { FulfillmentType, Order } from "@/types/domain";
import type { CartTotals } from "@/features/cart/pricing";
import { getStripe } from "@/lib/stripe/client";

const SESSION_TTL_SECONDS = 31 * 60; // Stripe requires >= 30 min; a minute of slack for clock skew
const MAX_NAME = 200;
const MAX_COUPON_NAME = 40;

function feeLabel(type: FulfillmentType): string {
  return type === "shipping" ? "Shipping fee" : "Delivery fee";
}

/**
 * Builds a hosted Checkout Session from the persisted order snapshots. Line items mirror
 * `order.items` (already priced by `computeTotals`); merchant fees and the discount are added so
 * Stripe charges exactly `order.totalCents`.
 */
export async function createStripeCheckoutSession(input: {
  order: Order;
  totals: CartTotals;
  accessToken: string;
  appUrl: string;
}): Promise<Stripe.Checkout.Session> {
  const { order, totals, accessToken, appUrl } = input;
  const stripe = getStripe();
  const currency = order.currency.toLowerCase();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => {
    const name = item.variantLabel ? `${item.titleSnapshot} (${item.variantLabel})` : item.titleSnapshot;
    const images = item.imageUrlSnapshot?.startsWith("https://") ? [item.imageUrlSnapshot] : [];
    return {
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: item.unitPriceCents,
        product_data: {
          name: name.slice(0, MAX_NAME),
          ...(images.length ? { images } : {}),
          metadata: { productId: item.productId ?? "", merchantId: item.merchantId ?? "" },
        },
      },
    };
  });
  for (const f of order.fulfillments) {
    if (f.feeCents <= 0) continue;
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: f.feeCents,
        product_data: { name: `${feeLabel(f.type)} — ${f.merchantNameSnapshot}`.slice(0, MAX_NAME) },
      },
    });
  }

  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
  if (order.discountCents > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: order.discountCents,
      currency,
      duration: "once",
      name: (totals.appliedOffers.map((o) => o.title).join(", ") || "Discount").slice(0, MAX_COUPON_NAME),
      metadata: { orderId: order.id },
    });
    discounts.push({ coupon: coupon.id });
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    ...(discounts.length ? { discounts } : {}),
    customer_email: order.contact.email,
    client_reference_id: order.id,
    metadata: { orderId: order.id },
    success_url: `${appUrl}/orders/${order.id}?t=${accessToken}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/city?checkout=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    payment_intent_data: { metadata: { orderId: order.id } },
  });
}
