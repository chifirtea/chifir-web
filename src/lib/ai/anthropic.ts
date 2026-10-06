import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { features, serverEnv } from "@/lib/env.server";
import {
  compileToolSchema,
  stripNulls,
  type LLMProvider,
  type StreamHandlers,
  type StreamParams,
  type StreamResult,
  type StreamStopReason,
  type StreamUsage,
  type ToolDef,
  type ToolResultPayload,
} from "./provider";

/**
 * `LLMProvider` over the official Anthropic SDK (ADR-004).
 *
 * - Streaming manual tool loop: `client.beta.messages.stream()` + `finalMessage()` per round.
 * - Thinking is always on for this model family; depth is controlled with `output_config.effort`.
 * - Tools are `strict` with `eager_input_streaming`, so every parsed input is re-validated with
 *   the tool's Zod schema before it runs (the API does not coerce/validate eagerly streamed input).
 * - Server-side refusal fallbacks are on by default (`fallbacks: "default"` under the
 *   `server-side-fallback-2026-07-01` beta); `fallback` content blocks are ignored for display.
 * - Stop rules: `refusal` and `max_tokens` are terminal (tools from that turn never run),
 *   `pause_turn` continues, at most 4 tool rounds, only tool-input JSON parse failures are retried.
 */

export const MAX_TOOL_ITERATIONS = 4;
export const MAX_PARSE_RETRIES = 2;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaTool = Anthropic.Beta.BetaTool;
type BetaToolResultBlockParam = Anthropic.Beta.BetaToolResultBlockParam;
type BetaToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type BetaStreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** The slice of the SDK client the provider needs; tests inject a fake. */
export interface StreamHandle {
  on(event: "text", listener: (textDelta: string, textSnapshot: string) => void): unknown;
  finalMessage(): Promise<BetaMessage>;
}

export interface StreamingClient {
  beta: {
    messages: {
      stream(params: BetaStreamParams, options?: { signal?: AbortSignal | null }): StreamHandle;
    };
  };
}

interface TurnState {
  text: string;
  toolsUsed: string[];
  usage: StreamUsage;
}

