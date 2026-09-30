import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import type { AiMessageRecord, CatalogSource, DataSource } from "@/lib/data/types";
import type { ChatRequestInput } from "@/lib/validation/ai";
import { computeTotals, defaultFulfillmentFor, lineKey, unitPriceCents } from "@/features/cart/pricing";
import { formatCents } from "@/lib/utils/money";
import type { CartLine, FulfillmentSelection, Merchant, Product } from "@/types/domain";
import type { ChatContext, ChatScope, ChatStreamEvent } from "./actions";
import { assertConversationOwner } from "./history";
import type { ChatTurn, LLMProvider, SystemBlock } from "./provider";
import type { AiTool, ToolContext } from "./tools";

/** Shared plumbing for the concierge and employee runs: context pricing, the provider call, persistence. */

export const MAX_OUTPUT_TOKENS = 700;

export interface RunChatInput {
  scope: ChatScope;
  request: ChatRequestInput;
  user: SessionUser | null;
  emit: (event: ChatStreamEvent) => void;
  system: SystemBlock[];
  tools: AiTool[];
  ds: DataSource;
  provider: LLMProvider;
  now: Date;
  merchantId?: string;
  signal?: AbortSignal;
}

export function toChatTurns(messages: ChatRequestInput["messages"]): ChatTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/** "inside Ember & Oak" / "on the street", resolved server-side from the id the client sent. */
export async function locationLabel(ds: CatalogSource, location: ChatContext["location"]): Promise<string> {
  if (location.kind === "street") return "on the street";
  const merchant = await ds.getMerchant(location.merchantId);
  return merchant ? `inside ${merchant.name} (merchant id ${merchant.id})` : "inside a store";
}

/**
 * Prices the client's cart line ids from the catalog. The client never sends prices; if it did we
 * would ignore them. Lines whose product needs a variant are listed but excluded from the subtotal.
 */
export async function summarizeCart(ds: CatalogSource, lines: ChatContext["cart"]["lines"], now: Date): Promise<string> {
  if (lines.length === 0) return "empty";
  const products = await ds.getProducts([...new Set(lines.map((l) => l.productId))]);
  const productsById: Record<string, Product | undefined> = Object.fromEntries(products.map((p) => [p.id, p]));
  const merchantIds = [...new Set(products.map((p) => p.merchantId))];
  const merchants = await Promise.all(merchantIds.map((id) => ds.getMerchant(id)));
  const merchantsById: Record<string, Merchant | undefined> = {};
  const fulfillment: FulfillmentSelection = {};
  merchantIds.forEach((id, i) => {
    const merchant = merchants[i] ?? undefined;
    merchantsById[id] = merchant;
    const type = defaultFulfillmentFor(merchant, products.filter((p) => p.merchantId === id));
    if (type) fulfillment[id] = type;
  });
  const cartLines: CartLine[] = [];
  const descriptions: string[] = [];
  for (const line of lines) {
    const product = productsById[line.productId];
    if (!product) continue;
    cartLines.push({ key: lineKey(product.id), productId: product.id, merchantId: product.merchantId, quantity: line.quantity, variantSelection: {} });
    descriptions.push(`${line.quantity}× ${product.title} (${merchantsById[product.merchantId]?.name ?? "unknown"}) ${formatCents(unitPriceCents(product), product.currency)}`);
  }
  if (cartLines.length === 0) return "empty (items no longer available)";
  const offers = (await Promise.all(merchantIds.map((id) => ds.listOffers(id)))).flat();
  const totals = computeTotals(cartLines, productsById, merchantsById, fulfillment, { offers, now });
  const itemCount = cartLines.reduce((n, l) => n + l.quantity, 0);
  const parts = [`${itemCount} item${itemCount === 1 ? "" : "s"}`, `subtotal ${formatCents(totals.subtotalCents, totals.currency)}`];
  if (totals.discountCents > 0) parts.push(`offers −${formatCents(totals.discountCents, totals.currency)}`);
  if (totals.problems.length) parts.push(`${totals.problems.length} line(s) still need a variant choice`);
  return `${parts.join(", ")}: ${descriptions.join("; ")}`;
}

const REFUSAL_MESSAGE = "I can't help with that one. Ask me about places, food, gifts or what's on tonight.";
const TRUNCATED_MESSAGE = "I ran out of room on that one. Ask again, maybe in smaller pieces.";

/** Runs one turn end to end and emits the protocol events. Resolves after `done` or `error`. */
export async function runChat(input: RunChatInput): Promise<void> {
  const { scope, request, user, emit, ds, provider, now } = input;
  const ctx: ToolContext = { ds, emit, now, scope, ...(input.merchantId ? { merchantId: input.merchantId } : {}) };
  const byName = new Map(input.tools.map((t) => [t.name, t]));

  const result = await provider.stream(
    {
      system: input.system,
      messages: toChatTurns(request.messages),
      tools: input.tools,
      maxTokens: MAX_OUTPUT_TOKENS,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    {
      onText: (delta) => emit({ type: "text", delta }),
      onToolCall: async (name, toolInput) => {
        const tool = byName.get(name);
        if (!tool) return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
        emit({ type: "tool", name, status: "start" });
        try {
          return await tool.execute(toolInput, ctx);
        } finally {
          emit({ type: "tool", name, status: "end" });
        }
      },
    },
  );

  if (result.stopReason === "refusal") {
    emit({ type: "error", code: "refused", message: REFUSAL_MESSAGE });
    return;
  }
  if (result.stopReason === "error") {
    const error = result.error ?? { code: "internal" as const, message: "Something went wrong on our side. Try again." };
    emit({ type: "error", code: error.code, message: error.message });
    return;
  }
  if (result.stopReason === "truncated" && !result.text.trim()) {
    emit({ type: "error", code: "internal", message: TRUNCATED_MESSAGE });
    return;
  }

  const conversationId = user
    ? await persistTurn({ ds, user, scope, request, assistantText: result.text, toolsUsed: result.toolsUsed, merchantId: input.merchantId })
    : undefined;
  emit({ type: "done", ...(conversationId ? { conversationId } : {}) });
}

interface PersistInput {
  ds: DataSource;
  user: SessionUser;
  scope: ChatScope;
  request: ChatRequestInput;
  assistantText: string;
  toolsUsed: string[];
  merchantId?: string;
}

/**
 * Signed-in users get a transcript. A client-supplied conversationId is honoured only when the
 * conversation belongs to the user; otherwise a new conversation is started with the full history
 * the client sent (so the transcript is complete from the first persisted turn).
 */
async function persistTurn(input: PersistInput): Promise<string | undefined> {
  const { ds, user, request } = input;
  let conversationId = request.conversationId;
  if (conversationId && !(await assertConversationOwner(conversationId, user.id))) conversationId = undefined;
  const lastUser = request.messages[request.messages.length - 1];
  const assistant: AiMessageRecord = {
    role: "assistant",
    content: input.assistantText,
    ...(input.toolsUsed.length ? { toolCalls: input.toolsUsed } : {}),
  };
  const messages: AiMessageRecord[] = conversationId
    ? [...(lastUser ? [{ role: lastUser.role, content: lastUser.content }] : []), assistant]
    : [...request.messages.map((m) => ({ role: m.role, content: m.content })), assistant];
  try {
    const saved = await ds.appendAiMessages({
      ...(conversationId ? { conversationId } : {}),
      userId: user.id,
      scope: input.scope,
      ...(input.merchantId ? { merchantId: input.merchantId } : {}),
      messages,
    });
    return saved.conversationId;
  } catch (err) {
    console.error("[ai] failed to persist conversation", err);
    return undefined;
  }
}
