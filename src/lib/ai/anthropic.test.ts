import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AnthropicProvider,
  FALLBACK_BETA,
  MAX_TOOL_ITERATIONS,
  isToolInputParseError,
  mapError,
  type StreamingClient,
} from "./anthropic";
import { compileToolSchema, defineTool, stripNulls, type ToolDef } from "./provider";

vi.mock("server-only", () => ({}));

type BetaMessage = Anthropic.Beta.BetaMessage;
type StreamParams = Parameters<StreamingClient["beta"]["messages"]["stream"]>[0];

// ------------------------------------------------------------------------------ fake client

function message(content: unknown[], stop_reason: BetaMessage["stop_reason"]): BetaMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

const text = (t: string) => ({ type: "text", text: t });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

type Scripted = BetaMessage | Error;

/** Replays scripted responses; text blocks are streamed in two deltas before finalMessage resolves. */
function fakeClient(script: Scripted[]) {
  const calls: StreamParams[] = [];
  const client: StreamingClient = {
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const next = script.shift();
          if (!next) throw new Error("fake client: script exhausted");
          const listeners: Array<(delta: string, snapshot: string) => void> = [];
          return {
            on(event, listener) {
              if (event === "text") listeners.push(listener);
              return this;
            },
            async finalMessage() {
              if (next instanceof Error) {
                // Simulate text streamed before the failure (as the SDK does with eager input).
                for (const l of listeners) l("partial ", "partial ");
                throw next;
              }
              for (const block of next.content) {
                if (block.type !== "text") continue;
                const half = Math.ceil(block.text.length / 2);
                let snapshot = "";
                for (const delta of [block.text.slice(0, half), block.text.slice(half)]) {
                  if (!delta) continue;
                  snapshot += delta;
                  for (const l of listeners) l(delta, snapshot);
                }
              }
              return next;
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

const echoTool: ToolDef = defineTool({
  name: "echo",
  description: "Echoes",
  schema: z.object({ q: z.string().max(10), n: z.number().int().optional() }),
  execute: async (input: { q: string; n?: number }) => JSON.stringify({ got: input }),
});

function run(script: Scripted[], tools: ToolDef[] = [echoTool]) {
  const { client, calls } = fakeClient(script);
  const provider = new AnthropicProvider(client, "claude-opus-5-5");
  const deltas: string[] = [];
  const toolCalls: Array<{ name: string; input: unknown; id: string }> = [];
  const result = provider.stream(
    {
      system: [{ text: "STABLE", cache: true }, { text: "volatile" }],
      messages: [{ role: "user", content: "hi" }],
      tools,
      maxTokens: 700,
    },
    {
      onText: (d) => deltas.push(d),
      onToolCall: async (name, input, id) => {
        toolCalls.push({ name, input, id });
        const tool = tools.find((t) => t.name === name)!;
        return tool.execute(input, undefined);
      },
    },
  );
  return { result, calls, deltas, toolCalls };
}

// ------------------------------------------------------------------------------ schema compile

describe("compileToolSchema (strict mode)", () => {
  const schema = z.object({
    query: z.string().max(120).describe("Free text"),
    limit: z.number().int().min(1).max(8).optional(),
    kind: z.enum(["a", "b"]).optional(),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("merchant"), merchantId: z.string() }),
      z.object({ kind: z.literal("district"), districtId: z.string() }),
    ]),
    items: z.array(z.object({ id: z.string(), qty: z.number().int().min(1).max(10), note: z.string().optional() })).max(8),
    flag: z.boolean().nullable().optional(),
  });
  const compiled = compileToolSchema(schema);

  it("lists every property as required and makes optional ones nullable", () => {
    expect(compiled.required).toEqual(["query", "limit", "kind", "target", "items", "flag"]);
    const props = compiled.properties as Record<string, Record<string, unknown>>;
    expect(props.query!.type).toBe("string");
    expect(props.limit!.type).toEqual(["integer", "null"]);
    expect(props.kind).toEqual({ anyOf: [{ type: "string", enum: ["a", "b"] }, { type: "null" }] });
    expect(props.flag!.type).toEqual(["boolean", "null"]);
  });

  it("uses anyOf (not oneOf), forbids additional properties everywhere and keeps const/enum", () => {
    const props = compiled.properties as Record<string, Record<string, unknown>>;
    const target = props.target!;
    expect(target.oneOf).toBeUndefined();
    const variants = target.anyOf as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    for (const v of variants) {
      expect(v.additionalProperties).toBe(false);
      expect(v.required).toEqual(["kind", expect.any(String)]);
      expect((v.properties as Record<string, Record<string, unknown>>).kind!.const).toBeDefined();
    }
    const items = props.items!.items as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["id", "qty", "note"]);
    expect(compiled.additionalProperties).toBe(false);
    expect(compiled.$schema).toBeUndefined();
  });

  it("moves numeric/length constraints into descriptions so the model still sees them", () => {
    const props = compiled.properties as Record<string, Record<string, unknown>>;
    expect(props.query!.maxLength).toBeUndefined();
    expect(props.query!.description).toBe("Free text Constraints: maxLength: 120.");
    expect(props.limit!.minimum).toBeUndefined();
    expect(String(props.limit!.description)).toContain("maximum: 8");
    expect(props.items!.maxItems).toBeUndefined();
  });

  it("rejects records (maps) because strict mode cannot express them", () => {
    expect(() => compileToolSchema(z.object({ sel: z.record(z.string(), z.string()) }))).toThrow(/records/);
  });

  it("stripNulls removes nulls recursively so .optional() schemas validate", () => {
    expect(stripNulls({ a: null, b: 1, c: { d: null, e: [null, { f: null, g: 2 }] } })).toEqual({ b: 1, c: { e: [null, { g: 2 }] } });
  });
});

