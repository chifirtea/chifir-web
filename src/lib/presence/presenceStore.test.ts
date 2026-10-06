import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESPAWN_MS } from "./interpolation";
import {
  MEMBERSHIP_GRACE_MS,
  PARTY_CROSS_ROOM_RADIUS_M,
  partyNearbyElsewhere,
  seenAcrossRooms,
  selectPartyMemberCount,
  selectRoomCount,
  usePresenceStore,
} from "./presenceStore";
import {
  decodePacket,
  MAX_NEW_PEERS_PER_SECOND,
  MAX_PACKETS_PER_SECOND,
  MAX_PARTY_PEERS,
  MAX_ROOM_PEERS,
  type PresencePacket,
} from "./transport";

const packet = (id: string, overrides: Partial<PresencePacket> = {}): PresencePacket => ({
  t: Date.now(),
  id,
  x: 1,
  z: 2,
  yaw: 0,
  m: 0,
  a: { b: "#8a5a44", h: "#1a120e" },
  n: `Peer ${id}`,
  ...overrides,
});

describe("presence store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const s = usePresenceStore.getState();
    s.setRoom("district:d1", "broadcast");
    s.clearPartyPeers();
    s.setMe({ peerId: "me", name: "Me", partyCode: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a peer on the first packet and counts the room including us", () => {
    const s = usePresenceStore.getState();
    expect(selectRoomCount(s)).toBe(1);
    expect(s.applyPacket(packet("a"), Date.now())).toBe(true);
    const peer = usePresenceStore.getState().peers.a;
    expect(peer).toMatchObject({ name: "Peer a", bodyColor: "#8a5a44", partyCode: null, outfit: null });
    expect(peer?.buffer.samples).toHaveLength(1);
    expect(selectRoomCount(usePresenceStore.getState())).toBe(2);
  });

  it("ignores our own packets and exact duplicates, and orders by arrival", () => {
    const s = usePresenceStore.getState();
    expect(s.applyPacket(packet("me"), Date.now())).toBe(false);
    const t = Date.now();
    expect(s.applyPacket(packet("a", { t }), t)).toBe(true);
    expect(s.applyPacket(packet("a", { t }), t + 5)).toBe(false);
    // An earlier sender clock is still the newest arrival: the sender clock does not order.
    expect(s.applyPacket(packet("a", { t: t - 50, x: 2 }), t + 10)).toBe(true);
    expect(usePresenceStore.getState().peers.a?.buffer.samples.map((x) => x.x)).toEqual([1, 2]);
  });

  it("does not let a forged far-future clock freeze the real peer", () => {
    const s = usePresenceStore.getState();
    const t0 = Date.now();
    s.applyPacket(packet("friend", { t: t0 }), t0);
    // Off the schema entirely...
    expect(decodePacket({ ...packet("friend"), t: 9e15 })).toBeNull();
    // ...and a forged clock that does validate does not lock the real packets out.
    s.applyPacket(packet("friend", { t: 4_000_000_000_000, x: 50, z: 50 }), t0 + 50);
    let accepted = 0;
    for (let i = 1; i <= 10; i++) {
      if (s.applyPacket(packet("friend", { t: t0 + i * 100, x: 1 + i * 0.1 }), t0 + 50 + i * 100)) accepted++;
    }
    expect(accepted).toBe(10);
    expect(usePresenceStore.getState().peers.friend?.buffer.samples.at(-1)?.x).toBeCloseTo(2);
  });

  it("caps a room's peers and how fast new ids are admitted", () => {
    const s = usePresenceStore.getState();
    const t0 = Date.now();
    let admitted = 0;
    for (let i = 0; i < 2000; i++) if (s.applyPacket(packet(`fake${i}`), t0)) admitted++;
    expect(admitted).toBe(MAX_NEW_PEERS_PER_SECOND);
    // Over several seconds the room fills up to the cap and no further.
    for (let sec = 1; sec <= 20; sec++) {
      for (let i = 0; i < 100; i++) s.applyPacket(packet(`fake${sec}-${i}`), t0 + sec * 1000);
    }
    expect(selectRoomCount(usePresenceStore.getState())).toBe(MAX_ROOM_PEERS + 1);
    // Known peers keep updating while the room is full.
    expect(s.applyPacket(packet("fake0", { t: t0 + 1, x: 3 }), t0 + 25_000)).toBe(true);
    // A room change starts over.
    s.setRoom("district:d2", null);
    expect(s.applyPacket(packet("fresh"), t0 + 25_000)).toBe(true);
  });

  it("keeps the peers record stable for position-only packets and replaces it on a look change", () => {
    const s = usePresenceStore.getState();
    const t0 = Date.now();
    s.applyPacket(packet("a", { t: t0 }), t0);
    const before = usePresenceStore.getState().peers;
    s.applyPacket(packet("a", { t: t0 + 100, x: 1.5 }), t0 + 100);
    expect(usePresenceStore.getState().peers).toBe(before);
    expect(before.a?.buffer.samples).toHaveLength(2);
    s.applyPacket(packet("a", { t: t0 + 200, o: { style: "hoodie", primary: "#101820" } }), t0 + 200);
    const after = usePresenceStore.getState().peers;
    expect(after).not.toBe(before);
    expect(after.a?.outfit).toEqual({ style: "hoodie", primary: "#101820" });
    expect(after.a?.buffer).toBe(before.a?.buffer);
  });

  it("ignores a peer that floods more than 30 packets per second", () => {
    const s = usePresenceStore.getState();
    const t0 = Date.now();
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      if (s.applyPacket(packet("flood", { t: t0 + i }), t0 + i * 10)) accepted++;
    }
    expect(accepted).toBe(MAX_PACKETS_PER_SECOND);
    // A new one-second window admits packets again.
    expect(s.applyPacket(packet("flood", { t: t0 + 1000 }), t0 + 1000)).toBe(true);
  });

  it("removes peers on leave, membership sync and silence", () => {
    const s = usePresenceStore.getState();
    const t0 = Date.now();
    s.applyPacket(packet("a", { t: t0 }), t0);
    s.applyPacket(packet("b", { t: t0 }), t0);
    s.applyPacket(packet("c", { t: t0 }), t0);
    s.removePeer("a");
    expect(Object.keys(usePresenceStore.getState().peers).sort()).toEqual(["b", "c"]);
    // A membership snapshot that does not list a peer yet keeps it while its packets are fresh.
    s.retainPeers(["c", "zzz"], t0 + 100);
    expect(Object.keys(usePresenceStore.getState().peers).sort()).toEqual(["b", "c"]);
    s.retainPeers(["c", "zzz"], t0 + MEMBERSHIP_GRACE_MS + 1);
    expect(Object.keys(usePresenceStore.getState().peers)).toEqual(["c"]);

    vi.advanceTimersByTime(DESPAWN_MS - 10);
    s.applyPacket(packet("d", { t: Date.now() }), Date.now());
    expect(s.prune(Date.now())).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(s.prune(Date.now())).toEqual(["c"]);
    expect(Object.keys(usePresenceStore.getState().peers)).toEqual(["d"]);
  });

  it("clears peers when the room changes", () => {
    const s = usePresenceStore.getState();
    s.applyPacket(packet("a"), Date.now());
    s.setRoom("interior:p1", null);
    expect(usePresenceStore.getState().peers).toEqual({});
    expect(usePresenceStore.getState().transport).toBeNull();
  });

  it("only lists party peers that share our code, with their room", () => {
    const s = usePresenceStore.getState();
    expect(selectPartyMemberCount(usePresenceStore.getState())).toBe(0);
    expect(s.applyPartyPacket(packet("a", { p: "ABC234", r: "district:d1" }), Date.now())).toBe(false);
    s.setMe({ partyCode: "ABC234" });
    expect(s.applyPartyPacket(packet("a", { p: "ABC234", r: "district:d1" }), Date.now())).toBe(true);
    expect(s.applyPartyPacket(packet("b", { p: "OTHER1" }), Date.now())).toBe(false);
    expect(usePresenceStore.getState().partyPeers.a).toMatchObject({ room: "district:d1", x: 1, z: 2, bodyColor: "#8a5a44" });
    expect(selectPartyMemberCount(usePresenceStore.getState())).toBe(2);
    // Steps update the record in place (no re-render per step); a room change replaces it.
    const before = usePresenceStore.getState().partyPeers;
    s.applyPartyPacket(packet("a", { t: Date.now() + 1, p: "ABC234", r: "district:d1", x: 1.5 }), Date.now() + 1);
    expect(usePresenceStore.getState().partyPeers).toBe(before);
    expect(before.a?.x).toBe(1.5);
    expect(before.a?.buffer.samples).toHaveLength(2);
    s.applyPartyPacket(packet("a", { t: Date.now() + 2, p: "ABC234", r: "district:d2", x: 1.6 }), Date.now() + 2);
    expect(usePresenceStore.getState().partyPeers).not.toBe(before);
    expect(usePresenceStore.getState().partyPeers.a).toMatchObject({ room: "district:d2", x: 1.6 });
    vi.advanceTimersByTime(DESPAWN_MS + 10);
    expect(s.prune(Date.now())).toEqual(["a"]);
    expect(selectPartyMemberCount(usePresenceStore.getState())).toBe(1);
  });

  it("caps party members", () => {
    const s = usePresenceStore.getState();
    s.setMe({ partyCode: "ABC234" });
    for (let i = 0; i < 40; i++) s.applyPartyPacket(packet(`m${i}`, { p: "ABC234" }), Date.now() + i * 1000);
    expect(Object.keys(usePresenceStore.getState().partyPeers)).toHaveLength(MAX_PARTY_PEERS);
  });

  it("draws a party member from the party channel only when nearby on the street in another room", () => {
    const s = usePresenceStore.getState();
    s.setMe({ partyCode: "ABC234" });
    s.applyPartyPacket(packet("a", { p: "ABC234", r: "district:d2", x: 0, z: -41 }), Date.now());
    const member = usePresenceStore.getState().partyPeers.a!;
    expect(seenAcrossRooms(member, "district:d1", 0, -38)).toBe(true);
    expect(seenAcrossRooms(member, "district:d2", 0, -38)).toBe(false);
    expect(seenAcrossRooms(member, "interior:p1", 0, 5000)).toBe(false);
    expect(seenAcrossRooms(member, "district:d1", 0, -41 + PARTY_CROSS_ROOM_RADIUS_M + 1)).toBe(false);
    expect(partyNearbyElsewhere(usePresenceStore.getState(), "district:d1", 0, -38)).toBe(true);
    s.setMe({ partyCode: null });
    expect(partyNearbyElsewhere(usePresenceStore.getState(), "district:d1", 0, -38)).toBe(false);
  });
});
