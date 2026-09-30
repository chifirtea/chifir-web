import type { Order } from "@/types/domain";

/**
 * Client-safe commerce contracts. This file imports nothing server-only, so client components
 * (order status, checkout sheet) can share the exact shapes the routes return.
 */

/** An order as it leaves the server: the guest access token hash never ships. */
export type PublicOrder = Omit<Order, "accessTokenHash">;

export interface CheckoutProblem {
  /** Cart line key (`lineKey(productId, variantSelection)`), or a merchant id for fulfillment issues. */
  key: string;
  reason: string;
}

/** `POST /api/checkout` success body. */
export interface CheckoutResponse {
  /** Where to send the browser: Stripe Checkout, the demo payment page, or the order page for free orders. */
  url: string;
  orderId: string;
  /** Present and true when the simulated payment path is used. */
  demo?: boolean;
  /** Present and true when nothing was owed and the order completed immediately. */
  free?: boolean;
}

/** Error body shared by every commerce route. */
export interface CommerceErrorResponse {
  error: string;
  problems?: CheckoutProblem[];
  issues?: unknown;
}

export interface OrderResponse {
  order: PublicOrder;
}

export interface ClaimResponse {
  claimed: boolean;
}

export interface DemoPayResponse {
  ok: true;
  orderId: string;
}
