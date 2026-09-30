"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vec2 } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { NpcAvatar } from "@/engine/player/Avatar";
import { mulberry32 } from "./prng";

/**
 * Ambient walkers: `quality.npcCount` avatars strolling the sidewalk loops from the layout at
 * varied speeds, pausing now and then as if window-shopping. Movement and the walk cycle are
 * ref-driven: no React state changes per frame.
 */

const BODY_COLORS = ["#8a5a44", "#2f3e5c", "#5c3a4a", "#3d5a4a", "#6b6b78", "#a0522d", "#2b2b30", "#7a6a52", "#4a3f6b", "#c46a3a"];
const HAIR_COLORS = ["#1a120e", "#3b2416", "#6b4a2a", "#0e0e10", "#8a7a68", "#a8532c"];
const MAX_DELTA = 0.1;

interface WalkerState {
  segment: number;
  t: number;
  speed: number;
  pauseLeft: number;
  nextPause: number;
  paused: boolean;
}

function Walker({ seed, path }: { seed: number; path: Vec2[] }) {
  const group = useRef<THREE.Group>(null);
  const speedRef = useRef(0);
  const state = useRef<WalkerState | null>(null);
  const rand = useMemo(() => mulberry32(seed * 7919 + 17), [seed]);
  const colors = useMemo(
    () => ({ body: BODY_COLORS[seed % BODY_COLORS.length]!, hair: HAIR_COLORS[(seed * 3) % HAIR_COLORS.length]! }),
    [seed],
  );
  useFrame((_, delta) => {
    const g = group.current;
    // Lazy init inside the frame loop (not during render) keeps the walker deterministic per seed.
    if (!state.current) {
      state.current = {
        segment: Math.floor(rand() * path.length),
        t: rand(),
        speed: 0.9 + rand() * 0.6,
        pauseLeft: 0,
        nextPause: 8 + rand() * 20,
        paused: false,
      };
    }
    const s = state.current;
    if (!g || !s || path.length < 2) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const dt = Math.min(delta, MAX_DELTA);
    if (s.paused) {
      s.pauseLeft -= dt;
      if (s.pauseLeft <= 0) {
        s.paused = false;
        s.nextPause = 10 + rand() * 25;
      }
      speedRef.current = 0;
      return;
    }
    const from = path[s.segment]!;
    const to = path[(s.segment + 1) % path.length]!;
    const len = Math.max(0.001, Math.hypot(to.x - from.x, to.z - from.z));
    s.t += (s.speed * dt) / len;
    while (s.t >= 1) {
      s.t -= 1;
      s.segment = (s.segment + 1) % path.length;
    }
    const a = path[s.segment]!;
    const b = path[(s.segment + 1) % path.length]!;
    g.position.set(a.x + (b.x - a.x) * s.t, 0, a.z + (b.z - a.z) * s.t);
    g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    speedRef.current = s.speed;
    s.nextPause -= dt;
    if (s.nextPause <= 0) {
      s.paused = true;
      s.pauseLeft = 2 + rand() * 4;
      // Turn a little toward the buildings while pausing.
      g.rotation.y += (rand() > 0.5 ? 1 : -1) * (Math.PI / 2) * 0.8;
      speedRef.current = 0;
    }
  });

  const start = path[0] ?? { x: 0, z: 0 };
  return (
    <group ref={group} position={[start.x, 0, start.z]}>
      <NpcAvatar bodyColor={colors.body} hairColor={colors.hair} speedRef={speedRef} phase={(seed * 0.618) % 1 * Math.PI * 2} />
    </group>
  );
}

export function Npcs() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const paths = useMemo(() => (index ? getStreetLayout(index).npcPaths.filter((p) => p.length >= 2) : []), [index]);
  if (paths.length === 0 || quality.npcCount <= 0) return null;
  return (
    <group>
      {Array.from({ length: quality.npcCount }, (_, i) => (
        <Walker key={i} seed={i} path={paths[i % paths.length]!} />
      ))}
    </group>
  );
}
