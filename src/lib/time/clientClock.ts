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
const CLOCK_SOURCE_KEY = `${CLOCK_STORAGE_KEY}.source`;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * `source` is the raw `?clock=` value the offset came from. A reload with the same value keeps
 * the clock running from where it was (an absolute time would otherwise re-anchor and restart a
 * countdown); a different value re-anchors on purpose.
 */
export function initClientClock(offsetFromPage?: number, source?: string): void {
  if (typeof window === "undefined") return;
  const store = storage();
  let storedOffset: number | null = null;
  let storedSource: string | null = null;
  if (store) {
    const stored = store.getItem(CLOCK_STORAGE_KEY);
    if (stored !== null) storedOffset = clampOffset(Number(stored));
    storedSource = store.getItem(CLOCK_SOURCE_KEY);
  }
  let offset: number | null;
  if (typeof offsetFromPage === "number") {
    const sameSource = source !== undefined && source === storedSource && storedOffset !== null;
    offset = sameSource ? storedOffset : clampOffset(offsetFromPage);
  } else {
    offset = storedOffset;
  }
  if (offset === null) return;
  setClockOffsetMs(offset);
  if (!store) return;
  if (offset === 0) {
    store.removeItem(CLOCK_STORAGE_KEY);
    store.removeItem(CLOCK_SOURCE_KEY);
  } else {
    store.setItem(CLOCK_STORAGE_KEY, String(offset));
    if (source !== undefined) store.setItem(CLOCK_SOURCE_KEY, source);
  }
}

export function clockHeaders(): Record<string, string> {
  const offset = clockOffsetMs();
  return offset === 0 ? {} : { [CLOCK_HEADER]: String(offset) };
}
