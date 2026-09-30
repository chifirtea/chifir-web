import type { ComponentType } from "react";
import type { AiEmployeePublic, InteriorTemplateId, Merchant, MerchantType, Product } from "@/types/domain";
import type { AABB } from "@/engine/physics/types";
import type { QualityTier } from "@/engine/canvas/quality";

export interface InteriorTemplateProps {
  merchant: Merchant;
  products: Product[];
  employee: AiEmployeePublic | null;
  quality: QualityTier;
}

/**
 * Interiors are rendered in their own isolated area (far from the street) so the street
 * geometry is unmounted while inside. Local space: origin at room centre, entrance at +Z.
 */
export interface InteriorTemplateDef {
  id: InteriorTemplateId;
  label: string;
  suitableFor: MerchantType[];
  room: { width: number; depth: number; height: number };
  /** Where the player appears when entering (local). */
  spawn: { x: number; z: number; yaw: number };
  /** Exit hotspot position (local); using it returns the player to the street door. */
  exit: { x: number; z: number };
  /** Where the AI employee stands (local). */
  employee: { x: number; z: number; yaw: number };
  /** Product display slots (local), filled in `products` order. */
  productSlots: Array<{ x: number; y: number; z: number; yaw: number }>;
  colliders: (origin: { x: number; z: number }) => AABB[];
  Component: ComponentType<InteriorTemplateProps>;
}

/**
 * Interiors live on a separate "layer" far from the street. Each merchant's interior is offset by
 * its parcel position so every interior has unique world coordinates (needed once other players
 * are visible) while staying well inside float precision.
 */
export const INTERIOR_LAYER_Z = 5000;

export function interiorOriginFor(parcel: { position: { x: number; z: number } }): { x: number; z: number } {
  return { x: parcel.position.x, z: INTERIOR_LAYER_Z + parcel.position.z };
}

export function isInteriorZ(z: number): boolean {
  return z > INTERIOR_LAYER_Z / 2;
}