// ------------------------------------------------------------------------------ request shape

describe("AnthropicProvider request", () => {
  it("sends strict eager tools, low effort, auto tool choice, cached system block and default fallbacks", async () => {
    const { result, calls } = run([message([text("Hello there")], "end_turn")]);
    await result;
    const params = calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(700);
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(params.fallbacks).toBe("default");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params.system).toEqual([
      { type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
      { type: "text", text: "volatile" },
    ]);
    const tool = (params.tools as Anthropic.Beta.BetaTool[])[0]!;
    expect(tool).toMatchObject({ name: "echo", strict: true, eager_input_streaming: true });
    expect(tool.input_schema.additionalProperties).toBe(false);
    expect(tool.input_schema.required).toEqual(["q", "n"]);
  });
});

// ------------------------------------------------------------------------------ loop

describe("AnthropicProvider loop", () => {
  it("streams text and ends on end_turn", async () => {
    const { result, deltas } = run([message([text("Hello there")], "end_turn")]);
    const r = await result;
    expect(r.stopReason).toBe("end");
    expect(r.text).toBe("Hello there");
    expect(deltas.join("")).toBe("Hello there");
    expect(r.toolsUsed).toEqual([]);
    expect(r.usage).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 50 });
  });

  it("runs validated tools, feeds results back in one user message and continues", async () => {
    const { result, calls, toolCalls } = run([
      message([text("Looking. "), toolUse("tu_1", "echo", { q: "hi", n: null })], "tool_use"),
      message([text("Done.")], "end_turn"),
    ]);
    const r = await result;
    expect(r.stopReason).toBe("end");
    expect(r.text).toBe("Looking. Done.");
    expect(r.toolsUsed).toEqual(["echo"]);
    expect(toolCalls).toEqual([{ name: "echo", input: { q: "hi" }, id: "tu_1" }]);
    const second = calls[1]!.messages;
    expect(second).toHaveLength(3);
    expect(second[1]!.role).toBe("assistant");
    expect(second[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: JSON.stringify({ got: { q: "hi" } }) }],
    });
    expect(r.usage?.requests).toBe(2);
  });

  it("returns INVALID_JSON tool_results for inputs that fail the Zod schema without executing them", async () => {
    const { result, calls, toolCalls } = run([
      message([toolUse("tu_1", "echo", { q: "way too long for the cap" }), toolUse("tu_2", "nope", {})], "tool_use"),
      message([text("ok")], "end_turn"),
    ]);
    const r = await result;
    expect(r.stopReason).toBe("end");
    expect(toolCalls).toHaveLength(0);
    expect(r.toolsUsed).toEqual([]);
    const results = calls[1]!.messages[2]!.content as Array<Record<string, unknown>>;
    expect(results[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      is_error: true,
      content: JSON.stringify({ INVALID_JSON: JSON.stringify({ q: "way too long for the cap" }) }),
    });
    expect(results[1]).toMatchObject({ tool_use_id: "tu_2", is_error: true });
  });

  it("stops on refusal and never runs that turn's tools", async () => {
    const { result, toolCalls, calls } = run([message([toolUse("tu_1", "echo", { q: "hi" })], "refusal")]);
    const r = await result;
    expect(r.stopReason).toBe("refusal");
    expect(toolCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("stops on max_tokens with a pending tool_use (truncated)", async () => {
    const { result, toolCalls } = run([message([text("Let me "), toolUse("tu_1", "echo", { q: "hi" })], "max_tokens")]);
    const r = await result;
    expect(r.stopReason).toBe("truncated");
    expect(r.text).toBe("Let me ");
    expect(toolCalls).toHaveLength(0);
  });

  it("continues after pause_turn by echoing the assistant content", async () => {
    const { result, calls } = run([message([text("a")], "pause_turn"), message([text("b")], "end_turn")]);
    const r = await result;
    expect(r.stopReason).toBe("end");
    expect(r.text).toBe("ab");
    expect(calls[1]!.messages).toHaveLength(2);
    expect(calls[1]!.messages[1]!.role).toBe("assistant");
  });

  it("caps the loop at 4 tool rounds", async () => {
    const script: Scripted[] = [];
    for (let i = 0; i < MAX_TOOL_ITERATIONS + 1; i++) script.push(message([toolUse(`tu_${i}`, "echo", { q: "x" })], "tool_use"));
    const { result, toolCalls, calls } = run(script);
    const r = await result;
    expect(r.stopReason).toBe("truncated");
    expect(toolCalls).toHaveLength(MAX_TOOL_ITERATIONS);
    expect(calls).toHaveLength(MAX_TOOL_ITERATIONS + 1);
  });

  it("turns executor exceptions into error tool_results and keeps going", async () => {
    const boom: ToolDef = defineTool({
      name: "boom",
      description: "fails",
      schema: z.object({}),
      execute: async () => {
        throw new Error("db down");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, calls } = run([message([toolUse("tu_1", "boom", {})], "tool_use"), message([text("sorry")], "end_turn")], [boom]);
    const r = await result;
    spy.mockRestore();
    expect(r.stopReason).toBe("end");
    const results = calls[1]!.messages[2]!.content as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ tool_use_id: "tu_1", is_error: true });
  });
});

// ------------------------------------------------------------------------------ errors & retries

const parseError = () => new Anthropic.AnthropicError("Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: x. JSON: {");

describe("AnthropicProvider errors", () => {
  it("retries a tool-input JSON parse failure at most twice, without duplicating streamed text", async () => {
    const { result, deltas, calls } = run([parseError(), parseError(), message([text("partial text")], "end_turn")]);
    const r = await result;
    expect(r.stopReason).toBe("end");
    expect(calls).toHaveLength(3);
    // "partial " streamed during attempt 1 is not re-sent; only the new tail of attempt 3 is.
    expect(deltas.join("")).toBe("partial text");
    expect(r.text).toBe("partial text");
    expect(r.usage?.requests).toBe(3);
  });

  it("gives up after two retries", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, calls } = run([parseError(), parseError(), parseError()]);
    const r = await result;
    spy.mockRestore();
    expect(r.stopReason).toBe("error");
    expect(r.error?.code).toBe("internal");
    expect(calls).toHaveLength(3);
  });

  it("maps typed SDK errors to protocol codes (connection before generic API error)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = new Headers();
    expect(mapError(new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow" } }, "slow", headers)).code).toBe("rate_limited");
    expect(mapError(new Anthropic.APIConnectionError({ message: "offline" })).code).toBe("unavailable");
    expect(mapError(new Anthropic.AuthenticationError(401, {}, "bad key", headers)).code).toBe("unavailable");
    expect(mapError(new Anthropic.BadRequestError(400, {}, "bad", headers)).code).toBe("unavailable");
    expect(mapError(new Anthropic.NotFoundError(404, {}, "no model", headers)).code).toBe("unavailable");
    expect(mapError(new Anthropic.InternalServerError(500, {}, "oops", headers)).code).toBe("unavailable");
    expect(mapError(new Error("random")).code).toBe("internal");
    expect(mapError(new Anthropic.APIUserAbortError()).code).toBe("internal");
    spy.mockRestore();
  });

  it("does not retry API errors and surfaces them as an error result", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Anthropic.RateLimitError(429, {}, "slow", new Headers());
    const { result, calls } = run([err, message([text("never")], "end_turn")]);
    const r = await result;
    spy.mockRestore();
    expect(r.stopReason).toBe("error");
    expect(r.error?.code).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  it("only recognises the SDK's tool-input parse error as retryable", () => {
    expect(isToolInputParseError(parseError())).toBe(true);
    expect(isToolInputParseError(new Anthropic.AnthropicError("stream ended without producing a Message"))).toBe(false);
    expect(isToolInputParseError(new Anthropic.BadRequestError(400, {}, "Unable to parse tool parameter JSON", new Headers()))).toBe(false);
  });
});
