"use client";

import { useEffect, useState } from "react";
import { now as clockNow } from "@/lib/time/clock";

/** The city clock at 1 Hz (aligned to the second) for countdowns. Pauses when the tab is hidden. */
export function useEventClock(active = true): number {
  const [t, setT] = useState(() => clockNow());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const n = clockNow();
      setT(n);
      timer = setTimeout(tick, 1000 - (n % 1000) + 5);
    };
    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "visible") tick();
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
  return t;
}
