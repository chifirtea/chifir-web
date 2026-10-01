# Architecture — MVP Vertical Slice

Working name: **Chifir** (from the repo/domain; branding is a product decision, not an engineering one).
Consumer language: "the city". Never "metaverse", never "virtual mall".

This document is the source of truth for the MVP technical architecture. Decisions that are
cheap to change later are marked **(default)**. Decisions that are expensive to change are
marked **(load-bearing)** and have an ADR in `docs/adr/`.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript strict | Web-first, one deploy, server routes for secrets, streaming responses |
| 3D | Three.js + React Three Fiber 9 + Drei 10 | Declarative scene graph, mature ecosystem, mobile-viable |
| Physics | **None** (custom capsule-vs-AABB in the XZ plane) **(default)** | A physics engine adds ~2 MB WASM and complexity we do not need for walking around buildings |
| Client state | Zustand | Tiny, works outside React (needed for per-frame engine code) |
| Data | Supabase (Postgres, Auth, Storage) with RLS | Fast to ship, SQL we own, migrations in repo |
| Payments | Stripe Checkout (hosted) + webhooks | Real checkout in days; PCI handled by Stripe |
| AI | Official `@anthropic-ai/sdk` behind our own `LLMProvider` interface | Provider swap is a one-file change; tool calling over structured platform data prevents hallucinated inventory |
| Hosting | Vercel (app) + Supabase (data) + Vercel CDN for `/public/assets` **(default)** | Move 3D assets to object storage + CDN when they outgrow the repo |
| Analytics | First-party `track()` → `/api/analytics` → Postgres **(default)** | Provider abstraction lets us add PostHog/Amplitude later without touching call sites |
| Tests | Vitest (unit), Playwright (smoke) | Critical logic: pricing, tool validation, navigation math, collision |

**Local, zero-infra mode (load-bearing):** when Supabase env vars are absent the app runs on
`StaticDataSource`, which serves the same seed data the DB seed uses. The 3D city, browsing,
cart and the demo payment path all work from `pnpm dev` with no accounts. This is the same
interface the Supabase implementation satisfies, not a throwaway mock.

---

## 2. Repository structure

```
src/
  app/                     Next.js routes (thin: parse → call lib → render)
    page.tsx               Landing ("Enter the city")
    city/                  The 3D experience (client bundle, dynamically imported)
    auth/                  login, signup, callback, signout
    orders/[id]/           Order confirmation + live fulfillment status
    api/ai/concierge       Global concierge (SSE stream)
    api/ai/employee        Merchant AI employee (SSE stream)
    api/checkout           Server-priced order + Stripe Checkout Session
    api/checkout/demo      Demo payment (non-production only)
    api/webhooks/stripe    checkout.session.completed → paid → fulfillment
    api/orders/[id]        Order status polling
    api/analytics          Event ingestion
  types/domain.ts          Canonical domain types (mirror of DB rows, camelCase)
  lib/
    env.ts                 Validated env (public vs server split)
    supabase/              browser / server / admin clients (admin is `server-only`)
    data/                  DataSource interface + Static + Supabase implementations
    stripe/                Stripe client (`server-only`)
    ai/                    LLMProvider, AnthropicProvider, tools, prompts, SSE, rate limit
    analytics/             Event catalog + client batching + server ingest
    validation/            Zod schemas for every external input
    utils/                 money, cn, ids
  data/seed/               Seed data (districts, parcels, merchants, products, events, offers)
  engine/                  3D runtime (no commerce logic here)
    canvas/                Canvas wrapper, quality tiers, performance monitor
    input/                 Keyboard, virtual joystick, touch look
    player/                Controller, follow camera, avatar
    physics/               AABB colliders + capsule resolution
    navigation/            NavTarget → world pose, waypoint beacon
    interaction/           Hotspots (doors, products, employees)
    storefront/            Template registry + procedural storefront templates
    interior/              Interior template registry + product slots
    environment/           Ground, roads, sky, lighting, instanced props, ambient NPCs
    store/worldStore.ts    Location, transitions, waypoint, focused product
  city/                    Layout math: districts + parcels → world (roads, plaza, poses)
  features/                UI + product logic, by feature
    cart/  catalog/  checkout/  orders/  ai/  auth/  hud/  analytics/
  components/ui/           Design-system primitives
supabase/migrations/       SQL migrations (the schema of record)
scripts/                   seed.ts, asset pipeline
docs/                      This file + ADRs
e2e/                       Playwright smoke tests
```

