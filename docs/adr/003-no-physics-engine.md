# ADR-003: No physics engine in the MVP

**Status:** accepted

## Context
The player walks on flat ground between buildings. Mobile performance and initial bundle size
are hard requirements. Rapier/Cannon add WASM/JS weight, worker plumbing and tuning.

## Decision
Movement uses a custom capsule-vs-AABB resolver in the XZ plane. Templates declare their
colliders. Ground height is constant per area (steps are ramps).

## Consequences
- Zero physics payload; collision is a few hundred AABB checks per frame.
- Vehicles, ragdolls or dynamic props would need a real engine later; nothing in the API
  prevents swapping the resolver.
