import type { DietaryTag, Id, MerchantCard, NavTarget, ProductCard } from "@/types/domain";

/**
 * Actions the AI may *propose*. The client executes them through the same action bus the HUD
 * uses (`src/city/cityActions.ts`). The AI never mutates client state directly.
 */
export type AIAction =
  | { type: "navigate"; target: NavTarget; mode: "teleport" | "guide"; label: string }
  | {
      type: "propose_cart";
      items: Array<{ productId: Id; quantity: number; variantSelection?: Record<string, string> }>;
      note?: string;
    }
  | { type: "escalate"; merchantId: Id; reason: string }
  /** Pulse a ring + beacon at the merchant's door. `parcelId` is the storefront the server resolved. */
  | { type: "highlight_storefront"; merchantId: Id; parcelId?: Id; label: string; reason?: string }
  /** Open the merchant overview sheet. */
  | { type: "open_merchant"; merchantId: Id }
  /** Open the product sign. */
  | { type: "open_product"; productId: Id }
  /** Ids the AI recommends (cards travel separately); the client only validates and labels them. */
  | { type: "recommend"; productIds: Id[]; merchantIds: Id[]; reason?: string };

export type AIActionType = AIAction["type"];

/**
 * Client policy: which actions run the moment they arrive. Teleports keep a one-tap confirm chip
 * (the user decides when the world moves); everything else is a panel, a highlight or cart math
 * that the server already validated.
 */
export function autoExecutes(action: AIAction): boolean {
  switch (action.type) {
    case "navigate":
      return action.mode === "guide";
    case "escalate":
      return false;
    default:
      return true;
  }
}

export type ChatScope = "concierge" | "employee";

export interface ChatContext {
  location: { kind: "street" } | { kind: "interior"; merchantId: Id; parcelId?: Id };
  /** Line ids only; the server prices them from the catalog. */
  cart: { lines: Array<{ productId: Id; quantity: number }> };
  /** ISO local time string of the user, e.g. "2026-09-30T19:12:00-07:00". */
  localTime?: string;
  preferences?: {
    dietary?: DietaryTag[];
    budgetCents?: number;
    occasion?: string;
    partySize?: number;
  };
}

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
  context: ChatContext;
  /** Required for the employee route. */
  merchantId?: Id;
  conversationId?: Id;
}

/** Server -> client stream protocol (one JSON object per SSE `data:` line). */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "cards"; merchants?: MerchantCard[]; products?: ProductCard[] }
  | { type: "action"; action: AIAction }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "done"; conversationId?: Id }
  | {
      type: "error";
      code: "rate_limited" | "unavailable" | "refused" | "bad_request" | "internal";
      message: string;
    };
