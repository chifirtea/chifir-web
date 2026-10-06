/**
 * Load-path marks for the city, on the User Timing API so they also show up in DevTools and
 * WebPageTest. Times are ms since navigation start.
 *
 *   nav-start ─ page-js ─ 3d-chunk-start ─ 3d-chunk-loaded ─ snapshot-ready ─ first-frame ─ interactive
 */
export type CityMark =
  | "city:page-js"
  | "city:3d-chunk-start"
  | "city:3d-chunk-loaded"
  | "city:snapshot-ready"
  | "city:first-frame"
  | "city:interactive";

const marks = new Map<CityMark, number>();

const hasPerf = () => typeof performance !== "undefined" && typeof performance.now === "function";

/** Records a mark once; later calls for the same mark are ignored (StrictMode, remounts). */
export function mark(name: CityMark): void {
  if (!hasPerf() || marks.has(name)) return;
  const t = performance.now();
  marks.set(name, t);
  try {
    performance.mark(name);
  } catch {
    // Older browsers without User Timing: the in-memory map is enough for the HUD.
  }
}

export function markTime(name: CityMark): number | undefined {
  return marks.get(name);
}

export function resetMarks(): void {
  marks.clear();
}

export interface LoadSummary {
  /** Time to the first interactive frame (the world is ready and two frames have rendered). */
  ttiMs?: number;
  /** Time spent downloading + evaluating the lazy 3D chunk. */
  chunkMs?: number;
  /** When the first 3D frame was presented. */
  firstFrameMs?: number;
  /** When the city page's own JS was evaluated (after HTML + framework). */
  pageJsMs?: number;
  /** HTML arrival and DOM content loaded, from Navigation Timing when available. */
  responseEndMs?: number;
  domContentLoadedMs?: number;
}

export function loadSummary(): LoadSummary {
  const out: LoadSummary = {};
  const r = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  const tti = marks.get("city:interactive");
  const chunkStart = marks.get("city:3d-chunk-start");
  const chunkEnd = marks.get("city:3d-chunk-loaded");
  if (tti !== undefined) out.ttiMs = r(tti);
  if (chunkStart !== undefined && chunkEnd !== undefined) out.chunkMs = r(chunkEnd - chunkStart);
  const ff = marks.get("city:first-frame");
  if (ff !== undefined) out.firstFrameMs = r(ff);
  const pj = marks.get("city:page-js");
  if (pj !== undefined) out.pageJsMs = r(pj);
  if (hasPerf() && typeof performance.getEntriesByType === "function") {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      if (nav.responseEnd > 0) out.responseEndMs = r(nav.responseEnd);
      if (nav.domContentLoadedEventEnd > 0) out.domContentLoadedMs = r(nav.domContentLoadedEventEnd);
    }
  }
  return out;
}
