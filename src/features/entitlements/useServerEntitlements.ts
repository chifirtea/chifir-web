"use client";

import { useEffect } from "react";
import type { DigitalReward } from "@/types/domain";
import { useUser } from "@/features/auth/useUser";
import { useEntitlementStore } from "./entitlementStore";

export interface EntitlementsResponse {
  rewards: DigitalReward[];
}

/** Merges the signed-in user's server grants into the local store once per sign-in. */
export function useServerEntitlements(): void {
  const { user } = useUser();
  const merge = useEntitlementStore((s) => s.mergeFromServer);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch("/api/me/entitlements", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as EntitlementsResponse;
        if (Array.isArray(data.rewards)) merge(data.rewards);
      })
      .catch(() => {
        // Offline or signed out mid-flight: local grants still apply.
      });
    return () => controller.abort();
  }, [user, merge]);
}
