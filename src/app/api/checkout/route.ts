import { NextResponse, type NextRequest } from "next/server";
import { features } from "@/lib/env.server";
import { publicEnv } from "@/lib/env";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { checkoutRequestSchema } from "@/lib/validation/checkout";
import { CheckoutError, completeOrder, createCheckoutOrder } from "@/lib/commerce/service";
import { createStripeCheckoutSession } from "@/lib/commerce/stripeCheckout";
import { jsonError, parseBody } from "@/lib/commerce/http";
import type { CheckoutResponse } from "@/lib/commerce/types";

export const runtime = "nodejs";

/**
 * POST /api/checkout
 * Body: `checkoutRequestSchema`. Re-prices the cart from the catalog, creates a pending order and
 * returns where to send the browser: Stripe Checkout, the demo payment page, or (free orders) the
 * order page itself.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, checkoutRequestSchema);
  if (!parsed.ok) return parsed.response;

  if (!features.stripe && !features.demoPayments) {
    return jsonError(503, "Checkout is not configured");
  }
  const paymentProvider = features.stripe ? "stripe" : "demo";
  const ds = getDataSource();
  const user = await getCurrentUser();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  try {
    const { order, totals, accessToken } = await createCheckoutOrder(
      { body: parsed.data, paymentProvider, ...(user ? { userId: user.id } : {}) },
      ds,
    );
    const orderPath = `/orders/${order.id}?t=${accessToken}`;

    if (totals.totalCents === 0) {
      // Nothing to collect (free tickets): complete right away, no payment rail involved.
      const paid = await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() });
      if (paid) await completeOrder(paid, ds);
      return NextResponse.json<CheckoutResponse>({ url: orderPath, orderId: order.id, free: true });
    }

    if (paymentProvider === "stripe") {
      const session = await createStripeCheckoutSession({ order, totals, accessToken, appUrl });
      await ds.updateOrder(order.id, { stripeCheckoutSessionId: session.id });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
      return NextResponse.json<CheckoutResponse>({ url: session.url, orderId: order.id });
    }

    return NextResponse.json<CheckoutResponse>({
      url: `/checkout/demo?order=${order.id}&t=${accessToken}`,
      orderId: order.id,
      demo: true,
    });
  } catch (err) {
    if (err instanceof CheckoutError) {
      return jsonError(err.status, err.message, err.problems.length ? { problems: err.problems } : {});
    }
    console.error("[api/checkout]", err);
    return jsonError(500, "Checkout failed. Please try again.");
  }
}
