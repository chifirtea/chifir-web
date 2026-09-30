import { NextResponse, type NextRequest } from "next/server";
import { features } from "@/lib/env.server";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { getStripe } from "@/lib/stripe/client";
import { authorizeOrderAccess, completeOrder, publicOrder, refreshOrderStatus } from "@/lib/commerce/service";
import { orderIdSchema, orderTokenBodySchema } from "@/lib/commerce/validation";
import { forbidden, jsonError, notFound, parseBody } from "@/lib/commerce/http";
import type { OrderResponse } from "@/lib/commerce/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/[id]/sync  { token? }
 * Webhook-less fallback (local dev, Stripe CLI not running): asks Stripe whether the Checkout
 * Session was paid and, if so, runs the same paid transition the webhook would. Safe to call
 * repeatedly; `markOrderPaid` is atomic.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!orderIdSchema.safeParse(id).success) return notFound();
  const parsed = await parseBody(req, orderTokenBodySchema);
  if (!parsed.ok) return parsed.response;

  const ds = getDataSource();
  let order = await ds.getOrder(id);
  if (!order) return notFound();
  const user = await getCurrentUser();
  if (!authorizeOrderAccess(order, { userId: user?.id, token: parsed.data.token })) return forbidden();

  try {
    if (order.status === "pending_payment" && order.stripeCheckoutSessionId && features.stripe) {
      const session = await getStripe().checkout.sessions.retrieve(order.stripeCheckoutSessionId);
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        const paid = await ds.markOrderPaid(order.id, {
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
          paidAt: new Date().toISOString(),
        });
        if (paid) order = await completeOrder(paid, ds);
      }
    }
    const fresh = await refreshOrderStatus(order, new Date(), ds);
    return NextResponse.json<OrderResponse>({ order: publicOrder(fresh) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/orders/sync]", err);
    return jsonError(500, "Could not confirm payment right now.");
  }
}
