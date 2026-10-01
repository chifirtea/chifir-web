/**
 * Live evaluation of the city concierge against the four CITY ALIVE scenarios.
 *
 *   pnpm ai:eval                      # today at 18:30 city time (the drop is "tonight 8 PM")
 *   pnpm ai:eval --now=2026-09-30T20:30:00Z   # rehearse another moment (drop live)
 *
 * Runs the same `runConcierge()` the route handler uses, in-process, against the seed data
 * (`StaticDataSource`) and the real Anthropic provider. Needs `ANTHROPIC_API_KEY` in the
 * environment or `.env.local` (see docs/AI-EVAL.md). Exit codes: 0 all scenarios pass,
 * 1 at least one hard assertion failed, 2 the key is not configured.
 *
 * Executed with `tsx --conditions=react-server` so the `server-only` marker resolves to its
 * empty build outside Next.js (the data layer and the AI modules import it).
 */
import { config as loadEnv } from "dotenv";
import type { AIAction, ChatStreamEvent } from "../src/lib/ai/actions";
import type { LLMProvider } from "../src/lib/ai/provider";
import type { CitySnapshot } from "../src/lib/data/types";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const EXIT_FAIL = 1;
const EXIT_NOT_CONFIGURED = 2;
const SCENARIO_TIMEOUT_MS = 120_000;

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error(
    [
      "ANTHROPIC_API_KEY is not set.",
      "",
      "The AI eval calls the real model, so it needs the server-side key. Set it in the",
      "deployment or shell environment (or in .env.local, which is git-ignored):",
      "",
      "  ANTHROPIC_API_KEY=sk-ant-... pnpm ai:eval",
      "",
      "Never paste the key into chat, commits or client code. See docs/AI-EVAL.md.",
    ].join("\n"),
  );
  process.exit(EXIT_NOT_CONFIGURED);
}

// ------------------------------------------------------------------------------------ types

interface ToolCall {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

interface Turn {
  text: string;
  events: ChatStreamEvent[];
  calls: ToolCall[];
  actions: AIAction[];
  merchantCardIds: string[];
  productCardIds: string[];
  error?: string;
  ms: number;
}

interface Verdict {
  failures: string[];
  warnings: string[];
}

interface Scenario {
  name: string;
  message: string;
  check: (turn: Turn, ctx: EvalContext) => Verdict;
}

type EvalContextWithMessage = EvalContext & { userMessageFor: (turn: Turn) => string };

interface EvalContext {
  snapshot: CitySnapshot;
  now: Date;
  ids: {
    merchants: Set<string>;
    products: Set<string>;
    districts: Set<string>;
    parcels: Set<string>;
    events: Set<string>;
  };
  priceOf: Map<string, number>;
  servesOf: Map<string, number>;
  merchantOf: Map<string, string>;
  titleOf: Map<string, string>;
  nightShiftUpcoming: boolean;
}

// ------------------------------------------------------------------------------------ helpers

function parseNowArg(argv: string[]): Date | null {
  const arg = argv.find((a) => a.startsWith("--now="));
  if (!arg) return null;
  const t = Date.parse(arg.slice("--now=".length));
  if (Number.isNaN(t)) {
    console.error(`Unparseable --now value: ${arg}`);
    process.exit(EXIT_FAIL);
  }
  return new Date(t);
}

/** Every integer under a key ending in "Cents" anywhere in a tool result. */
function collectCents(value: unknown, into: Set<number>, prices: number[], key = ""): void {
  if (Array.isArray(value)) {
    for (const v of value) collectCents(v, into, prices, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) collectCents(v, into, prices, k);
    return;
  }
  if (typeof value === "number" && Number.isInteger(value) && key.endsWith("Cents")) {
    into.add(value);
    if (["priceCents", "unitPriceAfterCents", "unitPriceCents", "lineTotalCents"].includes(key)) prices.push(value);
  }
}

/** "$14.50", "$1,200", "$9" → cents. */
function dollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of text.matchAll(re)) {
    const whole = Number(m[1]!.replace(/,/g, ""));
    const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    out.push(whole * 100 + frac);
  }
  return out;
}

