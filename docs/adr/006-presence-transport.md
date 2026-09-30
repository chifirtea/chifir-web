# ADR-006: Presence is a thin transport behind an interface, rooms are locations

**Status:** accepted (v0.2)

## Context
The city must feel inhabited (see other people in your district, walk with a friend from a party
link) without MMO infrastructure. Later needs: parties, friends, voice.

## Decision
- `lib/presence/transport.ts` defines `PresenceTransport` (join room, leave, publish a small
  state packet at ~10 Hz, subscribe to peers' packets and join/leave). Two implementations:
  Supabase Realtime (Presence for membership, Broadcast for movement) when Supabase is configured,
  and a `BroadcastChannel` transport for local development, the static preview and end-to-end
  tests (tabs of one browser see each other).
- A room is a location: the district on the street (`district:<id>`), the parcel indoors
  (`interior:<parcelId>`). Moving between rooms is a leave + join. Rooms cap what a phone renders.
- Packets carry position, yaw, a motion flag, avatar colours/outfit and the party code; the
  receiver interpolates with a short buffer (~120 ms) and despawns silent peers.
- No server authority: presence is cosmetic and never affects commerce. Party links are a code in
  the URL (`?party=CODE`); the joiner spawns near the first packet from the inviter.

## Consequences
- Swapping the transport (a dedicated realtime service, WebRTC for voice) is one file.
- Rooms keyed by location scale with the city, not with the user count.
- Anything that needs trust (shared carts, group orders) goes through the API, not presence.
