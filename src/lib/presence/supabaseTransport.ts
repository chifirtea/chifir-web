import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { channelName } from "./rooms";
import {
  decodePacket,
  type JoinResult,
  type PeerMeta,
  type PresencePacket,
  type PresenceTransport,
  type TransportHandlers,
} from "./transport";

/**
 * Supabase Realtime presence: Presence for membership (who is in the room, keyed by peer id),
 * Broadcast for the 10 Hz pose packets. Channels are public: presence is cosmetic, carries no
 * account data and never touches commerce, so the anon key is all a client needs. `subscribe`
 * failures resolve `ok: false` and the caller falls back to the BroadcastChannel transport.
 */

/** Longest we wait for the server before giving up on this transport. */
const JOIN_TIMEOUT_MS = 8000;
const POS_EVENT = "pos";
/**
 * A pose from an id that is not (yet) in the room's Presence is held this long: a peer's first
 * broadcast can beat its presence join to us. Anything else from a non-member is dropped, so a
 * public channel cannot be filled with ids nobody tracked.
 */
const HOLD_MS = 2000;
const MAX_HELD = 32;

const noop = () => {};

/**
 * Topics whose channel is still leaving, per client. realtime-js returns the leaving channel from
 * `channel()` for the same topic (and its `subscribe` never calls back), and drops every channel
 * of a topic from its list when the old one closes; a rejoin (an edge crossed and crossed back,
 * a page restored from the back/forward cache) therefore waits for the leave to finish.
 */
const leaving = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

function leavesOf(client: SupabaseClient): Map<string, Promise<void>> {
  let map = leaving.get(client);
  if (!map) {
    map = new Map();
    leaving.set(client, map);
  }
  return map;
}

export class SupabaseTransport implements PresenceTransport {
  readonly kind = "supabase" as const;
  private channel: RealtimeChannel | null = null;
  private closed = false;
  /** Presence keys (peer ids) currently in the room. */
  private readonly members = new Set<string>();
  private readonly held = new Map<string, { packet: PresencePacket; at: number }>();

  constructor(
    private readonly client: SupabaseClient,
    readonly room: string,
  ) {}

  private get topic(): string {
    return `realtime:${channelName(this.room)}`;
  }

  join(self: PeerMeta, handlers: TransportHandlers): Promise<JoinResult> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, kind: this.kind });
      };
      const timer = setTimeout(() => settle(false), JOIN_TIMEOUT_MS);
      this.clearTopic().then(
        () => {
          if (settled || this.closed) settle(false);
          else this.subscribe(self, handlers, settle);
        },
        () => settle(false),
      );
    });
  }

  /** Waits out our own pending leave of this topic, then removes any channel still holding it. */
  private async clearTopic(): Promise<void> {
    await leavesOf(this.client).get(this.topic);
    const stale = this.client.getChannels().find((c) => c.topic === this.topic);
    if (stale) await this.client.removeChannel(stale).catch(noop);
  }

  private subscribe(self: PeerMeta, handlers: TransportHandlers, settle: (ok: boolean) => void): void {
    let channel: RealtimeChannel;
    try {
      channel = this.client.channel(channelName(this.room), {
        config: { presence: { key: self.id }, broadcast: { self: false, ack: false } },
      });
    } catch {
      settle(false);
      return;
    }
    this.channel = channel;

    channel
      .on("broadcast", { event: POS_EVENT }, (message) => {
        const packet = decodePacket((message as { payload?: unknown }).payload);
        if (!packet || packet.id === self.id) return;
        if (this.members.has(packet.id)) handlers.onPacket(packet);
        else this.hold(packet);
      })
      .on("presence", { event: "sync" }, () => {
        const ids = Object.keys(channel.presenceState()).filter((id) => id !== self.id);
        this.members.clear();
        for (const id of ids) {
          this.members.add(id);
          this.release(id, handlers);
        }
        handlers.onMembers?.(ids);
      })
      .on("presence", { event: "join" }, ({ key }) => {
        if (key === self.id) return;
        this.members.add(key);
        this.release(key, handlers);
        handlers.onJoin?.(key);
      })
      .on("presence", { event: "leave" }, ({ key, currentPresences }) => {
        // A key can carry several presences (the same tab reconnecting); gone means none left.
        if (key === self.id || (currentPresences?.length ?? 0) > 0) return;
        this.members.delete(key);
        this.held.delete(key);
        handlers.onLeave(key);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track(self).catch(noop);
          settle(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Before the first join this means the transport is unusable; afterwards the client
          // reconnects on its own and re-tracks presence on rejoin.
          settle(false);
        }
      });
  }

  /** Keeps the newest pose of a not-yet-member for `HOLD_MS`, at most `MAX_HELD` ids. */
  private hold(packet: PresencePacket): void {
    const now = Date.now();
    for (const [id, entry] of this.held) if (now - entry.at > HOLD_MS) this.held.delete(id);
    if (!this.held.has(packet.id) && this.held.size >= MAX_HELD) return;
    this.held.set(packet.id, { packet, at: now });
  }

  private release(id: string, handlers: TransportHandlers): void {
    const entry = this.held.get(id);
    if (!entry) return;
    this.held.delete(id);
    if (Date.now() - entry.at <= HOLD_MS) handlers.onPacket(entry.packet);
  }

  publish(packet: PresencePacket): void {
    const channel = this.channel;
    if (!channel || channel.state !== "joined") return;
    channel.send({ type: "broadcast", event: POS_EVENT, payload: packet }).catch(noop);
  }

  updateMeta(self: PeerMeta): void {
    const channel = this.channel;
    if (!channel || channel.state !== "joined") return;
    channel.track(self).catch(noop);
  }

  leave(): void {
    this.closed = true;
    this.members.clear();
    this.held.clear();
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    const leaves = leavesOf(this.client);
    const topic = channel.topic;
    const done: Promise<void> = this.client
      .removeChannel(channel)
      .then(noop, noop)
      .finally(() => {
        if (leaves.get(topic) === done) leaves.delete(topic);
      });
    leaves.set(topic, done);
  }
}
