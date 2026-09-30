import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizeOrderAccess, publicOrder, refreshOrderStatus } from "@/lib/commerce/service";
import { orderIdSchema, orderTokenSchema } from "@/lib/commerce/validation";
import { forbidden, jsonError, notFound } from "@/lib/commerce/http";
import type { OrderResponse } from "@/lib/commerce/types";

export const runtime = "nodejs";

/**
 * GET /api/orders/[id]?t=<token>
 * Order status for polling. Owner (signed in) or guest token. Advances simulated fulfillment.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!orderIdSchema.safeParse(id).success) return notFound();
  const rawToken = req.nextUrl.searchParams.get("t");
  const token = rawToken && orderTokenSchema.safeParse(rawToken).success ? rawToken : undefined;

  const ds = getDataSource();
  const order = await ds.getOrder(id);
  if (!order) return notFound();
  const user = await getCurrentUser();
  if (!authorizeOrderAccess(order, { userId: user?.id, token })) return forbidden();

  try {
    const fresh = await refreshOrderStatus(order, new Date(), ds);
    return NextResponse.json<OrderResponse>({ order: publicOrder(fresh) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/orders]", err);
    return jsonError(500, "Could not load this order right now.");
  }
}
