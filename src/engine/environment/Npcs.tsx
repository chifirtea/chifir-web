"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vec2 } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { NpcAvatar } from "@/engine/player/Avatar";
import { GEO, tinted } from "@/engine/storefront/templates/parts";
import { mulberry32 } from "./prng";

/**
 * Ambient walkers: `quality.npcCount` avatars strolling the sidewalk loops from the layout at
 * varied speeds, some in pairs, some carrying a bag or looking at a phone, pausing now and then as
 * if window-shopping. Movement and the walk cycle are ref-driven: no React state per frame.
 */

/** Contemporary outfit palette: muted tones with a few saturated pieces, never a crowd of clones. */
export const OUTFIT_COLORS = [
  "#8a5a44", "#2f3e5c", "#5c3a4a", "#3d5a4a", "#6b6b78", "#a0522d", "#2b2b30", "#7a6a52",
  "#4a3f6b", "#c46a3a", "#e4dccd", "#1f5f5b", "#b23a48", "#4f6d7a", "#d9b26f", "#3b2f2f",
];
export const HAIR_COLORS = ["#1a120e", "#3b2416", "#6b4a2a", "#0e0e10", "#8a7a68", "#a8532c", "#d8c6a8"];
const BAG_COLORS = ["#1c1a1f", "#b98b5e", "#e8e4dc", "#5a2e2e"];
const MAX_DELTA = 0.1;

const PHONE = tinted("#dbe9ff", { emissive: "#bcd8ff", emissiveIntensity: 1.1, roughness: 0.3 });
const PHONE_BODY = tinted("#15161a", { roughness: 0.4, metalness: 0.4 });

/** Deterministic look for the n-th figure of a seed family. */
export function npcLook(seed: number): { body: string; hair: string; bag: string | null; phone: boolean } {
  const rand = mulberry32(seed * 104729 + 7);
  const body = OUTFIT_COLORS[Math.floor(rand() * OUTFIT_COLORS.length)]!;
  const hair = HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)]!;
  const r = rand();
  const bag = r < 0.3 ? BAG_COLORS[Math.floor(rand() * BAG_COLORS.length)]! : null;
  const phone = r >= 0.3 && r < 0.5;
  return { body, hair, bag, phone };
}

/** Small props that make a figure read as a person with a life: a bag at the hip or a lit phone. */
export function Accessories({ bag, phone, side = 1 }: { bag: string | null; phone: boolean; side?: 1 | -1 }) {
  return (
    <group>
      {bag && <mesh geometry={GEO.box} material={tinted(bag, { roughness: 0.7 })} position={[side * 0.34, 0.72, 0.02]} scale={[0.22, 0.3, 0.1]} />}
      {phone && (
        <group position={[side * 0.12, 1.2, 0.3]} rotation={[-0.5, 0, 0]}>
          <mesh geometry={GEO.box} material={PHONE_BODY} scale={[0.08, 0.15, 0.012]} />
          <mesh geometry={GEO.plane} material={PHONE} position={[0, 0, 0.007]} scale={[0.07, 0.13, 1]} />
        </group>
      )}
    </group>
  );
}

interface WalkerState {
  segment: number;
  t: number;
  speed: number;
  pauseLeft: number;
  nextPause: number;
  paused: boolean;
}

function Walker({ seed, path, companions }: { seed: number; path: Vec2[]; companions: number }) {
  const group = useRef<THREE.Group>(null);
  const speedRef = useRef(0);
  const state = useRef<WalkerState | null>(null);
  const rand = useMemo(() => mulberry32(seed * 7919 + 17), [seed]);
  const looks = useMemo(() => Array.from({ length: companions }, (_, i) => npcLook(seed * 3 + i)), [seed, companions]);
  useFrame((_, delta) => {
    const g = group.current;
    // Lazy init inside the frame loop (not during render) keeps the walker deterministic per seed.
    if (!state.current) {
      state.current = {
        segment: Math.floor(rand() * path.length),
        t: rand(),
        speed: 0.8 + rand() * 0.7,
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
      {looks.map((look, i) => (
        <group key={i} position={[(i - (companions - 1) / 2) * 0.7, 0, i * 0.12]}>
          <NpcAvatar bodyColor={look.body} hairColor={look.hair} speedRef={speedRef} phase={(((seed + i) * 0.618) % 1) * Math.PI * 2} />
          <Accessories bag={look.bag} phone={look.phone} side={i % 2 === 0 ? 1 : -1} />
        </group>
      ))}
    </group>
  );
}

export function Npcs() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const paths = useMemo(() => (index ? getStreetLayout(index).npcPaths.filter((p) => p.length >= 2) : []), [index]);
  // Split the budget into solo walkers and pairs so the street reads as people, not a parade.
  const walkers = useMemo(() => {
    const out: Array<{ seed: number; companions: number }> = [];
    let remaining = quality.npcCount;
    let seed = 0;
    while (remaining > 0) {
      const companions = seed % 3 === 1 && remaining >= 2 ? 2 : 1;
      out.push({ seed, companions });
      remaining -= companions;
      seed += 1;
    }
    return out;
  }, [quality.npcCount]);
  if (paths.length === 0 || walkers.length === 0) return null;
  return (
    <group>
      {walkers.map((w) => (
        <Walker key={w.seed} seed={w.seed} path={paths[w.seed % paths.length]!} companions={w.companions} />
      ))}
    </group>
  );
}
