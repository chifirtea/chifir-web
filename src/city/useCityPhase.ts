"use client";

import { useEffect } from "react";
import { nextPhaseChangeAt } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import { useCityStore } from "./cityStore";

/**
 * Rebuilds the city index the instant an event starts or ends or a pop-up tenancy opens or
 * closes, so storefronts, hotspots, availability and countdowns flip together. Sleeps until the
 * next boundary (capped so a suspended tab catches up quickly after waking).
 */
const MAX_SLEEP_MS = 60_000;

export function useCityPhaseTicker(): void {
  const index = useCityStore((s) => s.index);
  const refreshIndex = useCityStore((s) => s.refreshIndex);
  useEffect(() => {
    if (!index) return;
    const now = clockNow();
    const next = nextPhaseChangeAt(index.snapshot.events, index.snapshot.parcels, now);
    if (next === null) return;
    const delay = Math.min(MAX_SLEEP_MS, Math.max(50, next - now + 20));
    const timer = setTimeout(() => refreshIndex(clockNow()), delay);
    return () => clearTimeout(timer);
  }, [index, refreshIndex]);
}
