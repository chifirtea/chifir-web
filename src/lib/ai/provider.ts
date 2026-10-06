import { z } from "zod";

/**
 * Provider-agnostic LLM contract (ADR-004). Concierge/employee code talks to `LLMProvider`;
 * `AnthropicProvider` is the only implementation today. Tools are defined once with a Zod schema
 * and an executor; each provider compiles the schema into its own wire format.
 *
 * This module is intentionally free of SDK and `server-only` imports so its pure pieces (schema
 * compilation, null stripping) can be unit-tested and reused by any provider.
 */

export interface SystemBlock {
  text: string;
  /** Mark this block as a prompt-cache breakpoint (stable content only, never timestamps). */
  cache?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolResultPayload {
  /** Compact JSON string (or short text). Keep it under ~6 KB. */
  content: string;
  isError?: boolean;
}

export interface ToolDef<TCtx = unknown> {
  name: string;
  description: string;
  /** Validated against the parsed tool input before `execute` runs (strict mode or not). */
  schema: z.ZodObject;
  execute: (input: unknown, ctx: TCtx) => Promise<ToolResultPayload>;
}

export interface DefineToolInput<S extends z.ZodObject, TCtx> {
  name: string;
  description: string;
  schema: S;
  execute: (input: z.output<S>, ctx: TCtx) => Promise<ToolResultPayload | string>;
}

/** Typed tool author API. The provider validates with `schema` before `execute` is reached. */
export function defineTool<S extends z.ZodObject, TCtx>(def: DefineToolInput<S, TCtx>): ToolDef<TCtx> {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    execute: async (input, ctx) => {
      const out = await def.execute(input as z.output<S>, ctx);
      return typeof out === "string" ? { content: out } : out;
    },
  };
}

export interface StreamParams {
  system: SystemBlock[];
  messages: ChatTurn[];
  tools: ToolDef<never>[] | ToolDef[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onText: (delta: string) => void;
  /** Runs one validated tool call. Throwing is converted into an error tool_result. */
  onToolCall: (name: string, input: unknown, id: string) => Promise<ToolResultPayload>;
}

export type StreamStopReason = "end" | "refusal" | "truncated" | "error";

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** API round trips made for this turn (1 + tool iterations + retries). */
  requests: number;
}

export interface StreamResult {
  text: string;
  stopReason: StreamStopReason;
  toolsUsed: string[];
  usage?: StreamUsage;
  /** Present when `stopReason === "error"`. Codes match `ChatStreamEvent["code"]`. */
  error?: { code: "rate_limited" | "unavailable" | "internal"; message: string };
}

export interface LLMProvider {
  stream(params: StreamParams, handlers: StreamHandlers): Promise<StreamResult>;
}

// ---------------------------------------------------------------------------------------------
// Zod -> strict JSON schema
// ---------------------------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;

/**
 * Compiles a Zod object schema into a JSON schema that satisfies "strict" tool-use requirements:
 * every object has `additionalProperties: false` and lists *every* property in `required`
 * (optional properties become nullable); `oneOf` becomes `anyOf`; unsupported constraints
 * (min/max, lengths, patterns) are moved into the description so the model still sees them while
 * Zod remains the enforcer at runtime. Records/maps are rejected: express them as arrays of pairs.
 */
export function compileToolSchema(schema: z.ZodObject): JsonSchema {
  const raw = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  const out = strictify(raw);
  if (out.type !== "object") throw new Error("Tool schemas must be objects");
  return out;
}

const HINT_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
] as const;

function strictify(node: JsonSchema): JsonSchema {
  const src: JsonSchema = { ...node };
  delete src.$schema;
  delete src.id;
  delete src.$id;
  delete src.title;
  delete src.propertyNames;

  const out: JsonSchema = {};
  const hints: string[] = [];
  for (const key of HINT_KEYS) {
    if (src[key] !== undefined) {
      hints.push(`${key}: ${JSON.stringify(src[key])}`);
      delete src[key];
    }
  }

  const variants = (src.anyOf ?? src.oneOf) as JsonSchema[] | undefined;
  if (Array.isArray(variants)) {
    out.anyOf = variants.map(strictify);
  } else if (Array.isArray(src.allOf)) {
    out.allOf = (src.allOf as JsonSchema[]).map(strictify);
  } else if (src.type !== undefined) {
    out.type = src.type;
  } else if (src.const === undefined && src.enum === undefined) {
    // z.unknown()/z.any(): the model may send anything; keep it explicit for the API.
    out.type = ["string", "number", "boolean", "object", "array", "null"];
  }
  if (src.const !== undefined) out.const = src.const;
  if (src.enum !== undefined) out.enum = src.enum;

  if (src.type === "object") {
    const properties = (src.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((src.required as string[] | undefined) ?? []);
    if (src.additionalProperties && typeof src.additionalProperties === "object") {
      throw new Error("Strict tool schemas cannot use records/maps; use an array of { key, value } objects.");
    }
    const compiled: Record<string, JsonSchema> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const strict = strictify(prop);
      compiled[key] = required.has(key) ? strict : nullable(strict);
    }
    out.properties = compiled;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  } else if (src.type === "array") {
    if (src.items && typeof src.items === "object") {
      out.items = strictify(src.items as JsonSchema);
    } else if (Array.isArray(src.prefixItems)) {
      out.items = { anyOf: (src.prefixItems as JsonSchema[]).map(strictify) };
    }
  }

  const description = [src.description as string | undefined, hints.length ? `Constraints: ${hints.join(", ")}.` : undefined]
    .filter(Boolean)
    .join(" ");
  if (description) out.description = description;
  return out;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema.anyOf)) {
    const list = schema.anyOf as JsonSchema[];
    if (list.some((v) => v.type === "null")) return schema;
    return { ...schema, anyOf: [...list, { type: "null" }] };
  }
  if (typeof schema.type === "string") {
    if (schema.type === "null") return schema;
    if (schema.enum !== undefined || schema.const !== undefined) {
      const { description, ...rest } = schema;
      return { anyOf: [rest, { type: "null" }], ...(description ? { description } : {}) };
    }
    return { ...schema, type: [schema.type, "null"] };
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type as string[];
    return types.includes("null") ? schema : { ...schema, type: [...types, "null"] };
  }
  const { description, ...rest } = schema;
  return { anyOf: [rest, { type: "null" }], ...(description ? { description } : {}) };
}

/**
 * Strict schemas make optional properties nullable, so the model sends `null` for "omitted".
 * Our Zod schemas use `.optional()`, therefore nulls are stripped (recursively) before validation.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}
