import type { NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import type { PlacementsResponse } from "@/lib/onboarding/api";
import { requireAdmin } from "@/lib/onboarding/auth";
import { DRAFT_ID, adminError, adminJson } from "@/lib/onboarding/http";
import { freeParcels, placementOptions, suggestDistrict } from "@/lib/onboarding/placement";

export const runtime = "nodejs";

/**
 * GET /api/admin/placements?districtId=&draftId= → free parcels (optionally per district), each
 * flagged with whether the draft's storefront template fits it, plus a suggested district.
 */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const districtId = req.nextUrl.searchParams.get("districtId") ?? undefined;
  const draftId = req.nextUrl.searchParams.get("draftId") ?? undefined;
  if (districtId !== undefined && !DRAFT_ID.test(districtId)) return adminError(400, "Invalid districtId.");
  if (draftId !== undefined && !DRAFT_ID.test(draftId)) return adminError(400, "Invalid draftId.");

  const ds = getDataSource();
  const [districts, parcels] = await Promise.all([ds.listDistricts(), ds.listParcels()]);
  const draft = draftId ? await ds.getMerchantDraft(draftId) : null;
  if (draftId && !draft) return adminError(404, "Draft not found.");

  const options = draft
    ? placementOptions(parcels, draft.proposal.merchant, districtId)
    : freeParcels(parcels, districtId).map((parcel) => ({ parcel, fits: true, problem: null }));
  const suggested = draft ? suggestDistrict(draft.proposal.merchant.category, districts, parcels) : undefined;
  return adminJson<PlacementsResponse>({
    districts,
    parcels: options,
    ...(suggested ? { suggestedDistrictId: suggested.id } : {}),
  });
}
