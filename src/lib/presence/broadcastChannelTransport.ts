import { channelName } from "./rooms";
import {
  decodePacket,
  decodePeerMeta,
  type JoinResult,
  type PeerMeta,
  type PresencePacket,
  type PresenceTransport,
  type TransportHandlers,
} from "./transport";

/**
 * Same-origin presence for tabs of one browser (local development, static preview, e2e). One
 * `BroadcastChannel` per room; messages are the same validated packets the network transport
 * carries, so the rest of the stack cannot tell the two apart.
 */

type Message =
  | { k: "pos"; p: unknown }
  | { k: "join"; m: unknown }
  | { k: "leave"; id: unknown };

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const k = (value as { k?: unknown }).k;
  return k === "pos" || k === "join" || k === "leave";
}

export class BroadcastChannelTransport implements PresenceTransport {
  readonly kind = "broadcast" as const;
  private channel: BroadcastChannel | null = null;
  private self: PeerMeta | null = null;
  private handlers: TransportHandlers | null = null;

  constructor(readonly room: string) {}

  join(self: PeerMeta, handlers: TransportHandlers): Promise<JoinResult> {
    if (typeof BroadcastChannel === "undefined") return Promise.resolve({ ok: false, kind: this.kind });
    this.self = self;
    this.handlers = handlers;
    try {
      const channel = new BroadcastChannel(channelName(this.room));
      channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
      this.channel = channel;
      this.post({ k: "join", m: self });
      return Promise.resolve({ ok: true, kind: this.kind });
    } catch {
      this.channel = null;
      return Promise.resolve({ ok: false, kind: this.kind });
    }
  }

  publish(packet: PresencePacket): void {
    this.post({ k: "pos", p: packet });
  }

  updateMeta(self: PeerMeta): void {
    this.self = self;
  }

  leave(): void {
    const channel = this.channel;
    if (!channel) return;
    if (this.self) this.post({ k: "leave", id: this.self.id });
    this.channel = null;
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Already closed.
    }
  }

  private post(message: Message): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closing channel or an unserialisable payload must never reach the frame loop.
    }
  }

  private receive(data: unknown): void {
    const handlers = this.handlers;
    const self = this.self;
    if (!handlers || !self || !isMessage(data)) return;
    switch (data.k) {
      case "pos": {
        const packet = decodePacket(data.p);
        if (packet && packet.id !== self.id) handlers.onPacket(packet);
        return;
      }
      case "join": {
        const meta = decodePeerMeta(data.m);
        if (meta && meta.id !== self.id) handlers.onJoin?.(meta.id);
        return;
      }
      case "leave": {
        const id = data.id;
        if (typeof id === "string" && id.length > 0 && id.length <= 40 && id !== self.id) handlers.onLeave(id);
        return;
      }
    }
  }
}
