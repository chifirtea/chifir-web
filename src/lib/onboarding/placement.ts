import type {
  District,
  InteriorTemplateId,
  MerchantType,
  Parcel,
  ParcelTier,
  StorefrontTemplateId,
} from "@/types/domain";

/**
 * Placement rules for generated merchants. The storefront/interior template registries live in
 * `"use client"` modules (they carry React/three components), so route handlers and server
 * components cannot read them. This is a data mirror of each template's `label`, `suitableFor`
 * and `suitableTiers`; `placement.test.ts` asserts it matches the real registries and that
 * `placementProblem` agrees with `validatePlacement` for every template × type × parcel.
 *
 * Pure module (no `server-only`): the admin UI reuses the same rules for its selects.
 */

export interface StorefrontRule {
  id: StorefrontTemplateId;
  label: string;
  suitableFor: readonly MerchantType[];
  suitableTiers: readonly ParcelTier[];
}

export interface InteriorRule {
  id: InteriorTemplateId;
  label: string;
  suitableFor: readonly MerchantType[];
}

export const STOREFRONT_RULES: Record<StorefrontTemplateId, StorefrontRule> = {
  bistro: { id: "bistro", label: "Bistro", suitableFor: ["restaurant", "popup"], suitableTiers: ["standard", "corner"] },
  "fast-casual": {
    id: "fast-casual",
    label: "Fast casual",
    suitableFor: ["restaurant", "popup"],
    suitableTiers: ["standard", "corner"],
  },
  cafe: { id: "cafe", label: "Cafe", suitableFor: ["restaurant", "service", "popup"], suitableTiers: ["standard", "corner"] },
  boutique: {
    id: "boutique",
    label: "Boutique",
    suitableFor: ["retail", "service", "popup"],
    suitableTiers: ["standard", "corner"],
  },
  flagship: {
    id: "flagship",
    label: "Flagship",
    suitableFor: ["retail", "venue", "popup", "service"],
    suitableTiers: ["flagship", "venue", "corner"],
  },
  kiosk: {
    id: "kiosk",
    label: "Kiosk",
    suitableFor: ["popup", "retail", "restaurant", "service"],
    suitableTiers: ["kiosk"],
  },
  popup: {
    id: "popup",
    label: "Pop-up",
    suitableFor: ["retail", "popup", "service", "venue"],
    suitableTiers: ["standard", "corner", "kiosk"],
  },
};

export const INTERIOR_RULES: Record<InteriorTemplateId, InteriorRule> = {
  "restaurant-counter": { id: "restaurant-counter", label: "Counter service", suitableFor: ["restaurant", "popup"] },
  "restaurant-dining": { id: "restaurant-dining", label: "Dining room", suitableFor: ["restaurant", "venue"] },
  "retail-racks": { id: "retail-racks", label: "Racks", suitableFor: ["retail", "popup", "service"] },
  "retail-gallery": { id: "retail-gallery", label: "Gallery", suitableFor: ["retail", "venue", "popup", "service"] },
  "popup-gallery": { id: "popup-gallery", label: "Pop-up gallery", suitableFor: ["retail", "popup", "venue"] },
};

export const STOREFRONT_RULE_LIST = Object.values(STOREFRONT_RULES);
export const INTERIOR_RULE_LIST = Object.values(INTERIOR_RULES);

/** Sensible starting templates per merchant type; the reviewer can change them. */
export function defaultTemplates(type: MerchantType): { storefront: StorefrontTemplateId; interior: InteriorTemplateId } {
  switch (type) {
    case "restaurant":
      return { storefront: "bistro", interior: "restaurant-dining" };
    case "retail":
      return { storefront: "boutique", interior: "retail-racks" };
    case "service":
      return { storefront: "cafe", interior: "retail-gallery" };
    case "venue":
      return { storefront: "flagship", interior: "retail-gallery" };
    case "popup":
      return { storefront: "popup", interior: "popup-gallery" };
  }
}

export function storefrontTemplatesFor(type: MerchantType): StorefrontRule[] {
  return STOREFRONT_RULE_LIST.filter((r) => r.suitableFor.includes(type));
}

export function interiorTemplatesFor(type: MerchantType): InteriorRule[] {
  return INTERIOR_RULE_LIST.filter((r) => r.suitableFor.includes(type));
}

/** A lot a new store can take: available, no tenant, not a billboard. */
export function isFreeParcel(parcel: Parcel): boolean {
  return parcel.status === "available" && !parcel.merchantId && parcel.tier !== "billboard";
}

export function freeParcels(parcels: readonly Parcel[], districtId?: string): Parcel[] {
  return parcels.filter((p) => isFreeParcel(p) && (!districtId || p.districtId === districtId));
}

/**
 * Same checks as `validatePlacement` in `engine/storefront/types.ts` (type and tier suitability).
 * Footprints are derived from the parcel by every procedural template, so they always fit.
 */
export function placementProblem(
  template: StorefrontTemplateId,
  merchantType: MerchantType,
  parcel: Pick<Parcel, "tier">,
): string | null {
  const rule = STOREFRONT_RULES[template];
  if (!rule.suitableFor.includes(merchantType)) {
    return `Template "${template}" does not suit merchant type "${merchantType}".`;
  }
  if (!rule.suitableTiers.includes(parcel.tier)) {
    return `Template "${template}" does not fit parcel tier "${parcel.tier}".`;
  }
  return null;
}

export interface PlacementOption {
  parcel: Parcel;
  fits: boolean;
  problem: string | null;
}

export function placementOptions(
  parcels: readonly Parcel[],
  merchant: { merchantType: MerchantType; storefrontTemplate: StorefrontTemplateId },
  districtId?: string,
): PlacementOption[] {
  return freeParcels(parcels, districtId).map((parcel) => {
    const problem = placementProblem(merchant.storefrontTemplate, merchant.merchantType, parcel);
    return { parcel, fits: problem === null, problem };
  });
}

const DISTRICT_BY_NAMESPACE: Record<string, string> = {
  food: "food-street",
  drink: "food-street",
  fashion: "fashion-street",
  beauty: "fashion-street",
};

/**
 * food.* → Food Street, fashion.* → Fashion Street, else the plaza kiosk, else any district with
 * a free lot. Only districts that still have a free parcel are suggested.
 */
export function suggestDistrict(
  category: string,
  districts: readonly District[],
  parcels: readonly Parcel[],
): District | undefined {
  const withFree = (slug: string) =>
    districts.find((d) => d.slug === slug && freeParcels(parcels, d.id).length > 0);
  const namespace = category.split(".")[0] ?? "";
  const preferred = DISTRICT_BY_NAMESPACE[namespace];
  return (
    (preferred ? withFree(preferred) : undefined) ??
    withFree("central-plaza") ??
    [...districts].sort((a, b) => a.sortOrder - b.sortOrder).find((d) => freeParcels(parcels, d.id).length > 0)
  );
}
