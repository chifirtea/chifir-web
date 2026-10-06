import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseAuth } from "@/lib/env";
import { loadBrowserSupabase } from "@/lib/supabase/browser";
import { BroadcastChannelTransport } from "./broadcastChannelTransport";
import type { ConnectFn } from "./controller";
import { SupabaseTransport } from "./supabaseTransport";
import type { PresenceTransport } from "./transport";

/**
 * Picks the transport for a room: Supabase Realtime when the public Supabase env is configured
 * and the channel subscribes, otherwise the same-origin BroadcastChannel. The fallback is silent
 * by design; `presence_joined.transport` records which one carried the room.
 */

/**
 * After Supabase fails to subscribe, rooms skip it for this long instead of waiting out the join
 * timeout again on every district change.
 */
export const SUPABASE_RETRY_AFTER_MS = 60_000;

export interface ConnectorDeps {
  /** The browser client (loaded on demand), or null when Supabase is not configured. */
  client: () => SupabaseClient | null | Promise<SupabaseClient | null>;
  remote: (client: SupabaseClient, room: string) => PresenceTransport;
  local: (room: string) => PresenceTransport;
  now: () => number;
}

export function createConnector(deps: ConnectorDeps): ConnectFn {
  let remoteRetryAt = 0;
  return async (room, self, handlers) => {
    const client = deps.now() >= remoteRetryAt ? await deps.client() : null;
    if (client) {
      const remote = deps.remote(client, room);
      let ok = false;
      try {
        ok = (await remote.join(self, handlers)).ok;
      } catch {
        ok = false;
      }
      if (ok) return remote;
      remote.leave();
      remoteRetryAt = deps.now() + SUPABASE_RETRY_AFTER_MS;
    }
    const local = deps.local(room);
    const result = await local.join(self, handlers);
    return result.ok ? local : null;
  };
}

export const connectRoom: ConnectFn = createConnector({
  client: () => (hasSupabaseAuth ? loadBrowserSupabase() : null),
  remote: (client, room) => new SupabaseTransport(client, room),
  local: (room) => new BroadcastChannelTransport(room),
  now: () => Date.now(),
});
