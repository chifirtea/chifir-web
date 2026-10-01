"use client";

import { useEffect, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { teleportTo } from "@/city/cityActions";
import { distance2D } from "@/city/navigation";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { bearingDegrees, formatDistance, normalizeDegrees } from "./bearing";

export { bearingDegrees } from "./bearing";

const POLL_MS = 100; // 10 Hz

/** Compact "→ Kōri Ramen · 42 m" card with a live arrow. Hidden inside interiors. */
export function WaypointChevron() {
  const waypoint = useWorldStore((s) => s.waypoint);
  const onStreet = useWorldStore((s) => s.location.kind === "street");
  const setWaypoint = useWorldStore((s) => s.setWaypoint);
  // `spin` is the unwrapped angle so the arrow never takes the long way round 180°.
  const [state, setState] = useState({ spin: 0, distance: 0 });

  useEffect(() => {
    if (!waypoint || !onStreet) return;
    let raf = 0;
    let last = -Infinity;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < POLL_MS) return;
      last = t;
      const bearing = bearingDegrees(playerRig, waypoint);
      const distance = distance2D(playerRig, waypoint);
      setState((prev) => {
        const delta = normalizeDegrees(bearing - prev.spin);
        if (Math.abs(delta) < 1 && Math.abs(distance - prev.distance) < 0.5) return prev;
        return { spin: prev.spin + delta, distance };
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [waypoint, onStreet]);

  if (!waypoint || !onStreet) return null;

  return (
    <div className="pointer-events-auto flex h-12 max-w-[calc(100vw-32px)] items-center gap-2 rounded-full border border-line bg-ink/92 py-1 pr-1 pl-1.5 text-fog shadow-sign backdrop-blur-md">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sodium/15 text-sodium">
        <ArrowUp
          className="h-5 w-5"
          aria-hidden="true"
          style={{ transform: `rotate(${state.spin}deg)`, transition: "transform 140ms linear" }}
        />
      </span>
      <span className="min-w-0 text-[14px] leading-none">
        <span className="font-display block truncate font-semibold tracking-tight">
          {waypoint.label}
        </span>
        <span className="tabular mt-0.5 block text-[12px] text-fog-3">
          {formatDistance(state.distance)}
        </span>
      </span>
      <button
        type="button"
        onClick={() => teleportTo(waypoint.target, "hud")}
        className="font-display ml-1 h-9 shrink-0 rounded-full bg-white/8 px-3 text-[13px] font-semibold tracking-tight hover:bg-white/14"
      >
        Take me there
      </button>
      <button
        type="button"
        onClick={() => setWaypoint(null)}
        aria-label="Clear waypoint"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fog-2 hover:bg-white/8 hover:text-fog"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
