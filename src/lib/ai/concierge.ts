import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { getDataSource, type DataSource } from "@/lib/data";
import type { ChatRequestInput } from "@/lib/validation/ai";
import type { ChatStreamEvent } from "./actions";
import { getLLMProvider } from "./anthropic";
import { locationLabel, runChat, summarizeCart } from "./chat";
import { conciergeContextBlock, conciergeSystemPrompt } from "./prompts";
import type { LLMProvider } from "./provider";
import { conciergeTools } from "./tools";

export interface RunConciergeInput {
  request: ChatRequestInput;
  user: SessionUser | null;
  emit: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  /** Test seams. */
  ds?: DataSource;
  provider?: LLMProvider;
  now?: Date;
}

/**
 * One concierge turn: stable system prompt (cached) + volatile session block, the city-wide tool
 * set, streaming events, optional persistence. Resolves once `done` or `error` was emitted.
 */
export async function runConcierge(input: RunConciergeInput): Promise<void> {
  const ds = input.ds ?? getDataSource();
  const provider = input.provider ?? getLLMProvider();
  const now = input.now ?? new Date();
  const { context } = input.request;
  const [cartSummary, location] = await Promise.all([
    summarizeCart(ds, context.cart.lines, now),
    locationLabel(ds, context.location),
  ]);
  await runChat({
    scope: "concierge",
    request: input.request,
    user: input.user,
    emit: input.emit,
    ds,
    provider,
    now,
    ...(input.signal ? { signal: input.signal } : {}),
    system: [
      { text: conciergeSystemPrompt(), cache: true },
      { text: conciergeContextBlock(context, now, { cartSummary, locationLabel: location }) },
    ],
    tools: conciergeTools,
  });
}
