"use client";

import { useEffect, type ReactNode } from "react";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { flush, setAnalyticsDevice, track } from "@/lib/analytics/client";
import { usePerfSampler } from "./usePerfSampler";

const HEARTBEAT_S = 30;
const MAX_ERRORS_PER_SESSION = 5;

/**
 * Session-level analytics for the city: load timing, heartbeat, perf samples, and uncaught
 * errors. Mount once around the city app. Renders nothing of its own.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  usePerfSampler();

  useEffect(() => {
    const startedAt = performance.now();
    const cleanups: Array<() => void> = [];

    // Device context (attached to every record). Updated when the engine settles on a tier.
    const describeDevice = () =>
      setAnalyticsDevice({
        mobile: typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
        tier: useQualityStore.getState().settings.tier,
        ua: navigator.userAgent.slice(0, 300),
      });
    describeDevice();
    cleanups.push(
      useQualityStore.subscribe((s, prev) => {
        if (s.settings.tier !== prev.settings.tier) describeDevice();
      }),
    );

    track("app_loaded", { path: window.location.pathname });
    track("city_load_started", {});

    // Load → ready → first frame after ready.
    let completed = false;
    let raf = 0;
    const onReady = () => {
      if (completed) return;
      completed = true;
      track("city_load_completed", { ms: Math.round(performance.now() - startedAt) });
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          track("city_interactive", { ms: Math.round(performance.now() - startedAt) });
        });
      });
    };
    if (useWorldStore.getState().ready) onReady();
    cleanups.push(
      useWorldStore.subscribe((s, prev) => {
        if (s.ready && !prev.ready) onReady();
      }),
    );
    cleanups.push(() => cancelAnimationFrame(raf));

    // Heartbeat while visible.
    const heartbeat = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      track("session_heartbeat", { seconds: HEARTBEAT_S, location: useWorldStore.getState().location.kind });
    }, HEARTBEAT_S * 1000);
    cleanups.push(() => clearInterval(heartbeat));

    // Uncaught errors, deduped by message, capped per session.
    const seen = new Set<string>();
    const report = (message: string, stack: string | undefined, where: string) => {
      const key = message.slice(0, 200);
      if (seen.size >= MAX_ERRORS_PER_SESSION || seen.has(key)) return;
      seen.add(key);
      track("error_client", { message: message.slice(0, 500), ...(stack ? { stack: stack.slice(0, 2000) } : {}), where });
    };
    const onError = (e: ErrorEvent) => {
      const err: unknown = e.error;
      report(e.message || "Unknown error", err instanceof Error ? err.stack : undefined, "window.error");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: unknown = e.reason;
      report(
        reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection"),
        reason instanceof Error ? reason.stack : undefined,
        "unhandledrejection",
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });

    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);
    cleanups.push(() => window.removeEventListener("pagehide", onPageHide));

    return () => {
      for (const c of cleanups) c();
      flush();
    };
  }, []);

  return <>{children}</>;
}
