import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createConnector, SUPABASE_RETRY_AFTER_MS } from "./connect";
import type { PeerMeta, PresenceTransport, TransportHandlers, TransportKind } from "./transport";

class StubTransport implements PresenceTransport {
  left = false;
  joins = 0;
  constructor(
    readonly kind: TransportKind,
    readonly room: string,
    private readonly outcome: "ok" | "fail" | "throw",
  ) {}
  join() {
    this.joins += 1;
    if (this.outcome === "throw") return Promise.reject(new Error("socket"));
    return Promise.resolve({ ok: this.outcome === "ok", kind: this.kind });
  }
  publish() {}
  updateMeta() {}
  leave() {
    this.left = true;
  }
}

const self: PeerMeta = { id: "me", n: "Me", a: { b: "#000000", h: "#ffffff" } };
const handlers: TransportHandlers = { onPacket: () => {}, onLeave: () => {} };
const client = {} as SupabaseClient;

function setup(remoteOutcome: "ok" | "fail" | "throw", configured = true) {
  let clock = 1_000;
  const remotes: StubTransport[] = [];
  const locals: StubTransport[] = [];
  const connect = createConnector({
    client: () => (configured ? client : null),
    remote: (_c, room) => {
      const t = new StubTransport("supabase", room, remoteOutcome);
      remotes.push(t);
      return t;
    },
    local: (room) => {
      const t = new StubTransport("broadcast", room, "ok");
      locals.push(t);
      return t;
    },
    now: () => clock,
  });
  return { connect, remotes, locals, advance: (ms: number) => (clock += ms) };
}

describe("connectRoom", () => {
  it("uses Supabase Realtime when configured and the channel subscribes", async () => {
    const { connect, locals } = setup("ok");
    const t = await connect("district:d1", self, handlers);
    expect(t?.kind).toBe("supabase");
    expect(locals).toHaveLength(0);
  });

  it("uses BroadcastChannel when Supabase is not configured", async () => {
    const { connect, remotes } = setup("ok", false);
    expect((await connect("district:d1", self, handlers))?.kind).toBe("broadcast");
    expect(remotes).toHaveLength(0);
  });

  it("falls back silently when the subscribe fails or throws, and leaves the dead channel", async () => {
    for (const outcome of ["fail", "throw"] as const) {
      const { connect, remotes } = setup(outcome);
      const t = await connect("district:d1", self, handlers);
      expect(t?.kind).toBe("broadcast");
      expect(remotes[0]?.left).toBe(true);
    }
  });

  it("skips Supabase for a while after a failure instead of timing out on every room", async () => {
    const { connect, remotes, advance } = setup("fail");
    await connect("district:d1", self, handlers);
    await connect("district:d2", self, handlers);
    expect(remotes).toHaveLength(1);
    advance(SUPABASE_RETRY_AFTER_MS);
    await connect("district:d3", self, handlers);
    expect(remotes).toHaveLength(2);
  });
});
