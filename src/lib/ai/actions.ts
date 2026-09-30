import type { DietaryTag, Id, MerchantCard, NavTarget, ProductCard } from "@/types/domain";

/**
 * Actions the AI may *propose*. The client executes them through the same action bus the HUD
 * uses (`src/city/cityActions.ts`). The AI never mutates client state directly.
 */
export type AIAction =
  | { type: "navigate"; target: NavTarget; mode: "teleport" | "guide"; label: string }
  | { type: "propose_cart"; items: Array<{ productId: Id; quantity: number; variantSelection?: Record<string, string> }>; note?: string }
  | { type: "escalate"; merchantId: Id; reason: string };

export type ChatScope = "concierge" | "employee";

export interface ChatContext {
  location: { kind: "street" } | { kind: "interior"; merchantId: Id };
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
