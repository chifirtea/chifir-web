# Analytics — events and the funnel

First-party, typed events (`track(name, props)` in `src/lib/analytics/client.ts`, catalog in
`src/lib/analytics/events.ts`). The client batches to `POST /api/analytics`; the server adds the
user id from the session and stores rows in `analytics_events` (Supabase) or memory (static mode).
Server-side events (`purchase_completed`, `drop_purchased`) are written by the commerce service
on payment and carry the `sessionId`/`anonymousId` captured at checkout, so they join the same
funnel as the client events.

Identity: `sessionId` per tab (sessionStorage), `anonymousId` per device (localStorage), `userId`
when signed in. Device context (`mobile`, quality `tier`, `gpu`, `ua`) is attached once per session.

## Event catalog (v0.2)

The milestone brief names events in UPPER_CASE; the catalog uses snake_case. Mapping:

| Brief name | Event | Fired by | Key props |
|---|---|---|---|
| SESSION_STARTED | `session_started` | AnalyticsProvider, once per tab | `path`, `referrer`, `party` |
| — | `app_loaded`, `city_load_started`, `city_load_completed`, `city_interactive` | AnalyticsProvider | `ms` |
| CITY_ENTERED | `city_interactive` | AnalyticsProvider (first frame after the world is ready) | `ms` |
| — | `district_entered` | LocationBadge | `districtId` |
| MERCHANT_ENTERED | `store_entered` | `enterMerchant()` (doors, teleports, deep links) | `merchantId`, `via` |
| — | `store_exited` | `exitInterior()` | `merchantId`, `seconds` |
| PRODUCT_VIEWED | `product_inspected` | `inspectProduct()` | `productId`, `merchantId`, `source` |
| DROP_PRODUCT_VIEWED | `drop_product_viewed` | ProductPanel (products with `eventId`) | `eventId`, `productId`, `phase`, `source` |
| AI_QUERY | `ai_message_sent` | useChatStream | `scope`, `merchantId?`, `chars` |
| — | `ai_response_received` | useChatStream | `ms`, `tools`, `ok` |
| AI_ACTION | `ai_action_executed` | `executeAIAction()` | `action`, `accepted` |
| TELEPORT_USED | `teleport` | `teleportTo()` | `targetKind`, `source` (`ai`, `hud`, `deep_link`) |
| — | `waypoint_set` | `guideTo()` | `targetKind`, `source` |
| CART_ADD | `cart_item_added` | ProductPanel / AI `propose_cart` | `productId`, `merchantId`, `quantity`, `source` |
| — | `cart_item_removed` | CartDrawer | `productId` |
| CHECKOUT_STARTED | `checkout_initiated` | startCheckout | `totalCents`, `lines`, `merchants`, `provider` |
| ORDER_COMPLETED | `purchase_completed` (server) | `completeOrder()` | `orderId`, `totalCents`, `merchantIds`, `productIds`, `provider` |
| DROP_PURCHASED | `drop_purchased` (server) | `completeOrder()` when any item has `eventId` of a launch | `eventId`, `orderId`, `productIds`, `totalCents`, `live` |
| PARTY_CREATED | `party_created` | Party HUD | `partyCode`, `via` |
| PARTY_JOINED | `party_joined` | Party join (`?party=`) | `partyCode`, `members`, `spawnedNearInviter` |
| — | `party_left`, `presence_joined` | Party HUD / presence layer | `seconds`; `room`, `peers`, `transport` |
| EVENT_VIEWED | `event_viewed` | Event HUD, Places panel, hotspot, AI | `eventId`, `phase`, `source` |
| EVENT_JOINED | `event_joined` | Arriving at the event parcel or entering its pop-up | `eventId`, `phase`, `via` |
| — | `event_participated` (server) | `completeOrder()`: a ticket or other product of a non-launch event (`ticket_purchased`), or launch items bought with the launch offer applied (`offer_redeemed`) | `eventId`, `kind` |
| — | `perf_sample` | usePerfSampler (every 30 s while visible) | `fps`, `frameP95Ms`, `ttiMs`, `chunkMs`, `memoryMb`, `tier`, `dpr` |
| — | `error_client`, `signup`, `login`, `session_heartbeat` | various | — |

`track()` refuses names outside the catalog at compile time; `/api/analytics` validates every
record (name, prop shapes, batch size) with Zod before storing.

## The funnel

```
session_started
  └─ city_interactive                     (load → first interactive frame; ms)
       ├─ ai_message_sent ─ ai_action_executed ─ teleport | waypoint_set   (AI-led discovery)
       ├─ teleport / district_entered                                     (self-led discovery)
       ├─ party_created / party_joined                                    (social)
       ├─ event_viewed ─ event_joined                                     (Event Square)
       └─ store_entered
            └─ product_inspected (+ drop_product_viewed)
                 └─ cart_item_added
                      └─ checkout_initiated
                           └─ purchase_completed (+ drop_purchased)
```

Suggested funnel queries (per `sessionId`, ordered by `ts`):

1. **Enter**: sessions with `city_interactive` / sessions with `session_started`. Median `ms` by `device.tier` and `device.mobile` is the load KPI.
2. **Discover**: sessions with ≥1 `store_entered` / entered. Split by the first discovery path: an `ai_action_executed` before the first `store_entered` (AI-led) vs a `teleport`/`waypoint_set` with `source = hud` (self-led) vs neither (walked).
3. **Consider**: sessions with `product_inspected` / with `store_entered`; time from `store_entered` to first `product_inspected`.
4. **Intend**: `cart_item_added` / `product_inspected`; share of `source = ai`.
5. **Buy**: `purchase_completed` / `checkout_initiated` (join on `sessionId`; the server record carries it).
6. **Event conversion**: `drop_purchased` / `event_joined` for the event id; `live = true` means bought during the window (earns the event reward).
7. **Social lift**: compare steps 2–5 for sessions with `party_joined` vs without; `presence_joined.peers` describes how busy the room was on arrival.

## Adding an event

1. Add the name and payload type to `AnalyticsEventMap` and `ANALYTICS_EVENT_NAMES`.
2. Fire it from the one place that owns the behaviour (the action bus for navigation, the service for money).
3. Document it in the table above and, if it is a funnel step, in the diagram.
