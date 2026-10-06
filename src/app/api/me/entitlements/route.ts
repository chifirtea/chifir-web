import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { jsonError } from "@/lib/commerce/http";
import type { DigitalReward } from "@/types/domain";

export const runtime = "nodejs";

/** GET /api/me/entitlements — the signed-in user's digital rewards, resolved. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Sign in to see your items.");
  try {
    const ds = getDataSource();
    const grants = await ds.listUserRewards(user.id);
    const rewards: DigitalReward[] = grants.length
      ? await ds.getRewards(grants.map((g) => g.rewardId))
      : [];
    return NextResponse.json({ rewards }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/me/entitlements]", err);
    return jsonError(500, "Could not load your items right now.");
  }
}
