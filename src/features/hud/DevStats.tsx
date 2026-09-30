"use client";

import { useEffect, useState } from "react";
import { useQuality } from "@/engine/canvas/qualityStore";

/** Development-only FPS and quality-tier readout. Never rendered in production builds. */
export function DevStats() {
  const quality = useQuality();
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let start = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      frames += 1;
      if (t - start >= 1000) {
        setFps(Math.round((frames * 1000) / (t - start)));
        frames = 0;
        start = t;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="tabular pointer-events-none rounded-md border border-line bg-night/70 px-2 py-1 font-mono text-[11px] text-fog-3">
      {fps} fps · {quality.tier} · dpr ≤{quality.dpr[1]}
    </div>
  );
}
