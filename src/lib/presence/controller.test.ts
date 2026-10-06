import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceController, type TickInput } from "./controller";
import { MEMBERSHIP_GRACE_MS, usePresenceStore, type Identity } from "./presenceStore";
import type { PeerMeta, PresencePacket, PresenceTransport, TransportHandlers, TransportKind } from "./transport";

class FakeTransport implements PresenceTransport {
  published: PresencePacket[] = [];
  metas: PeerMeta[] = [];
  left = false;
  handlers: TransportHandlers | null = null;
  constructor(
    readonly room: string,
    readonly kind: TransportKind = "broadcast",
  ) {}
  join(self: PeerMeta, handlers: TransportHandlers) {
    this.handlers = handlers;
    this.metas.push(self);
    return Promise.resolve({ ok: true, kind: this.kind });
  }
  publish(packet: PresencePacket) {
    this.published.push(packet);
  }
  updateMeta(self: PeerMeta) {
    this.metas.push(self);
  }
  leave() {
    this.left = true;
  }
}

const me: Identity = {
  peerId: "me1234",
  name: "Citizen ABC",
  bodyColor: "#8a5a44",
  hairColor: "#1a120e",
  outfit: null,
  partyCode: null,
};

const input = (overrides: Partial<TickInput> = {}): TickInput => ({
  ready: true,
  hidden: false,
  room: "district:d1",
  x: 0,
  z: 21,
  yaw: Math.PI,
  moving: false,
  me,
  ...overrides,
});

