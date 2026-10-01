"use client";

export const PERF_QUERY_PARAM = "perf";
export const PERF_STORAGE_KEY = "chifir.perf";

/** `?perf=1` turns the HUD on for the tab (remembered); `?perf=0` turns it off again. */
export function readPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get(PERF_QUERY_PARAM);
    if (q === "1" || q === "true") {
      sessionStorage.setItem(PERF_STORAGE_KEY, "1");
      return true;
    }
    if (q === "0" || q === "false") {
      sessionStorage.removeItem(PERF_STORAGE_KEY);
      return false;
    }
    return sessionStorage.getItem(PERF_STORAGE_KEY) === "1" || localStorage.getItem(PERF_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
