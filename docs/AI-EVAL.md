# AI concierge eval

`pnpm ai:eval` runs the four CITY ALIVE v0.2 scenarios against the real concierge pipeline and
fails when the model invents a merchant, product, price or availability.

## What it runs

The script (`scripts/ai-eval.ts`) calls `runConcierge()` — the same function
`POST /api/ai/concierge` uses — in-process, with:

- `StaticDataSource` over the seed city (`src/data/seed`), built for **today 18:30 city time**
  (America/Chicago) so the Northline "Night Shift" drop is *tonight at 8 PM* and its hoodies are
  visible but not purchasable yet. Pass `--now=<ISO>` to rehearse another moment
  (`pnpm ai:eval --now=2026-09-30T20:30:00Z` runs with the drop live).
- the real `AnthropicProvider` (model from `AI_MODEL`, default `claude-opus-5-5`), wrapped so every
  tool call's input and output is recorded.

| # | User message | Hard assertions |
|---|---|---|
| 1 | "Spicy food under $25." | `search_products` called; at least one of Hellfire Burger / Pork Vindaloo Bowl / Spicy Miso Ramen is a card; a `recommend` action fires; a `highlight_storefront` or `navigate` points at Ember & Oak, Saffron Alley or Kōri Ramen |
| 2 | "We are two people, budget $60, something healthy." | Verde Bowl (or one of its bowls) is a card; `recommend` fires; `navigate`/`highlight_storefront` points at Verde Bowl. Warnings: picks total > $60 or serve fewer than 2 |
| 3 | "I need a black hoodie under $150." | `search_products` called; Meridian Hoodie is a card; `open_product` fires on the Meridian Hoodie; before 8 PM no `open_product`/`propose_cart` targets a Night Shift hoodie, and if the reply mentions Night Shift it says it drops at 8 PM and never calls it available now / in stock |
| 4 | "Take me somewhere popular." | `search_merchants` called with `sort: "popular"`; a teleport `navigate` targets the first result of that call (rating × log(review count), sponsored tiebreak) |

Guards applied to **every** scenario:

- every merchant/product id in cards and every id in actions exists in the snapshot (published
  merchants, active products, districts, parcels, events);
- every `$` amount in the reply equals a `*Cents` value some tool returned in that turn, or an
  amount the user typed (a budget), or (warning only) a sum of two or three returned prices;
- no "metaverse" / "virtual mall"; no empty reply; no `error` event.

Output: one block per scenario (tool calls with inputs, actions, reply, warnings, failures) and a
summary table. Exit codes: `0` all pass, `1` at least one hard failure, `2` not configured.

## Configuration

The eval needs the server-side model key:

```sh
ANTHROPIC_API_KEY=sk-ant-...   # required; optional AI_MODEL=claude-opus-5-5
```

Set it in the **deployment or shell environment**, or in `.env.local` (git-ignored, loaded with
`dotenv` like `scripts/seed.ts`). Never paste the key into chat, commit it, or expose it with a
`NEXT_PUBLIC_` prefix: the browser never talks to the model; only route handlers do.

Without the key the script prints `ANTHROPIC_API_KEY is not set.` and exits with code 2 (no stack
trace), so CI can distinguish "not configured" from "the model misbehaved".

The script runs under `tsx --conditions=react-server`, which resolves the `server-only` marker to
its empty build so the server modules load outside Next.js.

## Offline coverage (no key needed)

`pnpm test` covers the deterministic half of the same behaviour:

- `src/lib/ai/scenarios.test.ts`: the tool executors for the four scenarios against the seed
  (`availableFrom` / `purchasableNow` / `availabilityNote` exposure, the popular sort, the new
  `recommend`, `highlight_storefront`, `open_merchant`, `open_product` tools, id rejection);
- `src/lib/ai/validateAction.test.ts`: the client-side gate that drops actions naming ids that are
  not in the city index;
- `src/city/cityActions.test.ts`: `executeAIAction` for every action type against mocked stores;
- `src/lib/ai/concierge.test.ts`: the whole concierge pipeline driven by a scripted fake
  `LLMProvider` (system prompt carries the city map, tools run, cards/actions/done are emitted,
  refusals surface as a friendly error).
