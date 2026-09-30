"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Reactive `matchMedia` with a server/first-paint default. */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : serverDefault),
    [query, serverDefault],
  );
  const getServerSnapshot = useCallback(() => serverDefault, [serverDefault]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Coarse pointer = touch-first device (the joystick is showing, "Tap" instead of "E"). */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/** Phone-width viewport: drawers become bottom sheets. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
