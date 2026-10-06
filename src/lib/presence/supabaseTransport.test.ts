import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelName } from "./rooms";
import { SupabaseTransport } from "./supabaseTransport";
import type { PeerMeta, PresencePacket, TransportHandlers } from "./transport";

/**
 * A stand-in for the parts of realtime-js 2.117 the transport relies on, including the two
 * behaviours that bite on a quick rejoin: `channel()` hands back the existing channel of a topic
 * (even one that is leaving), `subscribe()` only joins a closed channel (otherwise it never calls
 * back), and closing a channel drops every channel of that topic from the client's list.
 */
type Binding = { type: string; event: string; cb: (payload: never) => void };

class FakeChannel {
  state: "closed" | "joining" | "joined" | "leaving" = "closed";
  readonly bindings: Binding[] = [];
  readonly tracked: unknown[] = [];
  presence: Record<string, unknown[]> = {};
  constructor(readonly topic: string) {}
  on(type: string, filter: { event: string }, cb: (payload: never) => void) {
    this.bindings.push({ type, event: filter.event, cb });
    return this;
  }
  subscribe(cb: (status: string) => void) {
    if (this.state !== "closed") return this;
    this.state = "joining";
    queueMicrotask(() => {
      this.state = "joined";
      cb("SUBSCRIBED");
    });
    return this;
  }
  track(meta: unknown) {
    this.tracked.push(meta);
    return Promise.resolve("ok");
  }
  send() {
    return Promise.resolve("ok");
  }
  presenceState() {
    return this.presence;
  }
  emit(type: string, event: string, payload: unknown) {
    for (const b of this.bindings) if (b.type === type && b.event === event) b.cb(payload as never);
  }
}

class FakeClient {
  channels: FakeChannel[] = [];
  readonly created: FakeChannel[] = [];
  private readonly removals: Array<() => void> = [];
  channel(name: string) {
    const topic = `realtime:${name}`;
    const existing = this.channels.find((c) => c.topic === topic);
    if (existing) return existing;
    const c = new FakeChannel(topic);
    this.channels.push(c);
    this.created.push(c);
    return c;
  }
  getChannels() {
    return this.channels;
  }
  removeChannel(c: FakeChannel) {
    c.state = "leaving";
    return new Promise<string>((resolve) =>
      this.removals.push(() => {
        c.state = "closed";
        this.channels = this.channels.filter((x) => x.topic !== c.topic);
        resolve("ok");
      }),
    );
  }
  finishRemovals() {
    for (const done of this.removals.splice(0)) done();
  }
}

const ROOM = "district:d1";
const self: PeerMeta = { id: "me", n: "Me", a: { b: "#000000", h: "#ffffff" } };
const pos = (id: string, x = 1): PresencePacket => ({ t: Date.now(), id, x, z: 2, yaw: 0, m: 0, a: { b: "#8a5a44", h: "#1a120e" }, n: id });

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function recorder() {
  const packets: string[] = [];
  const joins: string[] = [];
  const leaves: string[] = [];
  const members: string[][] = [];
  const handlers: TransportHandlers = {
    onPacket: (p) => packets.push(`${p.id}@${p.x}`),
    onJoin: (id) => joins.push(id),
    onLeave: (id) => leaves.push(id),
    onMembers: (ids) => members.push([...ids]),
  };
  return { handlers, packets, joins, leaves, members };
}