/** Sums of two or three returned prices (a "two bowls for $27" total) and doubles ("2× $13.50"). */
function derivedTotals(prices: number[]): Set<number> {
  const unique = [...new Set(prices)].slice(0, 40);
  const out = new Set<number>();
  for (let i = 0; i < unique.length; i++) {
    out.add(unique[i]! * 2);
    out.add(unique[i]! * 3);
    for (let j = i; j < unique.length; j++) {
      out.add(unique[i]! + unique[j]!);
      for (let k = j; k < unique.length; k++) out.add(unique[i]! + unique[j]! + unique[k]!);
    }
  }
  return out;
}

function actionIds(action: AIAction): Array<{ kind: keyof EvalContext["ids"]; id: string }> {
  switch (action.type) {
    case "navigate": {
      const t = action.target;
      if (t.kind === "merchant") return [{ kind: "merchants", id: t.merchantId }];
      if (t.kind === "district") return [{ kind: "districts", id: t.districtId }];
      if (t.kind === "parcel") return [{ kind: "parcels", id: t.parcelId }];
      if (t.kind === "event") return [{ kind: "events", id: t.eventId }];
      return [];
    }
    case "propose_cart":
      return action.items.map((i) => ({ kind: "products" as const, id: i.productId }));
    case "escalate":
    case "open_merchant":
      return [{ kind: "merchants", id: action.merchantId }];
    case "highlight_storefront":
      return [{ kind: "merchants", id: action.merchantId }, ...(action.parcelId ? [{ kind: "parcels" as const, id: action.parcelId }] : [])];
    case "open_product":
      return [{ kind: "products", id: action.productId }];
    case "recommend":
      return [
        ...action.productIds.map((id) => ({ kind: "products" as const, id })),
        ...action.merchantIds.map((id) => ({ kind: "merchants" as const, id })),
      ];
  }
}

/** Hard guards that apply to every scenario: real ids only, real prices only, no banned words. */
function hallucinationGuards(turn: Turn, ctx: EvalContextWithMessage): Verdict {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const id of turn.merchantCardIds) if (!ctx.ids.merchants.has(id)) failures.push(`merchant card with unknown id ${id}`);
  for (const id of turn.productCardIds) if (!ctx.ids.products.has(id)) failures.push(`product card with unknown id ${id}`);
  for (const action of turn.actions) {
    for (const ref of actionIds(action)) {
      if (!ctx.ids[ref.kind].has(ref.id)) failures.push(`${action.type} references unknown ${ref.kind.slice(0, -1)} ${ref.id}`);
    }
  }
  const returnedCents = new Set<number>();
  const prices: number[] = [];
  for (const call of turn.calls) {
    try {
      collectCents(JSON.parse(call.output), returnedCents, prices);
    } catch {
      // Plain-text tool results (navigate) carry no prices.
    }
  }
  const derived = derivedTotals(prices);
  const stated = new Set(dollarAmounts(ctx.userMessageFor(turn)));
  for (const cents of dollarAmounts(turn.text)) {
    if (returnedCents.has(cents) || stated.has(cents)) continue;
    if (derived.has(cents)) {
      warnings.push(`$${(cents / 100).toFixed(2)} is not a tool-returned price (accepted as a sum of returned prices)`);
      continue;
    }
    failures.push(`$${(cents / 100).toFixed(2)} appears in the reply but no tool returned it this turn`);
  }
  if (/metaverse|virtual mall/i.test(turn.text)) failures.push("reply uses a banned word (metaverse / virtual mall)");
  if (turn.error) failures.push(`turn ended with error: ${turn.error}`);
  if (!turn.text.trim()) failures.push("empty reply");
  return { failures, warnings };
}

// ------------------------------------------------------------------------------------ main

