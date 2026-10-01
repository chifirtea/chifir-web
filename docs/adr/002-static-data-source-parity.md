# ADR-002: A static DataSource with full parity to Supabase

**Status:** accepted

## Context
The vertical slice must be runnable from a URL with no infrastructure and must also be
testable in CI. Mocks that diverge from production code rot quickly.

## Decision
`lib/data` exposes one `DataSource` interface. `SupabaseDataSource` is production.
`StaticDataSource` serves `src/data/seed` (the same data the DB seed script writes) and keeps
orders in process memory. Selection is automatic from env presence.

## Consequences
- `pnpm dev` with an empty `.env` shows the full city, cart and demo checkout.
- AI tools, the UI and tests all use the same query functions, so search semantics cannot drift.
- Static mode is explicitly not multi-instance safe; it is for local dev, demos and CI only.