Rules:
- `app/` routes contain no business logic. They validate input (Zod), call `lib/`, return.
- `engine/` never imports from `features/` or `lib/data`. It receives data via props/stores.
- Anything importing a secret imports `server-only` first. ESLint forbids importing `lib/supabase/admin`, `lib/stripe`, or `lib/ai/anthropic` from client directories.

---

## 3. Database schema (Postgres / Supabase)

Full DDL in `supabase/migrations/0001_init.sql`. Summary:

| Table | Purpose | Read | Write |
|---|---|---|---|
| `profiles` | 1:1 with `auth.users`: display name, avatar config, XP, level, preferences | owner (+ public subset later for multiplayer) | owner |
| `districts` | Named city areas with bounds, theme, spawn point | public | service role |
| `parcels` | Virtual real estate: position, rotation, size, tier, occupancy, sponsorship | public | service role |
| `merchants` | Businesses (see §4) | public where `status='published'` | service role |
| `ai_employees` | Per-merchant AI persona + rules (see §9) | public where merchant published | service role |
| `products` | Menu items / products (see §5) with generated `search_tsv` | public where active + merchant published | service role |
| `digital_rewards` | Avatar items, apartment items, badges, vehicles | public | service role |
| `user_rewards` | Grants of rewards to users (source order) | owner | service role |
| `offers` | Real, time-bounded promotions with redemption caps | public where active | service role |
| `events` | Scheduled city events (launches, live, promo) | public | service role |
| `orders` | Order header; totals computed server-side | owner | service role |
| `order_items` | Snapshot of title/price/variant at purchase | owner (via order) | service role |
| `order_fulfillments` | One per merchant per order; provider, status, events timeline | owner (via order) | service role |
| `ai_conversations` / `ai_messages` | Chat history for analytics + future memory | owner | service role |
| `analytics_events` | First-party product analytics | none (dashboards later) | service role |

Conventions: `uuid` PKs (`gen_random_uuid()`), `timestamptz`, `*_cents integer` money, `text`
+ `CHECK` instead of Postgres enums (enums are painful to evolve), `jsonb` for nested
configuration that is read whole (brand palette, storefront config, variant groups, attributes,
fulfillment options). Anything we filter on is a real column.

Why `parcels` is its own table **(load-bearing, ADR-001):** virtual real estate, sponsored
placement, pop-ups, and "place the business in the city" are all parcel operations. A merchant
occupies a parcel; the parcel owns city coordinates. Moving a store is an `UPDATE`. A merchant may
hold several parcels (store + billboard + pop-up) and occupancy can be time-boxed
(`occupied_from/until`), which is what pop-ups and campaigns need.

Why `offers` are applied by the pricing engine, not just displayed **(load-bearing):** the brief
forbids fake promotions. `computeTotals()` is the only place discounts are computed (client
preview and server checkout run the same function); an offer that cannot be honoured cannot be
seeded. Redemption caps are counted atomically on payment (`redeem_offer`).

Why no `carts` table in MVP **(default):** the cart lives client-side (Zustand, persisted).
Prices are never trusted from the client: checkout re-prices every line from the DB. Shared/
group carts later become a `shared_carts` table keyed by session, without touching orders.

---

## 4. Merchant schema

`Merchant` (`src/types/domain.ts`) ↔ `merchants` row:

