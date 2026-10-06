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

const noop = () => {};

export class SupabaseTransport implements PresenceTransport {
  readonly kind = "supabase" as const;
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly client: SupabaseClient,
    readonly room: string,
  ) {}

  join(self: PeerMeta, handlers: TransportHandlers): Promise<JoinResult> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ ok, kind: this.kind });
      };

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
          if (packet && packet.id !== self.id) handlers.onPacket(packet);
        })
        .on("presence", { event: "sync" }, () => {
          if (!handlers.onMembers) return;
          const ids = Object.keys(channel.presenceState()).filter((id) => id !== self.id);
          handlers.onMembers(ids);
        })
        .on("presence", { event: "join" }, ({ key }) => {
          if (key !== self.id) handlers.onJoin?.(key);
        })
        .on("presence", { event: "leave" }, ({ key }) => {
          if (key !== self.id) handlers.onLeave(key);
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

      timer = setTimeout(() => settle(false), JOIN_TIMEOUT_MS);
    });
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
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    this.client.removeChannel(channel).catch(noop);
  }
}