export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly client: StreamingClient,
    private readonly model: string = serverEnv.AI_MODEL,
  ) {}

  /** Provider-specific tool definition: strict schema + eager input streaming. */
  compileTool(tool: ToolDef): BetaTool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: compileToolSchema(tool.schema) as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
      eager_input_streaming: true,
    };
  }

  async stream(params: StreamParams, handlers: StreamHandlers): Promise<StreamResult> {
    const toolDefs = params.tools as ToolDef[];
    const byName = new Map(toolDefs.map((t) => [t.name, t]));
    const tools = toolDefs.map((t) => this.compileTool(t));
    const system = params.system.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    const messages: BetaMessageParam[] = params.messages.map((m) => ({ role: m.role, content: m.content }));
    const state: TurnState = {
      text: "",
      toolsUsed: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, requests: 0 },
    };
    const finish = (stopReason: StreamStopReason): StreamResult => ({
      text: state.text,
      stopReason,
      toolsUsed: state.toolsUsed,
      usage: state.usage,
    });

    try {
      for (let round = 0; ; round++) {
        const message = await this.request(
          { system, messages, tools, maxTokens: params.maxTokens, signal: params.signal },
          handlers.onText,
          state,
        );
        const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");

        if (message.stop_reason === "refusal") return finish("refusal");
        // Truncated turns are terminal: a cut-off tool_use must never run.
        if (message.stop_reason === "max_tokens") return finish("truncated");
        if (message.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: message.content });
          if (round >= MAX_TOOL_ITERATIONS) return finish("truncated");
          continue;
        }
        if (message.stop_reason !== "tool_use" || toolUses.length === 0) return finish("end");
        if (round >= MAX_TOOL_ITERATIONS) return finish("truncated");

        messages.push({ role: "assistant", content: message.content });
        const results = await Promise.all(toolUses.map((use) => this.runTool(use, byName, handlers, state)));
        messages.push({ role: "user", content: results });
      }
    } catch (err) {
      return { ...finish("error"), error: mapError(err) };
    }
  }

  private async request(
    req: {
      system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
      messages: BetaMessageParam[];
      tools: BetaTool[];
      maxTokens: number;
      signal?: AbortSignal;
    },
    onText: (delta: string) => void,
    state: TurnState,
  ): Promise<BetaMessage> {
    // Text already forwarded to the client for this request; a retry only forwards what is new.
    let forwarded = 0;
    for (let attempt = 0; ; attempt++) {
      let attemptTotal = 0;
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          tools: req.tools,
          tool_choice: { type: "auto" },
          output_config: { effort: "low" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      stream.on("text", (delta) => {
        attemptTotal += delta.length;
        if (attemptTotal <= forwarded) return;
        const fresh = delta.slice(delta.length - (attemptTotal - forwarded));
        forwarded = attemptTotal;
        state.text += fresh;
        onText(fresh);
      });
      try {
        const message = await stream.finalMessage();
        state.usage.requests += 1;
        state.usage.inputTokens += message.usage.input_tokens;
        state.usage.outputTokens += message.usage.output_tokens;
        state.usage.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0;
        state.usage.cacheCreationInputTokens += message.usage.cache_creation_input_tokens ?? 0;
        return message;
      } catch (err) {
        state.usage.requests += 1;
        if (isToolInputParseError(err) && attempt < MAX_PARSE_RETRIES) continue;
        throw err;
      }
    }
  }

  private async runTool(
    use: BetaToolUseBlock,
    byName: Map<string, ToolDef>,
    handlers: StreamHandlers,
    state: TurnState,
  ): Promise<BetaToolResultBlockParam> {
    const tool = byName.get(use.name);
    if (!tool) {
      return { type: "tool_result", tool_use_id: use.id, is_error: true, content: JSON.stringify({ error: `Unknown tool ${use.name}` }) };
    }
    // Eagerly streamed input is not validated by the API: parse -> strip nulls -> Zod.
    const parsed = tool.schema.safeParse(stripNulls(use.input));
    if (!parsed.success) {
      return {
        type: "tool_result",
        tool_use_id: use.id,
        is_error: true,
        content: JSON.stringify({ INVALID_JSON: JSON.stringify(use.input) }),
      };
    }
    state.toolsUsed.push(use.name);
    let payload: ToolResultPayload;
    try {
      payload = await handlers.onToolCall(use.name, parsed.data, use.id);
    } catch (err) {
      console.error(`[ai] tool ${use.name} failed`, err);
      payload = { content: JSON.stringify({ error: "Tool failed. Tell the user you could not check that right now." }), isError: true };
    }
    return {
      type: "tool_result",
      tool_use_id: use.id,
      content: payload.content,
      ...(payload.isError ? { is_error: true } : {}),
    };
  }
}

/** The SDK surfaces unparseable eagerly-streamed tool JSON as a plain AnthropicError from finalMessage(). */
export function isToolInputParseError(err: unknown): boolean {
  return (
    err instanceof Anthropic.AnthropicError &&
    !(err instanceof Anthropic.APIError) &&
    /unable to parse tool parameter json/i.test(err.message)
  );
}

/** Typed SDK errors -> protocol codes. Most specific first; connection errors subclass APIError. */
export function mapError(err: unknown): NonNullable<StreamResult["error"]> {
  if (err instanceof Anthropic.RateLimitError) {
    return { code: "rate_limited", message: "The city is busy right now. Give it a moment and try again." };
  }
  if (err instanceof Anthropic.APIUserAbortError) {
    return { code: "internal", message: "Stopped." };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    console.error("[ai] connection error", err.message);
    return { code: "unavailable", message: "The concierge could not be reached. Try again in a moment." };
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.BadRequestError ||
    err instanceof Anthropic.NotFoundError
  ) {
    console.error(`[ai] ${err.constructor.name} ${err.status}: ${err.message}`);
    return { code: "unavailable", message: "The concierge is not available right now." };
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`[ai] API error ${err.status ?? "?"}: ${err.message}`);
    return { code: "unavailable", message: "The concierge is having trouble right now. Try again shortly." };
  }
  console.error("[ai] unexpected error", err);
  return { code: "internal", message: "Something went wrong on our side. Try again." };
}

let instance: AnthropicProvider | null = null;

/** Process-wide provider. Throws when the AI feature is off (routes check `features.ai` first). */
export function getLLMProvider(): LLMProvider {
  if (!features.ai) throw new Error("AI is not configured: ANTHROPIC_API_KEY is missing.");
  if (!instance) {
    instance = new AnthropicProvider(new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY }), serverEnv.AI_MODEL);
  }
  return instance;
}
