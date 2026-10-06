"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { CityEvent, Pose2 } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { eventCrowdSpots, getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { NpcAvatar } from "@/engine/player/Avatar";
import { now as clockNow } from "@/lib/time/clock";
import { gatheringEvents, nextGatherChangeAt } from "./eventStage";
import { Accessories, npcLook } from "./Npcs";

/**
 * People who stand rather than walk: small idle groups on the plaza and outside the kitchens
 * (from the layout), and the crowd that gathers in front of an event's parcel from
 * `config.gatherFrom` minutes before it starts until it ends. Figures face their group centre or
 * the stage, shift their weight and hold phones up. Counts scale with the quality tier.
 */

const EVENT_CROWD: Record<"low" | "medium" | "high", number> = { low: 6, medium: 12, high: 20 };
const MAX_SLEEP_MS = 60_000;
const NO_EVENTS: readonly CityEvent[] = [];

function IdleFigure({ pose, seed, phones }: { pose: Pose2; seed: number; phones: boolean }) {
  const group = useRef<THREE.Group>(null);
  const look = useMemo(() => npcLook(seed), [seed]);
  const phase = (seed * 0.731) % 1;
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime + phase * 10;
    g.position.y = Math.sin(t * 1.6) * 0.012;
    g.rotation.y = pose.yaw + Math.sin(t * 0.45) * 0.09;
  });
  return (
    <group ref={group} position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <NpcAvatar bodyColor={look.body} hairColor={look.hair} phase={phase * Math.PI * 2} />
      <Accessories bag={look.bag} phone={phones ? look.phone || seed % 3 === 0 : look.phone} side={seed % 2 === 0 ? 1 : -1} />
    </group>
  );
}

/**
 * The clock value to evaluate gathering against: refreshed at the next instant any event's
 * gathering state flips (start − gatherFrom; start/end also rebuild the index).
 */
function useGatherClock(events: readonly CityEvent[]): number {
  const [at, setAt] = useState(() => clockNow());
  useEffect(() => {
    const now = clockNow();
    const next = nextGatherChangeAt(events, now);
    if (next === null) return;
    const timer = setTimeout(() => setAt(clockNow()), Math.min(MAX_SLEEP_MS, Math.max(50, next - now + 20)));
    return () => clearTimeout(timer);
  }, [events, at]);
  return at;
}

export function Crowd() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const events = index?.snapshot.events ?? NO_EVENTS;
  const at = useGatherClock(events);

  const idle = useMemo(() => {
    if (!layout) return [];
    const groups = quality.tier === "low" ? layout.idleGroups.slice(0, 3) : layout.idleGroups;
    const out: Array<{ pose: Pose2; seed: number }> = [];
    groups.forEach((g, gi) => {
      const size = quality.tier === "high" ? Math.min(4, g.size + 1) : quality.tier === "low" ? 2 : Math.min(3, g.size);
      for (let i = 0; i < size; i++) {
        const a = (i / size) * Math.PI * 2 + gi * 0.7;
        const x = g.x + Math.sin(a) * 0.6;
        const z = g.z + Math.cos(a) * 0.6;
        out.push({ pose: { x, z, yaw: Math.atan2(g.x - x, g.z - z) }, seed: 1000 + gi * 8 + i });
      }
    });
    return out;
  }, [layout, quality.tier]);

  const crowd = useMemo(() => {
    if (!layout || !index) return [];
    const count = EVENT_CROWD[quality.tier];
    const out: Array<{ pose: Pose2; seed: number; key: string }> = [];
    // Several events can gather at once (a promo on Food Street, the drop on the square), so the
    // seed and the key both carry the parcel: looks differ per crowd and React keys stay unique.
    gatheringEvents(index, Math.max(at, clockNow())).forEach(({ parcel }, pi) => {
      eventCrowdSpots(layout, index, parcel, count).forEach((pose, i) =>
        out.push({ pose, seed: 5000 + pi * 97 + i * 3, key: `${parcel.id}:${i}` }),
      );
    });
    return out;
  }, [layout, index, quality.tier, at]);

  return (
    <group>
      {idle.map((f) => (
        <IdleFigure key={`idle-${f.seed}`} pose={f.pose} seed={f.seed} phones={false} />
      ))}
      {crowd.map((f) => (
        <IdleFigure key={`crowd-${f.key}`} pose={f.pose} seed={f.seed} phones />
      ))}
    </group>
  );
}
