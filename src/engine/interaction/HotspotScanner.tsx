"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { getHotspots } from "./hotspotStore";
import type { Hotspot } from "./hotspots";

/** Seconds between scans. Hotspot radii are metres wide, so 8 Hz is plenty. */
const SCAN_INTERVAL = 0.12;

/**
 * Keeps `world.activeHotspot` pointing at the nearest hotspot whose radius contains the player.
 * The store ignores writes that do not change the id, so the HUD only re-renders on change.
 */
export function HotspotScanner() {
  const acc = useRef(0);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < SCAN_INTERVAL) return;
    acc.current = 0;

    const world = useWorldStore.getState();
    if (world.transition !== "idle") {
      if (world.activeHotspot) world.setActiveHotspot(null);
      return;
    }

    const list = getHotspots(world.location.kind === "interior" ? "interior" : "street");
    const px = playerRig.x;
    const pz = playerRig.z;
    let best: Hotspot | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const h = list[i]!;
      const dx = h.x - px;
      const dz = h.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= h.radius * h.radius && d2 < bestD2) {
        best = h;
        bestD2 = d2;
      }
    }
    world.setActiveHotspot(best);
  });

  return null;
}
