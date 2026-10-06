import type { NextRequest } from "next/server";
import { getDataSource } from "@/lib/data";
import { features } from "@/lib/env.server";
import type { DraftResponse } from "@/lib/onboarding/api";
import { requireAdmin } from "@/lib/onboarding/auth";
import { localFetchAllowed } from "@/lib/onboarding/env";
import { extractMerchant } from "@/lib/onboarding/extract";
import { adminError, adminJson, parseAdminBody } from "@/lib/onboarding/http";
import { OnboardingError } from "@/lib/onboarding/ssrf";
import {
  NotConfiguredError,
  StructureError,
  structureMerchant,
  structureMerchantHeuristic,
  type StructureResult,
} from "@/lib/onboarding/structure";
import { extractRequestSchema } from "@/lib/validation/merchantDraft";

export const runtime = "nodejs";
/** Fetching a store plus one AI call can take a while; well under the platform ceiling. */
export const maxDuration = 90;

const POLICY_CODES = new Set(["invalid_url", "blocked_host"]);

/**
 * POST /api/admin/drafts/extract { url, hints? } (+ `?allowLocal=1` outside production)
 * → extracts the store, structures it (Claude when configured, else the heuristic mapping; the
 * heuristic is also the fallback when the AI call fails) and saves an `extracted` draft.
 */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await parseAdminBody(req, extractRequestSchema);
  if (!body.ok) return body.response;
  const allowLocal = localFetchAllowed(req.nextUrl.searchParams.get("allowLocal") === "1");

  let extraction;
  try {
    extraction = await extractMerchant(body.data.url, { allowLocal });
  } catch (err) {
    if (err instanceof OnboardingError) {
      return adminError(POLICY_CODES.has(err.code) ? 400 : 502, err.message, { code: err.code });
    }
    console.error("[api/admin/extract]", err);
    return adminError(502, "Could not read that store.");
  }

  const hints = body.data.hints ?? {};
  let result: StructureResult;
  if (features.ai) {
    try {
      result = await structureMerchant(extraction, hints);
    } catch (err) {
      const reason = err instanceof StructureError || err instanceof NotConfiguredError ? err.message : "unexpected error";
      console.error("[api/admin/extract] AI structuring failed:", reason);
      result = structureMerchantHeuristic(extraction, hints);
      result.warnings.unshift(`AI structuring failed (${reason.split("\n")[0]}); a heuristic proposal was used instead.`);
    }
  } else {
    result = structureMerchantHeuristic(extraction, hints);
  }
  extraction.meta = {
    proposalSource: result.source,
    ...(result.model ? { model: result.model } : {}),
    structuringWarnings: result.warnings,
  };

  try {
    const draft = await getDataSource().saveMerchantDraft({
      sourceUrl: extraction.sourceUrl,
      status: "extracted",
      extraction,
      proposal: result.proposal,
    });
    return adminJson<DraftResponse>({ draft }, { status: 201 });
  } catch (err) {
    console.error("[api/admin/extract] save failed", err);
    return adminError(500, "Could not save the draft.");
  }
}
