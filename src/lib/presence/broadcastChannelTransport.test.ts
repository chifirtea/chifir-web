import { describe, expect, it } from "vitest";
import { BroadcastChannelTransport } from "./broadcastChannelTransport";
import type { PeerMeta, PresencePacket, TransportHandlers } from "./transport";

const meta = (id: string): PeerMeta => ({ id, n: `Peer ${id}`, a: { b: "#8a5a44", h: "#1a120e" } });
const packet = (id: string): PresencePacket => ({ t: Date.now(), id, x: 1, z: 2, yaw: 0, m: 0, a: { b: "#8a5a44", h: "#1a120e" }, n: `Peer ${id}` });

/** Node ships `BroadcastChannel`; same-thread instances see each other asynchronously. */
const until = (test: () => boolean, ms = 1000) =>
  new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (test()) resolve();
      else if (Date.now() - started > ms) reject(new Error("timed out"));
      else setTimeout(poll, 5);
    };
    poll();
  });

function recorder() {
  const packets: PresencePacket[] = [];
  const joins: string[] = [];
  const leaves: string[] = [];
  const handlers: TransportHandlers = {
    onPacket: (p) => packets.push(p),
    onJoin: (id) => joins.push(id),
    onLeave: (id) => leaves.push(id),
  };
  return { packets, joins, leaves, handlers };
}

describe("BroadcastChannelTransport", () => {
  it("delivers join, packets and leave between two tabs of one room, filtering self", async () => {
    const room = `test-${Math.random().toString(36).slice(2)}`;
    const a = new BroadcastChannelTransport(room);
    const b = new BroadcastChannelTransport(room);
    const ra = recorder();
    const rb = recorder();
    expect(await a.join(meta("a"), ra.handlers)).toEqual({ ok: true, kind: "broadcast" });
    expect(await b.join(meta("b"), rb.handlers)).toEqual({ ok: true, kind: "broadcast" });
    await until(() => ra.joins.includes("b"));
    expect(ra.joins).toEqual(["b"]);
    expect(rb.joins).toEqual([]); // a joined before b was listening

    b.publish(packet("b"));
    a.publish(packet("a"));
    await until(() => ra.packets.length === 1 && rb.packets.length === 1);
    expect(ra.packets[0]?.id).toBe("b");
    expect(rb.packets[0]?.id).toBe("a");

    b.leave();
    await until(() => ra.leaves.includes("b"));
    a.leave();
  });

  it("drops malformed messages and is isolated per room", async () => {
    const room = `test-${Math.random().toString(36).slice(2)}`;
    const a = new BroadcastChannelTransport(room);
    const other = new BroadcastChannelTransport(`${room}-other`);
    const ra = recorder();
    await a.join(meta("a"), ra.handlers);
    await other.join(meta("o"), recorder().handlers);
    other.publish(packet("o"));
    // Raw channel on the same name: junk must be ignored.
    const raw = new BroadcastChannel(`chifir.presence.v1:${room}`);
    raw.postMessage({ k: "pos", p: { id: "x", bogus: true } });
    raw.postMessage("garbage");
    raw.postMessage({ k: "leave", id: 42 });
    raw.postMessage({ k: "pos", p: packet("legit") });
    await until(() => ra.packets.length === 1);
    expect(ra.packets[0]?.id).toBe("legit");
    expect(ra.leaves).toEqual([]);
    raw.close();
    a.leave();
    other.leave();
  });
});
