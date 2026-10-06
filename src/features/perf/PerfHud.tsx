"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Check, Copy, Share2 } from "lucide-react";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { cn } from "@/lib/utils/cn";
import { deviceInfo, installPerfGlobal, perfReport, type PerfReport } from "@/lib/perf/report";
import { useIsTouch } from "@/features/hud/useMediaQuery";
import { readPerfEnabled } from "./perfEnabled";

const REFRESH_MS = 500;

/** Budget colours: ≥ 30 fps green, ≥ 20 amber, else red (docs/PERFORMANCE.md). */
function fpsTone(fps: number): string {
  if (fps >= 30) return "text-mint";
  if (fps >= 20) return "text-sodium";
  return "text-danger";
}
function p95Tone(ms: number): string {
  if (ms <= 33) return "text-mint";
  if (ms <= 50) return "text-sodium";
  return "text-danger";
}

/**
 * Developer performance HUD (`?perf=1`, any build). Shows what a phone is actually doing: frame
 * rate and frame-time percentiles, load timings, draw calls, memory and the device, with a
 * one-tap copy of the full JSON report. Sits above the touch controls on phones.
 */
export function PerfHud() {
  // Read once on mount (client only: the component is inside the client-only city bundle).
  const [enabled] = useState(() => readPerfEnabled());
  const [report, setReport] = useState<PerfReport | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const touch = useIsTouch();
  const tier = useQualityStore((s) => s.settings.tier);
  const dprClamp = useQualityStore((s) => s.settings.dpr[1]);
  const location = useWorldStore((s) => s.location.kind);

  useEffect(() => {
    installPerfGlobal();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setReport(perfReport({ tier, dprClamp, location }));
    tick();
    const t = setInterval(tick, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, tier, dprClamp, location]);

  const copy = useCallback(async () => {
    const text = JSON.stringify(perfReport({ tier, dprClamp, location }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (http, permissions): the share sheet below is the fallback.
    }
  }, [tier, dprClamp, location]);

  const share = useCallback(async () => {
    const text = JSON.stringify(perfReport({ tier, dprClamp, location }), null, 2);
    try {
      if (navigator.share) await navigator.share({ title: "Chifir perf report", text });
      else await copy();
    } catch {
      // user cancelled
    }
  }, [tier, dprClamp, location, copy]);

  if (!enabled || !report) return null;
  const f = report.frames;
  const d = report.device;
  const l = report.load;
  const r = report.render;

  return (
    <div
      data-testid="perf-hud"
      className={cn(
        "pointer-events-auto fixed left-3 z-30 w-[min(92vw,300px)] select-none rounded-lg border border-line bg-night/85 font-mono text-[11px] leading-snug text-fog-2 shadow-sign backdrop-blur-md",
      )}
      style={{
        top: touch ? "max(72px, calc(env(safe-area-inset-top) + 60px))" : "max(72px, calc(env(safe-area-inset-top) + 60px))",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex min-h-9 w-full items-center justify-between gap-2 px-2.5 text-left"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-1.5 text-fog">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          <span className={cn("tabular text-[13px] font-semibold", fpsTone(f.fps1s))}>{f.fps1s} fps</span>
          <span className="text-fog-3">· 10 s {f.fps10s}</span>
        </span>
        <span className={cn("tabular", p95Tone(f.p95Ms))}>p95 {f.p95Ms} ms</span>
      </button>
      {!collapsed ? (
        <div className="space-y-1 border-t border-line px-2.5 py-2">
          <Row k="frame" v={`p50 ${f.p50Ms} · p95 ${f.p95Ms} · p99 ${f.p99Ms} ms · long ${f.longFrames}`} />
          <Row k="load" v={`tti ${fmt(l.ttiMs)} · chunk ${fmt(l.chunkMs)} · 1st frame ${fmt(l.firstFrameMs)} · html ${fmt(l.responseEndMs)}`} />
          {r ? <Row k="draw" v={`${r.drawCalls} calls · ${(r.triangles / 1000).toFixed(0)}k tris · ${r.textures} tex · ${r.programs} prog`} /> : null}
          <Row k="mem" v={report.memoryMb !== undefined ? `${report.memoryMb} MB js heap` : "n/a (not Chromium)"} />
          <Row k="tier" v={`${report.tier ?? "?"} · dpr ≤${report.dprClamp ?? "?"} (device ${d.dpr}) · ${d.viewport.width}×${d.viewport.height} · ${location}`} />
          <Row k="gpu" v={`${d.gpuShort ?? d.gpu ?? "unknown"}${d.webgl2 ? " · webgl2" : " · webgl1"}`} />
          <Row k="dev" v={`${d.mobile ? "mobile" : "desktop"} · ${d.cores ?? "?"} cores · ${d.deviceMemoryGb ? `${d.deviceMemoryGb} GB` : "? GB"} · ${d.connection ?? "net ?"}`} />
          <div className="flex gap-1.5 pt-1">
            <button type="button" onClick={copy} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-line bg-white/5 text-fog hover:bg-white/10">
              {copied ? <Check className="h-3.5 w-3.5 text-mint" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy report"}
            </button>
            <button type="button" onClick={share} className="flex h-8 w-9 items-center justify-center rounded-md border border-line bg-white/5 text-fog hover:bg-white/10" aria-label="Share report">
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-9 shrink-0 text-fog-3">{k}</span>
      <span className="tabular min-w-0 flex-1 break-words text-fog-2">{v}</span>
    </div>
  );
}

function fmt(ms: number | undefined): string {
  return ms === undefined ? "–" : ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export { deviceInfo };
