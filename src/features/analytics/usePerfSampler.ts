"use client";

import { useEffect } from "react";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";

const DEFAULT_INTERVAL_MS = 20_000;

/**
 * Counts rendered frames and emits `perf_sample { fps, dpr, tier }` every `intervalMs` while the
 * tab is visible and the city is ready. Windows that overlap loading are discarded so the first
 * sample is honest.
 */
export function usePerfSampler(intervalMs = DEFAULT_INTERVAL_MS): void {
  useEffect(() => {
    let raf = 0;
    let running = false;
    let frames = 0;
    let windowStart = 0;
    let readyAtWindowStart = false;

    const resetWindow = (t: number) => {
      frames = 0;
      windowStart = t;
      readyAtWindowStart = useWorldStore.getState().ready;
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      frames += 1;
      const elapsed = t - windowStart;
      if (elapsed < intervalMs) return;
      if (readyAtWindowStart && useWorldStore.getState().ready) {
        const { settings } = useQualityStore.getState();
        const rawDpr = typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;
        const dpr = Math.round(Math.min(rawDpr, settings.dpr[1]) * 100) / 100;
        track("perf_sample", { fps: Math.round((frames * 1000) / elapsed), dpr, tier: settings.tier });
      }
      resetWindow(t);
    };

    const start = () => {
      if (running) return;
      running = true;
      resetWindow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
