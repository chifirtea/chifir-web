import type { NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import type { DraftListResponse } from "@/lib/onboarding/api";
import { requireAdmin } from "@/lib/onboarding/auth";
import { adminError, adminJson } from "@/lib/onboarding/http";

export const runtime = "nodejs";

/** GET /api/admin/drafts → every merchant draft, newest first. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const drafts = await getDataSource().listMerchantDrafts();
    return adminJson<DraftListResponse>({ drafts });
  } catch (err) {
    console.error("[api/admin/drafts]", err);
    return adminError(500, "Could not load drafts.");
  }
}