- Identity: `id`, `slug`, `name`, `tagline`, `description`, `category` (dot-namespaced slug, e.g. `food.ramen`, `fashion.streetwear`, `gifts.flowers`), `merchantType` (`restaurant | retail | service | venue | popup`), `status`, `tags[]`, `priceLevel`.
- Brand: `logoUrl`, `heroImageUrl`, `images[]`, `brand: { primary, secondary, accent, onPrimary }`, `websiteUrl`.
- Real world: `address`, `geo { lat, lng }`, `openingHours { timezone, weekly }`.
- City presence: `storefrontTemplate`, `interiorTemplate`, `storefrontConfig` (signage style, façade material, awning, floors, window display), `sponsored`. Position comes from the occupied `parcel`.
- Commerce: `fulfillment { delivery?, pickup?, shipping?, booking?, provider }`.
- AI: one `ai_employees` row (see §9).

Everything the 3D engine needs to draw a store is in `merchant + parcel`. Nothing about a
specific merchant is hardcoded in the engine.

## 5. Product / menu schema

`Product` ↔ `products` row: `id`, `merchantId`, `slug`, `title`, `description`, `category`,
`priceCents`, `currency`, `compareAtPriceCents?`, `imageUrl?`, `images[]`, `model3dUrl?`,
`inventoryStatus` (`in_stock | low_stock | out_of_stock | preorder`), `inventoryCount?`,
`variantGroups[]` (option groups with price deltas), `attributes` (spice level, dietary tags,
allergens, sizes, colors, occasion), `tags[]`, `fulfillmentTypes[]`
(`delivery | pickup | shipping | booking | ticket | digital | lead`), `leadTime`,
`digitalRewardId?`, `featured`, `sortOrder`, `active`.

Menu items and retail products share one table: the difference is `merchantType` on the
merchant plus attributes. This keeps concierge queries ("spicy under $25", "gift under $300")
one query.

## 6. Cart and order schemas

- Client `CartLine { key, productId, merchantId, quantity, variantSelection, notes }`. Totals are derived from the catalog; the cart stores no prices.
- **Fulfillment is chosen per merchant**, not per order: a cart with a burger (delivery) and a hoodie (shipping) is the normal case for the concierge's "date night" scenario. `computeTotals(lines, products, merchants, { [merchantId]: type }, { offers, promoCode })` validates every product supports its merchant's chosen type, charges one fee per merchant, applies the best live offer per line, and lists problems by line key.
- `POST /api/checkout` body: `{ lines, fulfillment: [{ merchantId, type }], contact, deliveryAddress?, promoCode? }` (address required when any type is delivery/shipping). Server: re-price with `computeTotals` from DB rows + live offers, create `orders` (`pending_payment`) + `order_items` (title/merchant/price/discount snapshots) + one `order_fulfillments` row per merchant (type, fee, recipient, address), create the Stripe Checkout Session from the same priced lines, store the session id, return the URL.
- Webhook `checkout.session.completed` → `orders.status='paid'` → `redeem_offer` per applied offer → `FulfillmentProvider.create()` per fulfillment → grant digital rewards → `add_xp` (idempotent via `xp_ledger`) → `purchase_completed` analytics event. Idempotent on `stripe_checkout_session_id`.
- `FulfillmentProvider` interface (`create`, `getStatus`, `cancel`) with a `SimulatedProvider` that advances a realistic timeline (accepted → preparing → out for delivery → delivered) on polling. Per-merchant fulfillments already carry their own recipient/address, which is what group ordering and consolidated delivery will need.
- Guest orders: `/orders/[id]` is readable by anyone holding the order id (a random uuid) plus the contact email hash in a signed cookie set at checkout; signed-in users also see orders in their account. Orders are never listed for guests.

## 7. How 3D storefront templates consume merchant data

A template is a React component plus metadata, registered by id:

```ts
interface StorefrontTemplateDef {
  id: StorefrontTemplateId;            // 'bistro' | 'fast-casual' | 'cafe' | 'boutique' | 'flagship' | 'kiosk'
  suitableFor: MerchantType[];
  footprint: { width: number; depth: number }; // metres, matched to parcel tiers
  doorOffset: { x: number; z: number };        // local space; front face is +Z
  colliders(parcel: Parcel): AABB[];          // world-space blocking volumes
  Component: ComponentType<StorefrontTemplateProps>;
}
interface StorefrontTemplateProps { merchant: Merchant; parcel: Parcel; quality: QualityTier; lod: 0 | 1 | 2 }
```

