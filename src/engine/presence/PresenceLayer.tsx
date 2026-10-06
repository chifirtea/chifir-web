"use client";

import { usePresence } from "@/lib/presence/usePresence";
import { RemoteAvatars } from "./RemoteAvatars";

/**
 * Remote players in the current room (interpolated avatars + name tags). Mounted inside the
 * canvas by CityApp: the hook owns the transport session, the children draw whoever is here.
 * Renders nothing while alone.
 */
export function PresenceLayer() {
  usePresence();
  return <RemoteAvatars />;
}
