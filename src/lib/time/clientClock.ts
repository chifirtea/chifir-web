"use client";

import {
  CLOCK_HEADER,
  CLOCK_STORAGE_KEY,
  clampOffset,
  clockOffsetMs,
  setClockOffsetMs,
} from "./clock";

/**
 * Browser side of the demo clock. The `/city` page passes the parsed `?clock=` offset (only when
 * the server allows overrides); it is remembered for the tab so the order page and every API call
 * keep the same clock. `clockHeaders()` is spread into fetch headers by the commerce, AI and
 * analytics clients.
 */
export function initClientClock(offsetFromPage?: number): void {
  if (typeof window === "undefined") return;
  let offset: number | null =
    typeof offsetFromPage === "number" ? clampOffset(offsetFromPage) : null;
  if (offset === null) {
    try {
      const stored = window.sessionStorage.getItem(CLOCK_STORAGE_KEY);
      if (stored !== null) offset = clampOffset(Number(stored));
    } catch {
      offset = null;
    }
  }
  if (offset === null) return;
  setClockOffsetMs(offset);
  try {
    if (offset === 0) window.sessionStorage.removeItem(CLOCK_STORAGE_KEY);
    else window.sessionStorage.setItem(CLOCK_STORAGE_KEY, String(offset));
  } catch {
    // storage unavailable: the offset still applies to this page
  }
}

export function clockHeaders(): Record<string, string> {
  const offset = clockOffsetMs();
  return offset === 0 ? {} : { [CLOCK_HEADER]: String(offset) };
}