`StorefrontRenderer` maps every occupied parcel to its merchant's template, positions it from
`parcel.position/rotationY`, and mounts a door `Hotspot` at the template's door offset.
Templates are procedural (parameterised geometry + canvas-rendered signage from `merchant.name`
+ `brand`) so a new merchant needs zero new assets. Templates may later load a GLB shell with
material overrides behind the same contract. Interiors follow the same pattern: an
`InteriorTemplateDef` declares `productSlots[]`; `InteriorRenderer` fills slots from
`products` and mounts a product `Hotspot` per slot and one employee `Hotspot`.

World conventions **(load-bearing):** 1 unit = 1 metre, Y up, ground plane is XZ,
forward = (sin yaw, 0, cos yaw) so `yaw = 0` faces +Z (three.js `rotation.y`). A parcel's
`position` is the centre of its footprint; parcel rotations are multiples of 90° (colliders are
AABBs). Interiors render on a separate layer (`z + 5000`) offset by the merchant's parcel, so
every interior has unique world coordinates and the street is unmounted while inside.

## 8. AI concierge architecture

- Route: `POST /api/ai/concierge` (server only) → SSE stream of `ChatStreamEvent`.
- Provider: `LLMProvider.stream({ system, messages, tools, maxTokens })` → `AnthropicProvider` using `client.messages.stream()` in a manual tool loop (streaming text, `strict: true` tools, `eager_input_streaming: true` with Zod validation before execution, stop on `refusal`/`max_tokens`, typed SDK errors). Model from `AI_MODEL` (default `claude-opus-5-5`), `output_config.effort: 'low'` for chat latency.
- Tools are the only source of facts. They call the same `DataSource` the UI uses:
  `search_merchants`, `search_products`, `get_merchant`, `get_events`, `navigate`, `propose_cart`.
  The system prompt forbids stating any price, item or availability that a tool did not return in this turn.
- Client protocol: the client sends plain text history + context (`location`, cart summary, local time, stated preferences). The server re-runs tools each turn (stateless). Events: `text`, `cards` (merchant/product cards to render), `action` (see §10), `done`, `error`.
- Guardrails: Zod on request body (≤16 messages, ≤2000 chars each, ≤12k total, last message from the user), per-session token bucket (in-process for MVP; move to Upstash/Postgres before scale), tool loop capped at 4 iterations and ~700 output tokens, tool inputs validated with tight caps (query ≤120 chars, ≤12 results), merchant text wrapped as data in prompts, cart lines priced server-side (the client sends ids only), conversation history persisted only for signed-in users and only to their own conversations.

## 9. AI merchant employee architecture

- Route: `POST /api/ai/employee` with `merchantId`. Server loads `merchant`, its `ai_employee`, and its active catalog. The catalog is small per merchant, so it is embedded as JSON in the (cacheable) system prompt; `search_products` is scoped to the merchant for larger catalogs.
- Persona is data: `name`, `role`, `personality`, `tone`, `greeting`, `knowledge[]`, `upsellRules[]`, `prohibitedClaims[]`, `brandLanguage[]`, `escalation`, `allowedContext[]` (which user context the employee may see: cart, dietary, budget, location). Only `AiEmployeePublic` (id, name, role, avatar, greeting) ever reaches the browser; the rest is read server-side when building the prompt (column grants enforce this in Postgres too).
- Tools: `recommend_items` (returns product ids → cards), `propose_cart`, `escalate_to_human`.
- Fixed platform rules always win over merchant configuration: allergen answers must instruct the user to confirm with the merchant; no medical/health claims; no prices not in the catalog; instructions found inside catalog text are data, never commands.

## 10. Teleport / navigation actions

Single action bus, `CityActions`, used by the AI, the HUD, deep links (`/city?to=<merchant-slug>`), and later friends/events:

