import type { District, MerchantDraft, Parcel } from "@/types/domain";
import type { PlacementOption } from "./placement";

/**
 * Wire shapes of the admin API, shared by the route handlers and the admin UI. Types only: this
 * module is client-safe.
 */

export interface AdminErrorResponse {
  error: string;
  code?: string;
  issues?: unknown;
  problems?: string[];
}

export interface DraftResponse {
  draft: MerchantDraft;
}

export interface DraftListResponse {
  drafts: MerchantDraft[];
}

/** Just enough of an occupied or reserved lot to draw it on the placement map. */
export type ParcelOutline = Pick<Parcel, "id" | "districtId" | "slug" | "position" | "rotationY" | "size" | "tier">;

export interface PlacementsResponse {
  districts: District[];
  /** Free lots, each flagged with whether the draft's stored template fits it. */
  parcels: PlacementOption[];
  /** Every other lot (tenanted, reserved, billboards), for context on the map. */
  taken: ParcelOutline[];
  suggestedDistrictId?: string;
}

export interface PublishResponse {
  merchantId: string;
  slug: string;
  /** Deep link that lands in front of the new storefront. */
  cityUrl: string;
}

export interface SessionResponse {
  ok: true;
  /** False when no token is configured (admin is open on this deployment). */
  required: boolean;
}
