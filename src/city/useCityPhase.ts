"use client";

import { useEffect } from "react";
import { nextPhaseChangeAt } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import { useCityStore } from "./cityStore";

/**
 * Rebuilds the city index the instant an event starts or ends or a pop-up tenancy opens or
 * closes, so storefronts, hotspots, availability and countdowns flip together. Sleeps until the
 * next boundary (capped so a throttled timer cannot drift for hours) and catches up whenever the
 * tab becomes visible again.
 */
const MAX_SLEEP_MS = 3600_000;

export function useCityPhaseTicker(): void {
  const index = useCityStore((s) => s.index);
  const refreshIndex = useCityStore((s) => s.refreshIndex);
  useEffect(() => {
    if (!index) return;
    const now = clockNow();
    const next = nextPhaseChangeAt(index.snapshot.events, index.snapshot.parcels, now);
    const refreshIfStale = () => {
      const t = clockNow();
      const due = nextPhaseChangeAt(index.snapshot.events, index.snapshot.parcels, index.builtAt);
      if (due !== null && t >= due) refreshIndex(t);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (next === null) return () => document.removeEventListener("visibilitychange", onVisibility);
    const delay = Math.min(MAX_SLEEP_MS, Math.max(50, next - now + 20));
    const timer = setTimeout(() => refreshIndex(clockNow()), delay);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [index, refreshIndex]);
}
