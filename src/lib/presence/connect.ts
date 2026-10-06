import { hasSupabaseAuth } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { BroadcastChannelTransport } from "./broadcastChannelTransport";
import { SupabaseTransport } from "./supabaseTransport";
import type { PeerMeta, PresenceTransport, TransportHandlers } from "./transport";

/**
 * Picks the transport for a room: Supabase Realtime when the public Supabase env is configured
 * and the channel subscribes, otherwise the same-origin BroadcastChannel. The fallback is silent
 * by design; `presence_joined.transport` records which one carried the room.
 */
export async function connectRoom(
  room: string,
  self: PeerMeta,
  handlers: TransportHandlers,
): Promise<PresenceTransport | null> {
  const supabase = hasSupabaseAuth ? getBrowserSupabase() : null;
  if (supabase) {
    const transport = new SupabaseTransport(supabase, room);
    try {
      const result = await transport.join(self, handlers);
      if (result.ok) return transport;
    } catch {
      // fall through to the local transport
    }
    transport.leave();
  }
  const local = new BroadcastChannelTransport(room);
  const result = await local.join(self, handlers);
  return result.ok ? local : null;
}
