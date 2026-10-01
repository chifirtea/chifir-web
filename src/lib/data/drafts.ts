import type { AiEmployee, Merchant, MerchantDraft, Parcel, Product } from "@/types/domain";

/**
 * Turns an approved draft into catalog rows. Shared by both DataSources so the static prototype
 * and the database publish exactly the same thing.
 */
export interface PublishedMerchantRows {
  merchant: Merchant;
  products: Product[];
  employee: AiEmployee;
  parcel: Parcel;
}

export function draftPublishProblem(
  draft: MerchantDraft,
  parcel: Parcel | undefined,
): string | null {
  if (draft.status === "published") return "This draft was already published.";
  if (draft.status !== "approved")
    return "A reviewer must approve the draft before it can be published.";
  if (!draft.placement) return "Choose a district and parcel before publishing.";
  if (!parcel) return "The chosen parcel no longer exists.";
  if (parcel.districtId !== draft.placement.districtId)
    return "The chosen parcel is not in the chosen district.";
  if (parcel.tier === "billboard") return "A billboard parcel cannot host a store.";
  if (parcel.merchantId) return "The chosen parcel is already occupied.";
  if (draft.proposal.products.length === 0) return "Add at least one product before publishing.";
  return null;
}

export function rowsFromDraft(
  draft: MerchantDraft,
  parcel: Parcel,
  ids: { merchantId: string; employeeId: string; productId: (index: number) => string },
  nowIso: string,
): PublishedMerchantRows {
  const merchant: Merchant = {
    ...draft.proposal.merchant,
    id: ids.merchantId,
    status: "published",
    ratingCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const products: Product[] = draft.proposal.products.map((p, i) => ({
    ...p,
    id: ids.productId(i),
    merchantId: merchant.id,
    sortOrder: p.sortOrder ?? i,
  }));
  const employee: AiEmployee = {
    ...draft.proposal.employee,
    id: ids.employeeId,
    merchantId: merchant.id,
  };
  const occupied: Parcel = { ...parcel, status: "occupied", merchantId: merchant.id };
  return { merchant, products, employee, parcel: occupied };
}
