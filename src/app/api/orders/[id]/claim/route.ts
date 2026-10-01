import { NextResponse, type NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizeOrderAccess, grantOrderRewards, sha256 } from "@/lib/commerce/service";
import { claimOrderSchema, orderIdSchema } from "@/lib/commerce/validation";
import { forbidden, jsonError, notFound, parseBody } from "@/lib/commerce/http";
import type { ClaimResponse } from "@/lib/commerce/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/[id]/claim  { token }
 * Attaches a guest order to the signed-in user (token hash must match) and grants its digital
 * rewards + XP. Idempotent: an order already owned by this user reports `claimed: true`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!orderIdSchema.safeParse(id).success) return notFound();
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Sign in to claim this order.");
  const parsed = await parseBody(req, claimOrderSchema);
  if (!parsed.ok) return parsed.response;

  const ds = getDataSource();
  const order = await ds.getOrder(id);
  if (!order) return notFound();
  if (order.userId === user.id) return NextResponse.json<ClaimResponse>({ claimed: true });
  if (!authorizeOrderAccess(order, { token: parsed.data.token })) return forbidden();

  try {
    const claimed = await ds.claimOrder(order.id, sha256(parsed.data.token), user.id);
    if (claimed) {
      const owned = await ds.getOrder(order.id);
      if (owned) await grantOrderRewards(owned, user.id, ds);
    }
    return NextResponse.json<ClaimResponse>({ claimed });
  } catch (err) {
    console.error("[api/orders/claim]", err);
    return jsonError(500, "Could not claim this order right now.");
  }
}
