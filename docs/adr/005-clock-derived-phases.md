# ADR-005: Event phases, pop-up tenancy and product availability are derived from one clock

**Status:** accepted (v0.2)

## Context
Event Square needs countdowns, pop-ups that open at a scheduled instant, products that become
purchasable at launch and offers that apply only during the window. Storing a `status` column
and flipping it with a job is fragile (jobs drift, caches go stale) and makes a demo impossible
to rehearse. The brief also forbids fake countdowns: what the client shows must be what the
server enforces.

## Decision
- `lib/time/clock.ts` is the only source of "now" on the client. A demo override (`?clock=`)
  shifts it; the offset is forwarded to the API as a header and honoured by `requestNow()` only
  where `features.demoClock` is on (non-production, or `ALLOW_CLOCK_OVERRIDE=1` on a rehearsal
  deployment).
- `lib/events/status.ts` derives everything: `eventPhase` (scheduled|live|ended; only
  `cancelled` is stored), `parcelOccupiedAt` (pop-up tenancy from `occupied_from/until`),
  `productAvailability` (`available_from/until`). The city index is built for a clock value and
  rebuilt at the next boundary (`useCityPhaseTicker`), so the storefront, the door hotspot, the
  products on the plinths, the "Add" button and the checkout all flip together.
- Pricing enforces the same windows: `variantProblem`/`computeTotals` refuse a product outside
  its window on the client preview and in `createCheckoutOrder` with the request clock.

## Consequences
- No scheduler, no status writes, no stale caches; a Supabase row and a static seed row behave
  identically.
- A pop-up is a parcel row with a tenancy window and a template override; a drop is an event row
  pointing at a collection whose `available_from` equals `starts_at`. Nothing is hard-coded.
- The override is a rehearsal tool only; production ignores the header unless explicitly enabled.