describe("PresenceController", () => {
  const transports: FakeTransport[] = [];
  const joined: Array<{ room: string; transport: TransportKind }> = [];
  let controller: PresenceController;
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    transports.length = 0;
    joined.length = 0;
    const store = usePresenceStore.getState();
    store.setRoom(null, null);
    store.clearPartyPeers();
    store.setMe(me);
    controller = new PresenceController({
      connect: (room, self, handlers) => {
        const t = new FakeTransport(room);
        transports.push(t);
        return t.join(self, handlers).then(() => t);
      },
      store,
      now: Date.now,
      onRoomJoined: (room, transport) => joined.push({ room, transport }),
    });
  });
  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it("does nothing before the city is ready or without an identity", async () => {
    controller.tick(input({ ready: false }));
    controller.tick(input({ me: { ...me, peerId: "" } }));
    await flush();
    expect(transports).toHaveLength(0);
  });

  it("joins the location's room, announces once, then heartbeats every second", async () => {
    controller.tick(input());
    expect(usePresenceStore.getState().room).toBe("district:d1");
    await flush();
    expect(transports.map((t) => t.room)).toEqual(["district:d1"]);
    expect(joined).toEqual([{ room: "district:d1", transport: "broadcast" }]);
    expect(usePresenceStore.getState().transport).toBe("broadcast");

    const t = transports[0]!;
    controller.tick(input());
    expect(t.published).toHaveLength(1);
    expect(t.published[0]).toMatchObject({ id: "me1234", x: 0, z: 21, m: 0, n: "Citizen ABC", a: { b: "#8a5a44", h: "#1a120e" } });
    expect(t.published[0]).not.toHaveProperty("p");
    expect(t.published[0]).not.toHaveProperty("r");

    // Standing still: nothing for 900 ms, then a heartbeat.
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(100);
      controller.tick(input());
    }
    expect(t.published).toHaveLength(1);
    vi.advanceTimersByTime(100);
    controller.tick(input());
    expect(t.published).toHaveLength(2);
  });

  it("publishes on movement beyond 2 cm or 1° but not below", async () => {
    controller.tick(input());
    await flush();
    const t = transports[0]!;
    controller.tick(input());
    expect(t.published).toHaveLength(1);
    vi.advanceTimersByTime(100);
    controller.tick(input({ x: 0.01 }));
    expect(t.published).toHaveLength(1);
    vi.advanceTimersByTime(100);
    controller.tick(input({ x: 0.05, moving: true }));
    expect(t.published).toHaveLength(2);
    expect(t.published[1]).toMatchObject({ x: 0.05, m: 1 });
    vi.advanceTimersByTime(100);
    controller.tick(input({ x: 0.05, yaw: Math.PI + 0.01 }));
    expect(t.published).toHaveLength(2);
    vi.advanceTimersByTime(100);
    controller.tick(input({ x: 0.05, yaw: Math.PI + 0.05 }));
    expect(t.published).toHaveLength(3);
  });

  it("stops publishing while hidden and re-announces when nudged", async () => {
    controller.tick(input());
    await flush();
    const t = transports[0]!;
    controller.tick(input());
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(100);
      controller.tick(input({ hidden: true, x: i }));
    }
    expect(t.published).toHaveLength(1);
    controller.nudge();
    vi.advanceTimersByTime(100);
    controller.tick(input());
    expect(t.published).toHaveLength(2);
  });

  it("switches rooms with a leave + join and clears the old peers", async () => {
    controller.tick(input());
    await flush();
    const first = transports[0]!;
    first.handlers!.onPacket({ t: Date.now(), id: "friend", x: 1, z: 1, yaw: 0, m: 0, a: { b: "#000000", h: "#ffffff" }, n: "Friend" });
    expect(Object.keys(usePresenceStore.getState().peers)).toEqual(["friend"]);

    controller.tick(input({ room: "interior:p1", x: 3, z: 5003 }));
    expect(first.left).toBe(true);
    expect(usePresenceStore.getState().peers).toEqual({});
    expect(usePresenceStore.getState().room).toBe("interior:p1");
    await flush();
    expect(transports.map((t) => t.room)).toEqual(["district:d1", "interior:p1"]);
    expect(joined).toHaveLength(2);
  });

  it("applies inbound packets, leaves and membership through the store", async () => {
    controller.tick(input());
    await flush();
    const h = transports[0]!.handlers!;
    const base = { yaw: 0, m: 0 as const, a: { b: "#000000", h: "#ffffff" } };
    h.onPacket({ t: Date.now(), id: "a", x: 1, z: 1, n: "A", ...base });
    h.onPacket({ t: Date.now(), id: "b", x: 2, z: 2, n: "B", ...base });
    expect(Object.keys(usePresenceStore.getState().peers).sort()).toEqual(["a", "b"]);
    h.onLeave("a");
    expect(Object.keys(usePresenceStore.getState().peers)).toEqual(["b"]);
    // Membership that does not list a peer drops it once its packets are no longer fresh.
    h.onMembers?.([]);
    expect(Object.keys(usePresenceStore.getState().peers)).toEqual(["b"]);
    vi.advanceTimersByTime(MEMBERSHIP_GRACE_MS + 1);
    h.onMembers?.([]);
    expect(usePresenceStore.getState().peers).toEqual({});
  });

  it("opens the party channel while in a party and sends coarse packets with the room", async () => {
    controller.tick(input());
    await flush();
    controller.tick(input({ me: { ...me, partyCode: "ABC234" } }));
    await flush();
    expect(transports.map((t) => t.room)).toEqual(["district:d1", "party:ABC234"]);
    const party = transports[1]!;
    const room = transports[0]!;
    // The meta change re-announced on the room channel at once, with the party code.
    expect(room.published.at(-1)).toMatchObject({ p: "ABC234" });
    expect(room.metas.at(-1)).toMatchObject({ p: "ABC234" });
    controller.tick(input({ me: { ...me, partyCode: "ABC234" } }));
    expect(party.published).toHaveLength(1);
    expect(party.published[0]).toMatchObject({ p: "ABC234", r: "district:d1" });

    // Small moves do not hit the party channel; half a metre does, at most twice a second.
    vi.advanceTimersByTime(100);
    controller.tick(input({ x: 0.1, me: { ...me, partyCode: "ABC234" } }));
    expect(party.published).toHaveLength(1);
    vi.advanceTimersByTime(400);
    controller.tick(input({ x: 0.8, me: { ...me, partyCode: "ABC234" } }));
    expect(party.published).toHaveLength(2);

    // Leaving the party closes the channel and forgets the members. (In the app the identity in
    // the store and the tick input are the same object; the test mirrors the code by hand.)
    usePresenceStore.getState().setMe({ partyCode: "ABC234" });
    party.handlers!.onPacket({ t: Date.now(), id: "friend", x: 1, z: 1, yaw: 0, m: 0, a: { b: "#000000", h: "#ffffff" }, n: "Friend", p: "ABC234" });
    expect(Object.keys(usePresenceStore.getState().partyPeers)).toEqual(["friend"]);
    usePresenceStore.getState().setMe({ partyCode: null });
    controller.tick(input());
    expect(party.left).toBe(true);
    expect(usePresenceStore.getState().partyPeers).toEqual({});
  });

  it("drops a transport whose join resolves after the room was already left", async () => {
    let resolveJoin: ((t: PresenceTransport | null) => void) | null = null;
    const late = new FakeTransport("district:d1");
    const slow = new PresenceController({
      connect: () => new Promise((resolve) => (resolveJoin = resolve)),
      store: usePresenceStore.getState(),
      now: Date.now,
      onRoomJoined: () => undefined,
    });
    slow.tick(input());
    slow.dispose();
    resolveJoin!(late);
    await flush();
    expect(late.left).toBe(true);
  });

  it("suspends (page hidden for good or cached) and rejoins on the next tick", async () => {
    controller.tick(input());
    await flush();
    controller.suspend();
    expect(transports[0]!.left).toBe(true);
    expect(usePresenceStore.getState().room).toBeNull();
    controller.tick(input());
    await flush();
    expect(transports.map((t) => t.room)).toEqual(["district:d1", "district:d1"]);
    expect(usePresenceStore.getState().room).toBe("district:d1");
  });

  it("leaves everything on dispose", async () => {
    controller.tick(input({ me: { ...me, partyCode: "ABC234" } }));
    await flush();
    controller.dispose();
    expect(transports.every((t) => t.left)).toBe(true);
    expect(usePresenceStore.getState().room).toBeNull();
  });
});
