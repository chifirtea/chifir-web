import type { NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import type { PublishResponse } from "@/lib/onboarding/api";
import { requireAdmin } from "@/lib/onboarding/auth";
import { DRAFT_ID, adminError, adminJson } from "@/lib/onboarding/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/drafts/[id]/publish → `publishMerchantDraft`. The data layer refuses anything
 * that is not approved with a free placement (`draftPublishProblem`); its message is returned as 409.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!DRAFT_ID.test(id)) return adminError(404, "Not found");
  const ds = getDataSource();
  const draft = await ds.getMerchantDraft(id);
  if (!draft) return adminError(404, "Not found");
  // Slugs are how the city deep-links (`/city?to=<slug>`); the data layer does not check them.
  const slug = draft.proposal.merchant.slug;
  if (draft.status !== "published" && (await ds.getMerchantBySlug(slug))) {
    return adminError(409, `The slug "${slug}" is already used by a merchant in the city.`);
  }
  try {
    const { merchantId } = await ds.publishMerchantDraft(id);
    return adminJson<PublishResponse>({ merchantId, slug, cityUrl: `/city?to=${encodeURIComponent(slug)}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not publish this draft.";
    console.error("[api/admin/publish]", message);
    return adminError(409, message);
  }
}
