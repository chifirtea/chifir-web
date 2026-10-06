# ADR-004: Official Anthropic SDK behind a thin LLMProvider interface

**Status:** accepted

## Context
The product needs an AI concierge and per-merchant employees that never invent prices or
inventory, stream to the UI, and can be swapped to another model provider.

## Decision
`lib/ai/provider.ts` defines `LLMProvider` (stream a turn with typed tools, return text deltas
and tool calls). `AnthropicProvider` implements it with `@anthropic-ai/sdk` using a streaming
manual tool loop. Tools are defined once (Zod schema + executor) and compiled to provider
schemas. All facts come from tool results over `DataSource`.

## Consequences
- Adding a provider = one new file implementing `LLMProvider`.
- Tool inputs are validated before execution; refusals and truncations are terminal, not retried.
- Prompt caching applies to the stable system prompt + tool list (kept first, deterministic order).
