import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { getDataSource, type DataSource } from "@/lib/data";
import type { ChatRequestInput } from "@/lib/validation/ai";
import type { AiEmployee, Merchant } from "@/types/domain";
import type { ChatStreamEvent } from "./actions";
import { getLLMProvider } from "./anthropic";
import { locationLabel, runChat, summarizeCart } from "./chat";
import { employeeContextBlock, employeeSystemPrompt } from "./prompts";
import type { LLMProvider } from "./provider";
import { employeeTools, toProductFact } from "./tools";

export interface RunEmployeeInput {
  request: ChatRequestInput;
  /** Loaded by the route (404 when missing) so the route can answer before the stream opens. */
  merchant: Merchant;
  employee: AiEmployee;
  user: SessionUser | null;
  emit: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  /** Test seams. */
  ds?: DataSource;
  provider?: LLMProvider;
  now?: Date;
}

/**
 * One merchant-employee turn. The persona and the merchant's catalog live in the (cached) system
 * prompt; tools are pinned to this merchant; only the context keys the merchant allowed are shared.
 */
export async function runEmployee(input: RunEmployeeInput): Promise<void> {
  const ds = input.ds ?? getDataSource();
  const provider = input.provider ?? getLLMProvider();
  const now = input.now ?? new Date();
  const { merchant, employee } = input;
  const { context } = input.request;
  const [products, offers, cartSummary, location] = await Promise.all([
    ds.listProducts(merchant.id),
    ds.listOffers(merchant.id),
    summarizeCart(ds, context.cart.lines, now),
    locationLabel(ds, context.location),
  ]);
  const catalog = products.map((p) => toProductFact(p, merchant, offers, now));
  await runChat({
    scope: "employee",
    merchantId: merchant.id,
    request: input.request,
    user: input.user,
    emit: input.emit,
    ds,
    provider,
    now,
    ...(input.signal ? { signal: input.signal } : {}),
    system: [
      { text: employeeSystemPrompt(merchant, employee, catalog, offers), cache: true },
      { text: employeeContextBlock(context, employee, now, { cartSummary, locationLabel: location }) },
    ],
    tools: employeeTools,
  });
}
