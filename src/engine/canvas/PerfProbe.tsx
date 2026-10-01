"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { frameStats } from "@/lib/perf/frames";
import { mark } from "@/lib/perf/marks";
import { renderCounters, setPerfGpu } from "@/lib/perf/report";

/**
 * Lives inside the canvas: feeds the frame-time ring every frame (no allocation) and copies the
 * renderer's counters twice a second. Always mounted; it costs one comparison per frame.
 */
const COUNTER_INTERVAL_S = 0.5;

export function PerfProbe({ gpu }: { gpu?: string | undefined }) {
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  const lastCounterAt = useRef(0);

  useEffect(() => {
    setPerfGpu(gpu);
  }, [gpu]);

  // Priority -1: after the player (-20) and camera (-10) but still *before* the render. A positive
  // priority would make R3F stop rendering automatically ("manual frameloop"), so never use one here.
  useFrame(() => {
    // Stamps share the HUD's time base (performance.now), so "last second" windows line up.
    const t = performance.now();
    if (last.current > 0) {
      frameStats.push(t - last.current, t);
      mark("city:first-frame");
    }
    last.current = t;
    if (t - lastCounterAt.current > COUNTER_INTERVAL_S * 1000) {
      lastCounterAt.current = t;
      const info = gl.info;
      renderCounters.current = {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    }
  }, -1);
  return null;
}
