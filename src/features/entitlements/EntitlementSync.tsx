"use client";

import { useServerEntitlements } from "./useServerEntitlements";

/** Mount once in the city: merges the signed-in user's rewards into the local entitlement store. */
export function EntitlementSync() {
  useServerEntitlements();
  return null;
}
