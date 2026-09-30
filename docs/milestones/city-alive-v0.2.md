# Milestone CITY ALIVE v0.2 — implementation plan

Status: in progress. Base: `claude/mvp-vertical-slice` at v0.1 (204 unit tests, 8 smoke tests green).

## Inspection summary (what v0.1 already gives us)

- Parcels own coordinates and support time-boxed tenancy (`occupiedFrom/Until`, ADR-001) → a pop-up is a
  parcel row, not a feature. `CityIndex.parcelByMerchant` only resolves the *storefront* parcel; the
  renderer iterates merchants, not parcels, so a second (pop-up) parcel is never drawn today.
- `CityEvent` has `productId/offerId/rewardId/parcelId` but no collection, capacity, media or livestream
  fields; statuses are computed once at seed time, not from a live clock.
- `Product` has `digitalRewardId` and `eventId`; nothing expresses "not purchasable before 8 PM".
- `DigitalReward` + `user_rewards` + `grantReward()` already form an entitlement ledger for signed-in
  users; guests have nothing, and nothing consumes an entitlement (avatar never changes).
- AI actions are `navigate | propose_cart | escalate`; only `propose_cart` auto-executes.
- `DevStats` is a dev-only FPS counter; no TTI / chunk / frame-time / device capture, nothing in production.
- No presence layer, no party concept, no admin surface. `ANTHROPIC_API_KEY` is absent in this sandbox.

## Minimum changes (contract-first, then parallel workstreams)

### 0. Shared contracts (done first, by hand; everything else builds on them)

| Area | Change |
|---|---|
| `types/domain.ts` | `Product.availableFrom/Until`; `CityEvent.productIds[]`, `capacity?`, `livestreamUrl?`, `heroVideoUrl?`, `popupParcelId?`, `rewardId` (already); `RewardKind` += `food_prop`, `access_pass`; `DigitalReward.avatarSlot?`, `appearance?`; `MerchantDraft` (generator); `Entitlement` view |
| `lib/time/clock.ts` | One clock for countdowns, tenancy, availability. `?clock=<ISO>` demo override (non-production or `COMMERCE_MODE=demo`), forwarded to the API as a header so server pricing agrees with the client |
| `lib/events/status.ts` | `eventPhase(event, now)` → `scheduled | live | ended`; `nextPhaseChangeAt` for the 1 Hz ticker |
| `city/cityIndex.ts` | `buildCityIndex(snapshot, now)`; `occupiedParcels` (all parcels occupied *now*, incl. pop-ups); `eventByParcel` |
| `engine/store/worldStore.ts` | Interior location carries `parcelId` (pop-up interiors are keyed by parcel, storefront interiors by the merchant's main parcel) |
| `lib/commerce/pricing` + checkout | Lines whose product is outside `availableFrom/Until` are problems ("Drops at 8:00 PM"), never priced |
| `lib/data/types.ts` | `listUserRewards` unchanged; new admin methods `saveMerchantDraft / getMerchantDraft / listMerchantDrafts / publishMerchantDraft`; static + Supabase implementations; migration `0002_city_alive.sql` |
| Seed | Fictional streetwear brand **VANTA STUDIO** (`vanta-studio`): drop event "VANTA / NIGHT SHIFT" at 20:00 city time (next occurrence), pop-up parcel `es-pop1` on Event Square with tenancy = event window, 4-hoodie collection with `availableFrom` = start and avatar-hoodie rewards, real (transparent) launch offer, capacity metadata, hero media + livestream placeholder |
| Analytics | `session_started, party_created, party_joined, event_joined, drop_product_viewed, drop_purchased` + `docs/ANALYTICS.md` funnel |

### 1. Workstreams (parallel agents, each owning its files)

1. **Perf** — `lib/perf` (marks, frame ring buffer p50/p95, TTI, chunk load, memory, device/GPU), `PerfHud` behind `?perf=1` (works in production builds), lazy-load panels/drawers, `docs/PERFORMANCE.md` (mobile budget + on-device protocol; sandbox FPS explicitly not a source of truth).
2. **Visual A** — storefront identity: signage typography/glow, façade materials, window displays with product imagery, awnings/planters, interiors (lighting, plinths, hero wall), product presentation, loading/interior transitions. `lib/media` image resolver + `docs/MEDIA.md` so real imagery is a data change.
3. **Visual B** — streets and environment: lamps with light pools, road markings, benches/trees/bollards, banners with district accents, plaza fountain, ambient NPC walkers, steam/particles, Event Square stage + LED screen surface (hero image / video / livestream placeholder), truss lights, crowd gathering near a live or imminent event (data-driven).
4. **AI actions** — `AIAction` += `highlight_storefront | open_merchant | open_product | recommend`; tools `highlight_storefront`, `open_merchant`, `open_product`; `search_merchants` gains `sort: "popular"`; client validates every id against the city index before executing; `scripts/ai-eval.ts` runs the four scenarios (needs `ANTHROPIC_API_KEY`); offline tests for tool executors, action validation and the hallucination guard.
5. **Presence + party** — `PresenceTransport` (Supabase Realtime when configured, `BroadcastChannel` otherwise), room per location, 10 Hz position packets, interpolation with a 120 ms buffer, remote avatars with name tags, presence count in the HUD, `?party=CODE` links (Web Share on mobile), spawn near the inviter, inviter ring + chevron.
6. **Events / drop / entitlements** — 1 Hz city clock ticker → countdown HUD card, pop-up storefront appears at start (index rebuild), pop-up interior shows the collection, event panel with hero media, `EntitlementStore` (guest grants keyed by order token + server grants for signed-in users), order page "digital twin unlocked" card, avatar wears the hoodie (`outfitId` → reward appearance).
7. **Merchant generator (admin)** — `/admin/generate` gated by `ADMIN_ACCESS_TOKEN`; extract (Shopify `/products.json` + homepage meta, SSRF-guarded) → Claude structured output validated against the merchant schema → mandatory human review/edit → publish through the DataSource (static overlay in memory, Supabase writes with the service role).

### 2. Integration + verification

- Preserve v0.1 tests; add unit tests for clock/phase math, availability pricing, index tenancy, presence interpolation and packet codec, party link parsing, AI action validation, entitlement grants, generator schema/SSRF guard, analytics catalog.
- Playwright: existing 8 smoke tests + party (two pages, BroadcastChannel) + drop (clock override: countdown → pop-up → purchase → entitlement).
- `pnpm check`, production build, bundle size, static preview rebuild.

## Out of scope (by instruction)

No new districts or streets, no MMO infrastructure, no avatar customization UI beyond wearing an earned item, no arbitrary-website extraction perfection.