describe("SupabaseTransport", () => {
  let client: FakeClient;
  const asClient = () => client as unknown as SupabaseClient;

  beforeEach(() => {
    client = new FakeClient();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins, tracks its metadata and publishes once joined", async () => {
    const t = new SupabaseTransport(asClient(), ROOM);
    const result = await t.join(self, recorder().handlers);
    expect(result).toEqual({ ok: true, kind: "supabase" });
    expect(client.created[0]?.topic).toBe(`realtime:${channelName(ROOM)}`);
    expect(client.created[0]?.tracked).toEqual([self]);
  });

  it("re-entering a room while its channel is still leaving waits for the leave, then joins a fresh channel", async () => {
    const first = new SupabaseTransport(asClient(), ROOM);
    expect((await first.join(self, recorder().handlers)).ok).toBe(true);
    first.leave();

    const second = new SupabaseTransport(asClient(), ROOM);
    let done = false;
    const joining = second.join(self, recorder().handlers).then((r) => {
      done = true;
      return r;
    });
    await settle();
    // Neither the leaving channel was reused (it would never call back) nor a twin created
    // (closing the old one would drop it from the client too).
    expect(done).toBe(false);
    expect(client.created).toHaveLength(1);

    client.finishRemovals();
    expect((await joining).ok).toBe(true);
    expect(client.created).toHaveLength(2);
    expect(client.channels).toEqual([client.created[1]]);
    expect(client.created[1]?.state).toBe("joined");
  });

  it("removes a channel of the same topic that is still registered before joining", async () => {
    const stale = client.channel(channelName(ROOM));
    stale.state = "joined";
    const t = new SupabaseTransport(asClient(), ROOM);
    const joining = t.join(self, recorder().handlers);
    await settle();
    expect(stale.state).toBe("leaving");
    client.finishRemovals();
    expect((await joining).ok).toBe(true);
    expect(client.channels).toHaveLength(1);
    expect(client.channels[0]).not.toBe(stale);
  });

  it("gives up after the join timeout when the server never answers", async () => {
    vi.useFakeTimers();
    const stuck = client.channel(channelName(ROOM));
    stuck.subscribe = () => stuck; // never calls back
    client.getChannels = () => []; // ...and is not found as stale either
    const t = new SupabaseTransport(asClient(), ROOM);
    const joining = t.join(self, recorder().handlers);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await joining).toEqual({ ok: false, kind: "supabase" });
  });

  it("does not join after being left mid-join", async () => {
    const first = new SupabaseTransport(asClient(), ROOM);
    await first.join(self, recorder().handlers);
    first.leave();
    const second = new SupabaseTransport(asClient(), ROOM);
    const joining = second.join(self, recorder().handlers);
    second.leave();
    client.finishRemovals();
    expect((await joining).ok).toBe(false);
    expect(client.created).toHaveLength(1);
  });

  it("only passes poses from ids in the room's Presence, holding an early one briefly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const rec = recorder();
    const t = new SupabaseTransport(asClient(), ROOM);
    const joining = t.join(self, rec.handlers);
    await vi.advanceTimersByTimeAsync(0);
    expect((await joining).ok).toBe(true);
    const channel = client.created[0]!;

    // A pose that beats its sender's presence join is held, then released by the join.
    channel.emit("broadcast", "pos", { payload: pos("friend", 1) });
    expect(rec.packets).toEqual([]);
    channel.emit("presence", "join", { key: "friend", currentPresences: [{}], newPresences: [{}] });
    expect(rec.packets).toEqual(["friend@1"]);
    expect(rec.joins).toEqual(["friend"]);
    channel.emit("broadcast", "pos", { payload: pos("friend", 2) });
    expect(rec.packets).toEqual(["friend@1", "friend@2"]);

    // Ids nobody tracked never reach the store; one that shows up too late is not replayed.
    for (let i = 0; i < 500; i++) channel.emit("broadcast", "pos", { payload: pos(`fake${i}`) });
    vi.advanceTimersByTime(2500);
    channel.presence = { friend: [{}], fake1: [{}], me: [{}] };
    channel.emit("presence", "sync", {});
    expect(rec.packets).toEqual(["friend@1", "friend@2"]);
    expect(rec.members.at(-1)).toEqual(["friend", "fake1"]);

    // Malformed payloads and our own echo are dropped.
    channel.emit("broadcast", "pos", { payload: { ...pos("friend"), x: "nope" } });
    channel.emit("broadcast", "pos", { payload: pos("me") });
    expect(rec.packets).toHaveLength(2);

    // Leaving: only when no presence remains under that key.
    channel.emit("presence", "leave", { key: "friend", currentPresences: [{}], leftPresences: [{}] });
    expect(rec.leaves).toEqual([]);
    channel.emit("presence", "leave", { key: "friend", currentPresences: [], leftPresences: [{}] });
    expect(rec.leaves).toEqual(["friend"]);
    channel.emit("broadcast", "pos", { payload: pos("friend", 3) });
    expect(rec.packets).toHaveLength(2);
  });
});
