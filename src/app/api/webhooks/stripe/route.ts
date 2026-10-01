import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { features, serverEnv } from "@/lib/env.server";
import { getDataSource, type DataSource } from "@/lib/data";
import { getStripe } from "@/lib/stripe/client";
import { completeOrder } from "@/lib/commerce/service";
import { jsonError, notFound } from "@/lib/commerce/http";
import type { Order, OrderStatus } from "@/types/domain";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/stripe
 * Signature-verified. `checkout.session.completed` / `async_payment_succeeded` mark the order paid
 * (atomic, so retries are no-ops) and kick off fulfillment; `expired` / `async_payment_failed`
 * close orders that are still awaiting payment. Responds 200 once handled; 500 only when storage
 * failed so Stripe retries.
 */
export async function POST(req: NextRequest) {
  if (!features.stripeWebhooks || !serverEnv.STRIPE_WEBHOOK_SECRET) return notFound();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonError(400, "Missing signature");
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, serverEnv.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn(
      "[webhooks/stripe] signature verification failed",
      err instanceof Error ? err.message : err,
    );
    return jsonError(400, "Invalid signature");
  }

  const ds = getDataSource();
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handlePaid(event.data.object, ds);
        break;
      case "checkout.session.expired":
        await handleClosed(event.data.object, "cancelled", ds);
        break;
      case "checkout.session.async_payment_failed":
        await handleClosed(event.data.object, "payment_failed", ds);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[webhooks/stripe] ${event.type} ${event.id} failed`, err);
    return jsonError(500, "Processing failed");
  }
  return NextResponse.json({ received: true });
}

async function resolveOrder(
  session: Stripe.Checkout.Session,
  ds: DataSource,
): Promise<Order | null> {
  const orderId = session.metadata?.orderId ?? session.client_reference_id;
  const order = orderId
    ? await ds.getOrder(orderId)
    : await ds.getOrderByCheckoutSession(session.id);
  if (!order) {
    console.warn(`[webhooks/stripe] no order for session ${session.id}`);
    return null;
  }
  if (order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id) {
    console.warn(`[webhooks/stripe] session ${session.id} does not belong to order ${order.id}`);
    return null;
  }
  return order;
}

async function handlePaid(session: Stripe.Checkout.Session, ds: DataSource): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return; // delayed payment method: wait for async_payment_succeeded
  }
  const order = await resolveOrder(session, ds);
  if (!order) return;
  if (typeof session.amount_total === "number" && session.amount_total !== order.totalCents) {
    console.error(
      `[webhooks/stripe] amount mismatch for order ${order.id}: stripe=${session.amount_total} order=${order.totalCents}`,
    );
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  const paid = await ds.markOrderPaid(order.id, {
    ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    paidAt: new Date().toISOString(),
  });
  if (!paid) return; // already processed (retry) or not pending
  await completeOrder(paid, ds);
}

async function handleClosed(
  session: Stripe.Checkout.Session,
  status: Extract<OrderStatus, "cancelled" | "payment_failed">,
  ds: DataSource,
): Promise<void> {
  const order = await resolveOrder(session, ds);
  if (!order || order.status !== "pending_payment") return;
  await ds.updateOrder(order.id, { status });
}
