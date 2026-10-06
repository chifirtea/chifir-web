import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESPAWN_MS } from "./interpolation";
import { MEMBERSHIP_GRACE_MS, selectPartyMemberCount, selectRoomCount, usePresenceStore } from "./presenceStore";
import { MAX_PACKETS_PER_SECOND, type PresencePacket } from "./transport";

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

  it("ignores our own packets and stale sender timestamps", () => {
    const s = usePresenceStore.getState();
    expect(s.applyPacket(packet("me"), Date.now())).toBe(false);
    const t = Date.now();
    expect(s.applyPacket(packet("a", { t }), t)).toBe(true);
    expect(s.applyPacket(packet("a", { t: t - 50, x: 99 }), t + 10)).toBe(false);
    expect(usePresenceStore.getState().peers.a?.buffer.samples).toHaveLength(1);
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
    expect(usePresenceStore.getState().partyPeers.a).toMatchObject({ room: "district:d1", x: 1, z: 2 });
    expect(selectPartyMemberCount(usePresenceStore.getState())).toBe(2);
    vi.advanceTimersByTime(DESPAWN_MS + 1);
    expect(s.prune(Date.now())).toEqual(["a"]);
    expect(selectPartyMemberCount(usePresenceStore.getState())).toBe(1);
  });
});
