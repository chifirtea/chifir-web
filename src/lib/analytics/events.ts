import type { Id } from "@/types/domain";

/**
 * Product analytics catalog. Every event has a typed payload; `track()` refuses unknown names
 * at compile time. Server-side events (webhook) use the same names.
 */
export interface AnalyticsEventMap {
  app_loaded: { path: string };
  city_load_started: Record<string, never>;
  city_load_completed: { ms: number };
  city_interactive: { ms: number };
  session_heartbeat: { seconds: number; location: "street" | "interior" };
  district_entered: { districtId: Id };
  store_entered: { merchantId: Id; via: "door" | "teleport" | "deep_link" };
  store_exited: { merchantId: Id; seconds: number };
  product_inspected: { productId: Id; merchantId: Id; source: "interior" | "ai" | "panel" };
  ai_message_sent: { scope: "concierge" | "employee"; merchantId?: Id; chars: number };
  ai_response_received: {
    scope: "concierge" | "employee";
    merchantId?: Id;
    ms: number;
    tools: string[];
    ok: boolean;
  };
  ai_action_executed: { action: string; accepted: boolean };
  cart_item_added: { productId: Id; merchantId: Id; quantity: number; source: "panel" | "ai" };
  cart_item_removed: { productId: Id };
  checkout_initiated: { totalCents: number; lines: number; merchants: number; provider: "stripe" | "demo" };
  purchase_completed: {
    orderId: Id;
    totalCents: number;
    discountCents: number;
    lines: number;
    merchants: number;
    merchantIds: Id[];
    productIds: Id[];
    provider: "stripe" | "demo";
  };
  event_viewed: { eventId: Id };
  event_participated: { eventId: Id; kind: "present" | "ticket_purchased" | "offer_redeemed"; seconds?: number };
  teleport: { targetKind: string; source: "ai" | "hud" | "deep_link" };
  waypoint_set: { targetKind: string; source: "ai" | "hud" };
  perf_sample: { fps: number; dpr: number; tier: "low" | "medium" | "high"; drawCalls?: number };
  error_client: { message: string; stack?: string; where?: string };
  signup: { method: "password" | "magic_link" };
  login: { method: "password" | "magic_link" };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export interface AnalyticsRecord<N extends AnalyticsEventName = AnalyticsEventName> {
  name: N;
  props: AnalyticsEventMap[N];
  /** Client timestamp (ms since epoch). */
  ts: number;
  sessionId: string;
  anonymousId: string;
  userId?: Id;
  device?: {
    mobile: boolean;
    tier?: "low" | "medium" | "high";
    gpu?: string;
    ua?: string;
  };
}

export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = [
  "app_loaded",
  "city_load_started",
  "city_load_completed",
  "city_interactive",
  "session_heartbeat",
  "district_entered",
  "store_entered",
  "store_exited",
  "product_inspected",
  "ai_message_sent",
  "ai_response_received",
  "ai_action_executed",
  "cart_item_added",
  "cart_item_removed",
  "checkout_initiated",
  "purchase_completed",
  "event_viewed",
  "event_participated",
  "teleport",
  "waypoint_set",
  "perf_sample",
  "error_client",
  "signup",
  "login",
] as const;
