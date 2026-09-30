import type { ComponentType } from "react";
import type { Merchant, MerchantType, Parcel, ParcelTier, StorefrontTemplateId } from "@/types/domain";
import type { AABB } from "@/engine/physics/types";
import type { QualityTier } from "@/engine/canvas/quality";

export interface StorefrontTemplateProps {
  merchant: Merchant;
  parcel: Parcel;
  quality: QualityTier;
  /** 0 = full detail, 1 = reduced, 2 = silhouette. */
  lod: 0 | 1 | 2;
}

/**
 * Contract every storefront template fulfils. Local space: origin at the parcel centre,
 * the front façade at +Z (toward the street), Y up, metres.
 */
export interface StorefrontTemplateDef {
  id: StorefrontTemplateId;
  label: string;
  suitableFor: MerchantType[];
  /** Parcel tiers this template fits; used by placement validation and future onboarding. */
  suitableTiers: ParcelTier[];
  /** Distances (metres) at which the renderer switches to lod 1 and lod 2, before `lodScale`. */
  lodDistances: [number, number];
  /** Asset URLs to preload for a quality tier (empty for procedural templates). */
  assets?: (quality: QualityTier) => string[];
  /** Building footprint inside the parcel (may be smaller than the parcel). */
  footprint: (parcel: Parcel) => { width: number; depth: number; height: number };
  /** Door position in local space on the front façade. */
  doorOffset: (parcel: Parcel) => { x: number; z: number };
  /** World-space blocking volumes for this template on this parcel. */
  colliders: (parcel: Parcel) => AABB[];
  Component: ComponentType<StorefrontTemplateProps>;
}

/** Applies parcel rotation + translation to a local XZ offset. */
export function localToWorld(parcel: Parcel, local: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(parcel.rotationY);
  const s = Math.sin(parcel.rotationY);
  // Rotation about +Y: x' = x cos + z sin ; z' = -x sin + z cos
  return {
    x: parcel.position.x + local.x * c + local.z * s,
    z: parcel.position.z - local.x * s + local.z * c,
  };
}

/** Whether a merchant/template can be placed on a parcel. Used by the seed script and onboarding. */
export function validatePlacement(def: StorefrontTemplateDef, merchant: Merchant, parcel: Parcel): string | null {
  if (!def.suitableFor.includes(merchant.merchantType)) {
    return `Template "${def.id}" does not suit merchant type "${merchant.merchantType}".`;
  }
  if (!def.suitableTiers.includes(parcel.tier)) {
    return `Template "${def.id}" does not fit parcel tier "${parcel.tier}".`;
  }
  const fp = def.footprint(parcel);
  if (fp.width > parcel.size.width + 0.01 || fp.depth > parcel.size.depth + 0.01) {
    return `Template "${def.id}" footprint exceeds parcel "${parcel.slug}".`;
  }
  return null;
}

/** The pose a player should stand in, just outside the door, facing the door. */
export function doorPose(parcel: Parcel, def: StorefrontTemplateDef): { x: number; z: number; yaw: number } {
  const door = def.doorOffset(parcel);
  const outside = localToWorld(parcel, { x: door.x, z: door.z + 2.2 });
  // Facing "into" the store means facing local -Z, i.e. world yaw = rotationY + PI.
  return { x: outside.x, z: outside.z, yaw: parcel.rotationY + Math.PI };
}
