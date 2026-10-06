import type { District, MerchantDraft } from "@/types/domain";
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

export interface PlacementsResponse {
  districts: District[];
  parcels: PlacementOption[];
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
