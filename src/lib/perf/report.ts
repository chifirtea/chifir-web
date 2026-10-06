import { frameStats, type FrameSummary } from "./frames";
import { loadSummary, type LoadSummary } from "./marks";
import { readDeviceInfo, readMemoryMb, type DeviceInfo } from "./device";

export interface RenderCounters {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface PerfReport {
  at: string;
  url: string;
  tier?: string;
  dprClamp?: number;
  location?: string;
  frames: FrameSummary;
  load: LoadSummary;
  render?: RenderCounters;
  memoryMb?: number;
  device: DeviceInfo;
  peers?: number;
}

/** Live render counters written by the canvas probe; undefined until the first frame. */
export const renderCounters: { current?: RenderCounters } = {};

let deviceCache: DeviceInfo | null = null;
let gpuForDevice: string | undefined;

export function setPerfGpu(renderer: string | undefined): void {
  gpuForDevice = renderer;
  deviceCache = null;
}

export function deviceInfo(): DeviceInfo {
  if (!deviceCache) deviceCache = readDeviceInfo(gpuForDevice);
  return deviceCache;
}

export interface ReportContext {
  tier?: string;
  dprClamp?: number;
  location?: string;
  peers?: number;
}

/** A JSON snapshot of everything the HUD shows, for copying into an issue or a chat. */
export function perfReport(ctx: ReportContext = {}): PerfReport {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const memoryMb = readMemoryMb();
  return {
    at: new Date().toISOString(),
    url: typeof location !== "undefined" ? location.href : "",
    ...(ctx.tier ? { tier: ctx.tier } : {}),
    ...(ctx.dprClamp !== undefined ? { dprClamp: ctx.dprClamp } : {}),
    ...(ctx.location ? { location: ctx.location } : {}),
    frames: frameStats.summary(now),
    load: loadSummary(),
    ...(renderCounters.current ? { render: { ...renderCounters.current } } : {}),
    ...(memoryMb !== undefined ? { memoryMb } : {}),
    device: deviceInfo(),
    ...(ctx.peers !== undefined ? { peers: ctx.peers } : {}),
  };
}

declare global {
  interface Window {
    /** Available in every build: `__chifirPerf.report()` returns the same JSON the HUD copies. */
    __chifirPerf?: { report: (ctx?: ReportContext) => PerfReport };
  }
}

export function installPerfGlobal(): void {
  if (typeof window === "undefined" || window.__chifirPerf) return;
  window.__chifirPerf = { report: (ctx) => perfReport(ctx) };
}