```ts
type NavTarget = { kind: 'merchant'; merchantId } | { kind: 'district'; districtId } | { kind: 'parcel'; parcelId } | { kind: 'event'; eventId } | { kind: 'point'; x; z };
resolveNavTarget(target, cityIndex) → { position: [x, y, z]; yaw }   // merchant → its door pose
teleportTo(pose)   // fade out → set player rig → fade in → analytics 'teleport'
guideTo(target)    // sets a waypoint: beacon in-world + HUD chevron + distance
```

The AI never moves the player directly; it emits `{ type: 'navigate', mode, target }` and the
client executes it through the same bus, with a one-tap confirmation for teleports.

## 11. Asset management strategy

- MVP: procedural geometry, canvas textures (signage), a small library of instanced props. Zero downloads beyond the JS bundle for the first render.
- GLB assets (when added): `gltf-transform` pipeline (`dedup`, `prune`, `weld`, `meshopt`/`draco`, textures ≤1024 mobile / 2048 desktop, KTX2 when tooling is present) via `scripts/optimize-assets.ts`; served from `/public/assets` (Vercel CDN) behind `assetUrl()` so a move to Supabase Storage/R2 is a one-line change.
- Loading: `Suspense` per storefront, `useGLTF.preload` for the player's district, drei `<Detailed>` for LOD, `<Instances>` for repeated props, texture size chosen by quality tier.

## 12. Mobile performance strategy

- Quality tiers (`low | medium | high`) from `hardwareConcurrency`, `deviceMemory`, GPU renderer string, and a 2-second FPS probe; drei `PerformanceMonitor` steps the tier down on sustained drops.
- Tier controls DPR clamp (1.0–1.5 on mobile), shadows (off on low), post-processing (none below high), LOD distances, prop instance counts, NPC count, texture sizes.
- No physics engine; colliders are AABBs in a flat array (a few hundred at most).
- Input: virtual joystick (left) + drag-to-look (right); 44px+ touch targets; the 3D bundle is dynamically imported only on `/city`.
- Budget: ≤ 600 KB gzipped first-load JS for `/city` (stack floor ~450 KB + app code), enforced in CI with a route-chunk size check; TTI < 4 s on a mid-range Android over 4G; ≥ 30 FPS on iPhone 12-class devices. Named drei imports only (ESLint enforces).
- Context-creation attributes (antialias, powerPreference) are decided once at Canvas mount from the initial tier and form factor; everything else in `QualitySettings` can step down at runtime.

## 13. Analytics events

Catalog in `src/lib/analytics/events.ts` (typed payloads). Session id per tab, anonymous id per device, user id when logged in, `device { tier, mobile, gpu }` attached server-side once per session.

`app_loaded`, `city_load_started`, `city_load_completed { ms }`, `city_interactive { ms }`,
`session_heartbeat { seconds }`, `district_entered`, `store_entered`, `store_exited { seconds }`,
`product_inspected`, `ai_message_sent { scope, merchantId? }`, `ai_response_received { ms, tools }`,
`ai_action_executed { action }`, `cart_item_added`, `cart_item_removed`, `checkout_initiated { totalCents, lines }`,
`purchase_completed` (server-side, from webhook), `event_viewed`, `teleport`, `waypoint_set`,
`perf_sample { fps, dpr, tier }`, `error_client`, `signup`, `login`.

## 14. Security boundaries

| Boundary | Rule |
|---|---|
| Browser | Only `NEXT_PUBLIC_*` env. Supabase anon key + RLS. No Stripe secret, no LLM key, no service role. |
| Route handlers | Zod-validate every body/query. Service role client only inside `lib/supabase/admin.ts` (`server-only`). |
| Money | Prices, fees, totals computed server-side from DB rows. Stripe line items are built from those. Webhook signature verified; processing idempotent. |
| Demo payment | `/api/checkout/demo` refuses unless `COMMERCE_MODE=demo` **and** `NODE_ENV !== 'production'`. |
| AI | Tool inputs validated; tool outputs are the only facts; merchant/user text is wrapped as data; per-user rate limit; history cap; refusals surfaced as a friendly error, never retried blindly. |
| Auth | Supabase Auth via `@supabase/ssr` cookies; `proxy.ts` refreshes sessions; orders/profile RLS by `auth.uid()`. |
| Headers | `nosniff`, `DENY` framing, strict referrer, restrictive permissions policy. |

