import { NextResponse, type NextRequest } from "next/server";
import { features } from "@/lib/env.server";
import { getDataSource } from "@/lib/data";
import { authorizeOrderAccess, completeOrder } from "@/lib/commerce/service";
import { demoPaymentSchema } from "@/lib/commerce/validation";
import { forbidden, jsonError, notFound, parseBody } from "@/lib/commerce/http";
import type { DemoPayResponse } from "@/lib/commerce/types";

export const runtime = "nodejs";

/**
 * POST /api/checkout/demo  { orderId, token }
 * Simulated payment. Exists only when COMMERCE_MODE=demo outside production; otherwise 404.
 * Idempotent: paying an already-paid order is a no-op success.
 */
export async function POST(req: NextRequest) {
  if (!features.demoPayments) return notFound();
  const parsed = await parseBody(req, demoPaymentSchema);
  if (!parsed.ok) return parsed.response;

  const ds = getDataSource();
  const order = await ds.getOrder(parsed.data.orderId);
  if (!order) return notFound();
  if (!authorizeOrderAccess(order, { token: parsed.data.token })) return forbidden();
  if (order.paymentProvider !== "demo")
    return jsonError(400, "This order is not payable with the demo rail.");

  try {
    const paid = await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() });
    if (paid) await completeOrder(paid, ds);
    return NextResponse.json<DemoPayResponse>({ ok: true, orderId: order.id });
  } catch (err) {
    console.error("[api/checkout/demo]", err);
    return jsonError(500, "Payment could not be recorded. Please try again.");
  }
}
