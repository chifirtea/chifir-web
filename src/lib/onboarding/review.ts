import type { MerchantDraft, Parcel } from "@/types/domain";
import type { MerchantDraftInput } from "@/lib/data/types";
import {
  canTransition,
  merchantProposalSchema,
  normalizeProposal,
  proposalProblems,
  type DraftPatch,
} from "@/lib/validation/merchantDraft";
import { isFreeParcel, placementProblem } from "./placement";

/**
 * Applies a reviewer's edit to a draft (ADR-007). Pure so the rules are unit-tested without Next:
 * status transitions, placement checks, and the approval gate (placement on a free, fitting
 * parcel, at least one product, the whole proposal re-validated, a slug no live merchant uses).
 * Any edit moves an `extracted` draft into review; editing an approved draft reopens it unless the
 * same request approves it again.
 */

export type PatchOutcome =
  | { ok: true; next: MerchantDraftInput }
  | { ok: false; status: 400 | 409 | 422; error: string; problems?: string[] };

export function applyDraftPatch(
  draft: MerchantDraft,
  patch: DraftPatch,
  ctx: { parcels: readonly Parcel[]; merchantSlugs?: ReadonlySet<string> },
): PatchOutcome {
  if (draft.status === "published") {
    return { ok: false, status: 409, error: "This draft was published and can no longer be edited." };
  }
  const edits = patch.proposal !== undefined || patch.placement !== undefined;
  const proposal = patch.proposal ? normalizeProposal(patch.proposal) : draft.proposal;

  let placement = draft.placement;
  if (patch.placement === null) placement = undefined;
  else if (patch.placement) {
    const parcel = ctx.parcels.find((p) => p.id === patch.placement?.parcelId);
    if (!parcel) return { ok: false, status: 400, error: "That parcel does not exist." };
    if (parcel.districtId !== patch.placement.districtId) {
      return { ok: false, status: 400, error: "That parcel is not in the chosen district." };
    }
    if (!isFreeParcel(parcel)) return { ok: false, status: 409, error: "That parcel is no longer free." };
    placement = patch.placement;
  }

  const requested = patch.status;
  if (requested && !canTransition(draft.status, requested)) {
    const from = label(draft.status);
    return { ok: false, status: 409, error: `${/^[aeiou]/.test(from) ? "An" : "A"} ${from} draft cannot become ${label(requested)}.` };
  }
  const reopened = edits && (draft.status === "approved" || draft.status === "extracted");
  const status = requested ?? (reopened ? "in_review" : draft.status);

  if (status === "approved") {
    const parsed = merchantProposalSchema.safeParse(proposal);
    if (!parsed.success) {
      return {
        ok: false,
        status: 422,
        error: "The proposal is not valid.",
        problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "proposal"}: ${i.message}`),
      };
    }
    const problems = proposalProblems(parsed.data);
    if (ctx.merchantSlugs?.has(parsed.data.merchant.slug)) {
      problems.push(`The slug "${parsed.data.merchant.slug}" is already used by a merchant in the city.`);
    }
    if (!placement) problems.push("Choose a district and a parcel.");
    else {
      const parcel = ctx.parcels.find((p) => p.id === placement?.parcelId);
      if (!parcel || !isFreeParcel(parcel)) problems.push("The chosen parcel is no longer free.");
      else {
        const fit = placementProblem(parsed.data.merchant.storefrontTemplate, parsed.data.merchant.merchantType, parcel);
        if (fit) problems.push(fit);
      }
    }
    if (problems.length) return { ok: false, status: 422, error: "Not ready to approve.", problems };
  }

  // Spread without the optional fields this patch may clear, so `placement: null` sticks.
  const { placement: _oldPlacement, reviewerNotes: _oldNotes, ...rest } = draft;
  void _oldPlacement;
  void _oldNotes;
  return {
    ok: true,
    next: {
      ...rest,
      proposal,
      status,
      ...(placement ? { placement } : {}),
      ...(patch.reviewerNotes !== undefined
        ? { reviewerNotes: patch.reviewerNotes }
        : draft.reviewerNotes !== undefined
          ? { reviewerNotes: draft.reviewerNotes }
          : {}),
    },
  };
}

function label(status: MerchantDraft["status"]): string {
  return status.replace("_", " ");
}