## 15. CITY ALIVE v0.2 additions

Everything below reuses the contracts above; nothing merchant-specific entered the engine.

- **One clock (ADR-005).** `lib/time/clock.ts` is "now" on the client; `?clock=` shifts it for a
  rehearsal (allowed outside production or with `ALLOW_CLOCK_OVERRIDE=1`) and the offset travels
  to the API as a header. `lib/events/status.ts` derives event phases, pop-up tenancy and product
  availability from it; `CityIndex` is built per clock value and rebuilt at the next boundary.
- **Pop-ups are parcels.** A time-boxed tenancy (`occupied_from/until`) plus optional
  `storefront_template`/`interior_template` overrides on the parcel. Interiors and doors are
  keyed by parcel, so a brand's store and its pop-up are different rooms; the pop-up shows the
  event's `product_ids` collection (`productsAtParcel`).
- **Drops are events + availability windows.** `events.product_ids`, `capacity` (context only),
  `hero_video_url`, `livestream_url`, `reward_id`; `products.available_from/until` enforced by
  `variantProblem`/`computeTotals` on the client preview and at checkout with the request clock.
  No fake scarcity: counts are informational, the collection stays on sale after the window.
- **Entitlements.** `digital_rewards.kind` now covers avatar items, furniture, food props,
  vehicles, badges, emotes and access passes, with `avatar_slot` and a data-driven `appearance`.
  The order API returns the rewards an order earned; the client entitlement store grants them to
  the buyer (guest or signed in), `equip()` mirrors the outfit into the engine's avatar store and
  the avatar renders the silhouette + colours + print. Signed-in users merge server grants.
- **Presence (ADR-006).** `PresenceTransport` with Supabase Realtime and a `BroadcastChannel`
  fallback; rooms are locations; packets are cosmetic and validated; party links are `?party=`.
- **AI actions.** `highlight_storefront`, `open_merchant`, `open_product`, `recommend` join
  `navigate`/`propose_cart`; every id is validated against the city index before execution;
  tools expose availability so the model can say "drops at 8 PM" instead of inventing stock.
- **Merchant generator (ADR-007).** Extraction → AI structuring validated against the schema →
  mandatory human review → `publishMerchantDraft`, which refuses anything not approved.
- **Measurement.** `lib/perf` marks the load path (User Timing), keeps frame-time percentiles and
  device info; `?perf=1` shows the HUD in any build; `perf_sample` carries the same numbers.
  Panels and drawers are lazy. See docs/PERFORMANCE.md, docs/ANALYTICS.md, docs/MEDIA.md.

## 16. Milestone plan (vertical slice)

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Foundation** | Scaffold, this doc, domain types, migrations, seed, CI | `pnpm check` green; DB migrates + seeds |
| **M1 Playable city** | Plaza + Food Street + Fashion Street + Event Square from data; storefront templates; player + camera; desktop + touch controls; enter/exit interiors | Walk from spawn into a restaurant on desktop and phone at ≥30 FPS |
| **M2 Commerce** | Product/menu panels, cart, Stripe Checkout, webhook, order page, simulated fulfillment, digital reward grant | Real test-mode purchase ends on an order page with a live status timeline |
| **M3 AI** | Concierge + employee routes, chat UI, navigate/propose-cart actions | "Spicy under $25" returns real items, teleports to the restaurant, proposes a cart |
| **M4 Polish** | Quality tiers, ambient life, loading screen, analytics wiring, error boundaries | Load → interactive < 4 s mid-range mobile; all §13 events firing |
| Later | Multiplayer (evaluate PartyKit / Colyseus / Supabase Realtime after M4), events, pop-ups, merchant onboarding (§4 makes "website → store" a data-import problem) | — |