async function main(): Promise<void> {
  const [{ runConcierge }, { StaticDataSource }, { buildCitySnapshot }, { getLLMProvider }, seedTime, { sid }, { NIGHT_SHIFT_SLUGS }] =
    await Promise.all([
      import("../src/lib/ai/concierge"),
      import("../src/lib/data/static"),
      import("../src/data/seed"),
      import("../src/lib/ai/anthropic"),
      import("../src/data/seed/time"),
      import("../src/data/seed/ids"),
      import("../src/data/seed/products"),
    ]);

  const now = parseNowArg(process.argv) ?? seedTime.todayAt(seedTime.CITY_TZ, 18, 30, new Date());
  const snapshot = buildCitySnapshot(now);
  const drop = seedTime.dropWindow(now);

  /** The static source filters offers by the wall clock; pin it to the eval clock. */
  class EvalSource extends StaticDataSource {
    override async listOffers(merchantId?: string) {
      const t = now.getTime();
      return snapshot.offers.filter(
        (o) => o.active && (!merchantId || o.merchantId === merchantId) && Date.parse(o.startsAt) <= t && Date.parse(o.endsAt) >= t,
      );
    }
  }
  const ds = new EvalSource(snapshot);
  const real = getLLMProvider();

  const published = snapshot.merchants.filter((m) => m.status === "published");
  const active = snapshot.products.filter((p) => p.active);
  const ids = {
    merchants: new Set(published.map((m) => m.id)),
    products: new Set(active.map((p) => p.id)),
    districts: new Set(snapshot.districts.map((d) => d.id)),
    parcels: new Set(snapshot.parcels.map((p) => p.id)),
    events: new Set(snapshot.events.map((e) => e.id)),
  };
  const nightShiftIds = NIGHT_SHIFT_SLUGS.map((slug) => sid.product("northline-supply", slug));
  const messageByTurn = new WeakMap<Turn, string>();
  const ctx: EvalContextWithMessage = {
    snapshot,
    now,
    ids,
    priceOf: new Map(active.map((p) => [p.id, p.priceCents])),
    servesOf: new Map(active.map((p) => [p.id, p.attributes.serves ?? 1])),
    merchantOf: new Map(active.map((p) => [p.id, p.merchantId])),
    titleOf: new Map(active.map((p) => [p.id, p.title])),
    nightShiftUpcoming: now.getTime() < drop.start.getTime(),
    userMessageFor: (turn) => messageByTurn.get(turn) ?? "",
  };

  const EMBER = sid.merchant("ember-and-oak");
  const SAFFRON = sid.merchant("saffron-alley");
  const KORI = sid.merchant("kori-ramen");
  const VERDE = sid.merchant("verde-bowl");
  const HELLFIRE = sid.product("ember-and-oak", "hellfire-burger");
  const VINDALOO = sid.product("saffron-alley", "vindaloo-bowl");
  const SPICY_MISO = sid.product("kori-ramen", "spicy-miso");
  const MERIDIAN = sid.product("northline-supply", "meridian-hoodie");

  const toolInput = <T = Record<string, unknown>>(turn: Turn, name: string): T | undefined =>
    turn.calls.find((c) => c.name === name)?.input as T | undefined;
  const navTargets = (turn: Turn, mode?: "teleport" | "guide") =>
    turn.actions
      .filter((a): a is Extract<AIAction, { type: "navigate" }> => a.type === "navigate" && (!mode || a.mode === mode))
      .map((a) => a.target);
  const pointsAt = (turn: Turn, merchantIds: string[]) =>
    turn.actions.some(
      (a) =>
        (a.type === "highlight_storefront" && merchantIds.includes(a.merchantId)) ||
        (a.type === "navigate" && a.target.kind === "merchant" && merchantIds.includes(a.target.merchantId)),
    );
  const recommended = (turn: Turn) =>
    turn.actions.filter((a): a is Extract<AIAction, { type: "recommend" }> => a.type === "recommend").flatMap((a) => a.productIds);

  const scenarios: Scenario[] = [
    {
      name: "1 spicy under $25",
      message: "Spicy food under $25.",
      check: (turn) => {
        const failures: string[] = [];
        const warnings: string[] = [];
        const input = toolInput(turn, "search_products");
        if (!input) failures.push("search_products was not called");
        else {
          if (input.maxPriceCents !== 2500) warnings.push(`search_products.maxPriceCents = ${String(input.maxPriceCents)} (expected 2500)`);
          if ((input.minSpiceLevel as number | undefined) === undefined) warnings.push("search_products.minSpiceLevel not set");
        }
        const expectedProducts = [HELLFIRE, VINDALOO, SPICY_MISO];
        if (!expectedProducts.some((id) => turn.productCardIds.includes(id))) {
          failures.push("none of Hellfire Burger / Pork Vindaloo Bowl / Spicy Miso Ramen appeared as a card");
        }
        if (!turn.actions.some((a) => a.type === "recommend")) failures.push("no recommend action");
        else if (!recommended(turn).some((id) => expectedProducts.includes(id))) warnings.push("recommend did not include one of the three expected products");
        if (!pointsAt(turn, [EMBER, SAFFRON, KORI])) failures.push("no highlight_storefront / navigate to Ember & Oak, Saffron Alley or Kōri Ramen");
        return { failures, warnings };
      },
    },
    {
      name: "2 two people, $60, healthy",
      message: "We are two people, budget $60, something healthy.",
      check: (turn) => {
        const failures: string[] = [];
        const warnings: string[] = [];
        const verdeShown = turn.merchantCardIds.includes(VERDE) || turn.productCardIds.some((id) => ctx.merchantOf.get(id) === VERDE);
        if (!verdeShown) failures.push("Verde Bowl (or one of its bowls) did not appear as a card");
        const picks = recommended(turn);
        if (!turn.actions.some((a) => a.type === "recommend")) failures.push("no recommend action");
        else if (!picks.some((id) => ctx.merchantOf.get(id) === VERDE)) warnings.push("recommend did not include a Verde Bowl product");
        if (!pointsAt(turn, [VERDE])) failures.push("no navigate / highlight_storefront to Verde Bowl");
        const total = picks.reduce((n, id) => n + (ctx.priceOf.get(id) ?? 0), 0);
        const serves = picks.reduce((n, id) => n + (ctx.servesOf.get(id) ?? 1), 0);
        if (picks.length && total > 6000) warnings.push(`recommended set totals $${(total / 100).toFixed(2)} (> $60)`);
        if (picks.length && serves < 2) warnings.push(`recommended set serves ${serves} (< 2)`);
        return { failures, warnings };
      },
    },
    {
      name: "3 black hoodie under $150",
      message: "I need a black hoodie under $150.",
      check: (turn) => {
        const failures: string[] = [];
        const warnings: string[] = [];
        if (!toolInput(turn, "search_products")) failures.push("search_products was not called");
        if (!turn.productCardIds.includes(MERIDIAN)) failures.push("Meridian Hoodie did not appear as a card");
        const opened = turn.actions.filter((a): a is Extract<AIAction, { type: "open_product" }> => a.type === "open_product");
        if (!opened.some((a) => a.productId === MERIDIAN)) failures.push("open_product was not called on the Meridian Hoodie");
        if (ctx.nightShiftUpcoming) {
          for (const a of turn.actions) {
            if (a.type === "open_product" && nightShiftIds.includes(a.productId)) failures.push("open_product on a Night Shift hoodie that is not purchasable yet");
            if (a.type === "propose_cart" && a.items.some((i) => nightShiftIds.includes(i.productId))) failures.push("propose_cart on a Night Shift hoodie before the drop");
          }
          const mentionsNightShift = /night\s*shift/i.test(turn.text);
          if (mentionsNightShift) {
            if (!/\b8(?::00)?\s?(?:pm|p\.m\.)\b/i.test(turn.text)) failures.push("mentions Night Shift without saying it drops at 8 PM");
            const sentences = turn.text.split(/(?<=[.!?])\s+/);
            for (const s of sentences) {
              if (/night\s*shift/i.test(s) && /\b(available now|in stock|ready to (order|ship)|can (get|buy|order) (it|them|one) now)\b/i.test(s)) {
                failures.push(`describes Night Shift as available now: "${s.trim()}"`);
              }
            }
          } else {
            warnings.push("reply does not mention the Night Shift drop (optional, but the founder scenario expects it)");
          }
        }
        return { failures, warnings };
      },
    },
    {
      name: "4 somewhere popular",
      message: "Take me somewhere popular.",
      check: (turn) => {
        const failures: string[] = [];
        const warnings: string[] = [];
        const call = turn.calls.find((c) => c.name === "search_merchants");
        const input = call?.input as { sort?: string } | undefined;
        if (!call) failures.push("search_merchants was not called");
        else if (input?.sort !== "popular") failures.push(`search_merchants.sort = ${String(input?.sort)} (expected "popular")`);
        let top: string | undefined;
        if (call) {
          try {
            top = (JSON.parse(call.output) as { merchants?: Array<{ id: string }> }).merchants?.[0]?.id;
          } catch {
            // handled below
          }
        }
        const teleports = navTargets(turn, "teleport");
        if (teleports.length === 0) failures.push("no navigate (teleport) action");
        else if (top && !teleports.some((t) => t.kind === "merchant" && t.merchantId === top)) {
          failures.push(`teleport does not target the top popular result (${published.find((m) => m.id === top)?.name ?? top})`);
        }
        const words = turn.text.trim().split(/\s+/).length;
        if (words > 70) warnings.push(`reply is ${words} words; a one-line reason was expected`);
        return { failures, warnings };
      },
    },
  ];

  console.log(`Concierge eval · model ${process.env.AI_MODEL ?? "claude-opus-5-5"} · city time ${now.toISOString()} · drop ${drop.start.toISOString()}→${drop.end.toISOString()}\n`);

  const rows: Array<Record<string, string | number>> = [];
  let failed = 0;
  for (const scenario of scenarios) {
    const turn = await runScenario(scenario.message);
    messageByTurn.set(turn, scenario.message);
    const guards = hallucinationGuards(turn, ctx);
    const checks = scenario.check(turn, ctx);
    const failures = [...guards.failures, ...checks.failures];
    const warnings = [...guards.warnings, ...checks.warnings];
    if (failures.length) failed += 1;
    rows.push({
      scenario: scenario.name,
      result: failures.length ? "FAIL" : "PASS",
      tools: turn.calls.map((c) => c.name).join(","),
      actions: turn.actions.map((a) => a.type).join(","),
      cards: turn.merchantCardIds.length + turn.productCardIds.length,
      ms: turn.ms,
    });
    console.log(`── ${scenario.name} (${turn.ms} ms)`);
    console.log(`   user: ${scenario.message}`);
    for (const call of turn.calls) console.log(`   tool: ${call.name} ${JSON.stringify(call.input)}${call.isError ? "  [error]" : ""}`);
    for (const action of turn.actions) console.log(`   action: ${JSON.stringify(action)}`);
    console.log(`   reply: ${turn.text.replace(/\s+/g, " ").trim()}`);
    for (const w of warnings) console.log(`   warn: ${w}`);
    for (const f of failures) console.log(`   FAIL: ${f}`);
    console.log("");
  }
  console.table(rows);
  if (failed) {
    console.error(`${failed} of ${scenarios.length} scenario(s) failed.`);
    process.exit(EXIT_FAIL);
  }
  console.log("All scenarios passed.");

  async function runScenario(message: string): Promise<Turn> {
    const calls: ToolCall[] = [];
    const events: ChatStreamEvent[] = [];
    const provider: LLMProvider = {
      stream: (params, handlers) =>
        real.stream(params, {
          ...handlers,
          onToolCall: async (name, input, id) => {
            const out = await handlers.onToolCall(name, input, id);
            calls.push({ name, input, output: out.content, isError: Boolean(out.isError) });
            return out;
          },
        }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCENARIO_TIMEOUT_MS);
    const started = Date.now();
    try {
      await runConcierge({
        request: {
          messages: [{ role: "user", content: message }],
          context: { location: { kind: "street" }, cart: { lines: [] }, localTime: now.toISOString() },
        },
        user: null,
        emit: (e) => events.push(e),
        signal: controller.signal,
        ds,
        provider,
        now,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = events.map((e) => (e.type === "text" ? e.delta : "")).join("");
    const error = events.find((e): e is Extract<ChatStreamEvent, { type: "error" }> => e.type === "error");
    return {
      text,
      events,
      calls,
      actions: events.filter((e): e is Extract<ChatStreamEvent, { type: "action" }> => e.type === "action").map((e) => e.action),
      merchantCardIds: [...new Set(events.flatMap((e) => (e.type === "cards" ? (e.merchants ?? []).map((m) => m.id) : [])))],
      productCardIds: [...new Set(events.flatMap((e) => (e.type === "cards" ? (e.products ?? []).map((p) => p.id) : [])))],
      ...(error ? { error: `${error.code}: ${error.message}` } : {}),
      ms: Date.now() - started,
    };
  }
}

main().catch((error: unknown) => {
  console.error("\nAI eval crashed:", error instanceof Error ? error.message : error);
  process.exit(EXIT_FAIL);
});
