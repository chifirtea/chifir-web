import type { SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseAuth } from "@/lib/env";
import { loadBrowserSupabase } from "@/lib/supabase/browser";
import { BroadcastChannelTransport } from "./broadcastChannelTransport";
import type { ConnectFn } from "./controller";
import { SupabaseTransport } from "./supabaseTransport";
import { TRANSPORT_RETRY_MS, type PresenceTransport } from "./transport";

/**
 * Picks the transport for a room: Supabase Realtime when the public Supabase env is configured
 * and the channel subscribes, otherwise the same-origin BroadcastChannel. The fallback is silent
 * by design; `presence_joined.transport` records which one carried the room, and the controller
 * keeps trying to move a fallback room back onto Supabase (`upgrade`).
 */

/**
 * After Supabase fails to subscribe, new rooms skip it for this long instead of waiting out the
 * join timeout again on every district change. Rooms already on the fallback retry on the same
 * cadence through `upgrade`.
 */
export const SUPABASE_RETRY_AFTER_MS = TRANSPORT_RETRY_MS;

export interface ConnectorDeps {
  /** A network transport is configured at all (the public Supabase env is present). */
  remoteConfigured: boolean;
  /** The browser client (loaded on demand), or null when Supabase is not configured. */
  client: () => SupabaseClient | null | Promise<SupabaseClient | null>;
  remote: (client: SupabaseClient, room: string) => PresenceTransport;
  local: (room: string) => PresenceTransport;
  now: () => number;
}

export interface Connector {
  connect: ConnectFn;
  /** The network transport alone, for a room that fell back; null when none is configured. */
  upgrade: ConnectFn | null;
}

export function createConnector(deps: ConnectorDeps): Connector {
  let remoteRetryAt = 0;

  const remote: ConnectFn = async (room, self, handlers) => {
    let client: SupabaseClient | null = null;
    try {
      client = await deps.client();
    } catch {
      client = null;
    }
    if (!client) return null;
    const transport = deps.remote(client, room);
    let ok = false;
    try {
      ok = (await transport.join(self, handlers)).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      remoteRetryAt = 0;
      return transport;
    }
    transport.leave();
    remoteRetryAt = deps.now() + SUPABASE_RETRY_AFTER_MS;
    return null;
  };

  const connect: ConnectFn = async (room, self, handlers) => {
    if (deps.remoteConfigured && deps.now() >= remoteRetryAt) {
      const transport = await remote(room, self, handlers);
      if (transport) return transport;
    }
    const local = deps.local(room);
    const result = await local.join(self, handlers);
    return result.ok ? local : null;
  };

  return { connect, upgrade: deps.remoteConfigured ? remote : null };
}

export const presenceConnector: Connector = createConnector({
  remoteConfigured: hasSupabaseAuth,
  client: () => (hasSupabaseAuth ? loadBrowserSupabase() : null),
  remote: (client, room) => new SupabaseTransport(client, room),
  local: (room) => new BroadcastChannelTransport(room),
  now: () => Date.now(),
});
