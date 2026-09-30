# Chifir — the internet as a city

Real restaurants, stores and events as walkable places. Walk in, ask, get it IRL.

Chifir is a web-first 3D city where every building is a real business with its real menu,
hours and prices. You can wander the streets, talk to an AI concierge ("spicy dinner under $25,
delivered") or the AI employee behind any counter, and check out for real: delivered, picked up,
shipped or booked. Nothing here is a mock-up of commerce; it is commerce with a city on top.

> ![Screenshot placeholder: Central Plaza at dusk with the street-sign HUD](docs/screenshot.png)
> _Screenshot to come once the first storefronts land._

## Quick start

```bash
pnpm i
cp .env.example .env   # optional; an empty .env is fine
pnpm dev               # http://localhost:3000
```

With an empty `.env` the app runs in **static mode**: the full city, browsing, cart and the
demo payment path all work from the seed data in `src/data/seed`, no accounts needed.

## The three modes

| Mode                 | What you set                                                                             | What you get                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Static** (default) | nothing                                                                                  | Seed data served in-memory (`StaticDataSource`), orders kept in process memory, demo payment path |
| **Supabase**         | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Postgres with RLS, auth, durable orders, analytics ingest. Migrate and seed with `pnpm db:seed`   |
| **Stripe test**      | the above + `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET`                   | Hosted Stripe Checkout in test mode, webhook → paid → fulfillment timeline                        |

Add `ANTHROPIC_API_KEY` in any mode to turn on the concierge and merchant employees. Live Stripe
keys are refused unless `COMMERCE_MODE=live` and `NODE_ENV=production`; the demo payment route is
never available in production. Setup details: `docs/SETUP.md`.

## Scripts

| Command                                  | Does                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js                                                                              |
| `pnpm check`                             | `typecheck` + `lint` + `test`                                                        |
| `pnpm test` / `pnpm test:watch`          | Vitest unit tests                                                                    |
| `pnpm e2e`                               | Playwright smoke tests                                                               |
| `pnpm size`                              | Gzipped first-load JS for `/city` against the 600 KB budget (run after `pnpm build`) |
| `pnpm db:seed`                           | Seed a Supabase project from `src/data/seed`                                         |
| `pnpm format`                            | Prettier                                                                             |

CI (`.github/workflows/ci.yml`) runs all of the above on Node 22 / pnpm 10 with a placeholder env.

## Architecture

Next.js 16 (App Router) · React 19 · TypeScript strict · Three.js + React Three Fiber · Zustand ·
Tailwind v4 · Supabase · Stripe Checkout · the official Anthropic SDK behind a provider interface.

- `docs/ARCHITECTURE.md` — the source of truth: stack, schema, storefront templates, AI tools, navigation bus, mobile budget, analytics catalog, security boundaries.
- `docs/adr/` — the load-bearing decisions (parcels are first class; static data source parity; no physics engine; LLM provider abstraction).
- `docs/SETUP.md` — environment and provider setup.

Layout in one breath: `src/app` routes are thin; `src/lib` owns data, env, AI, analytics and
validation; `src/engine` is the 3D runtime and knows nothing about commerce; `src/city` turns
districts and parcels into a world; `src/features` is the UI by feature; `src/components/ui` is
the design system.

## Roadmap

| Phase                | Scope                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **M0 Foundation**    | Scaffold, architecture, domain types, migrations, seed, CI                                                                     |
| **M1 Playable city** | Plaza, Food Street, Fashion Street and Event Square from data; procedural storefronts; walk in on desktop and phone at ≥30 FPS |
| **M2 Commerce**      | Menus and products, cart, Stripe Checkout, webhook, order page with a live fulfillment timeline, digital rewards               |
| **M3 AI**            | Concierge and merchant employees with tool calling over real catalog data; navigate and propose-cart actions                   |
| **M4 Polish**        | Quality tiers, ambient life, loading, analytics, error boundaries; load → interactive under 4 s on mid-range mobile            |
| Later                | Multiplayer, live events, pop-ups, merchant onboarding ("website → store" as a data import)                                    |

## Design principles

- **No dark patterns.** No fake urgency, no countdowns that lie, no pre-ticked upsells. Every promotion in the city is a real, time-bounded offer applied by the same pricing code on the client and the server.
- **The AI only knows what the tools return.** No invented prices, items or availability. Allergen questions always point back to the merchant.
- **Real places, real hours.** Merchants publish their opening hours, fulfillment options and prices; the city shows them as they are.
- **The UI is signage, not a dashboard.** Street signs, plates and sheets layered over a living night city. Sentence case, plain verbs, the same verb for the same action everywhere ("Take me there", "Guide me", "Get it IRL").
- **Phones first.** 16 px gutters, 44 px targets, bottom sheets, safe-area insets, a 600 KB gzipped JS budget for `/city`.
- **Honest by default.** Demo merchants are labelled as such; checkout runs in test mode until it does not.

## QA hooks

- `?quality=low|medium|high` on `/city` forces a render tier (also `localStorage.chifir.quality`).
- `?clock=<ISO local time | +seconds | epoch ms>` shifts the city clock for the tab (countdowns, pop-ups, drop availability, checkout) outside production or with `ALLOW_CLOCK_OVERRIDE=1`.
- `?perf=1` shows the developer performance HUD (FPS, frame p95, TTI, chunk load, memory, device) in any build.
- `?party=<CODE>` joins a party (the Invite button in the HUD builds these links).
- `?to=<merchant-slug>` / `?to=district:<slug>` / `?to=event:<slug>` deep-links to a place; `?ask=<text>` opens the concierge with a prompt.
- In development builds `window.__chifirDebug` exposes the action bus (`teleportTo`, `enterMerchant`, `inspectFirstProduct`, …) so tests can open panels deterministically.
- `pnpm e2e` runs the Playwright smoke suite against a dev server on `http://localhost:3100` (set `E2E_BASE_URL` to reuse a running one); `node scripts/visual-check.mjs` takes screenshots and reports console errors.
