import type { NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import type { DraftResponse } from "@/lib/onboarding/api";
import { requireAdmin } from "@/lib/onboarding/auth";
import { DRAFT_ID, adminError, adminJson, parseAdminBody } from "@/lib/onboarding/http";
import { applyDraftPatch } from "@/lib/onboarding/review";
import { draftPatchSchema } from "@/lib/validation/merchantDraft";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/drafts/[id] */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!DRAFT_ID.test(id)) return adminError(404, "Not found");
  const draft = await getDataSource().getMerchantDraft(id);
  if (!draft) return adminError(404, "Not found");
  return adminJson<DraftResponse>({ draft });
}

/**
 * PATCH /api/admin/drafts/[id] { proposal?, placement?, reviewerNotes?, status? }
 * Reviewer edits. Approving re-validates the whole proposal and the placement (`applyDraftPatch`).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!DRAFT_ID.test(id)) return adminError(404, "Not found");
  const body = await parseAdminBody(req, draftPatchSchema);
  if (!body.ok) return body.response;

  const ds = getDataSource();
  const draft = await ds.getMerchantDraft(id);
  if (!draft) return adminError(404, "Not found");
  const [parcels, merchants] = await Promise.all([ds.listParcels(), ds.listMerchants()]);
  const outcome = applyDraftPatch(draft, body.data, {
    parcels,
    merchantSlugs: new Set(merchants.map((m) => m.slug)),
  });
  if (!outcome.ok) {
    return adminError(outcome.status, outcome.error, outcome.problems ? { problems: outcome.problems } : {});
  }
  try {
    const saved = await ds.saveMerchantDraft(outcome.next);
    return adminJson<DraftResponse>({ draft: saved });
  } catch (err) {
    console.error("[api/admin/drafts] save failed", err);
    return adminError(500, "Could not save the draft.");
  }
}
