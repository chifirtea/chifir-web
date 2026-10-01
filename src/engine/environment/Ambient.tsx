"use client";

import { useMemo } from "react";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { ParticleField } from "./Particles";
import { puffTexture, radialGlowTexture } from "./textures";

/**
 * Ambient movement between the buildings: steam rising from the grates outside every kitchen
 * (medium and up; low gets a thinner version) and light motes drifting over the plaza on high.
 */
export function Ambient() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const vents = useMemo(() => (layout ? layout.vents.map((v) => [v.x, 0.15, v.z] as const) : []), [layout]);
  const plaza = layout?.plaza ?? { x: 0, z: 0, radius: 30 };
  const motes = useMemo(
    () =>
      [0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        return [plaza.x + Math.sin(a) * plaza.radius * 0.5, 1.2, plaza.z + Math.cos(a) * plaza.radius * 0.5] as const;
      }),
    [plaza.x, plaza.z, plaza.radius],
  );
  const puff = useMemo(() => puffTexture(64), []);
  const glow = useMemo(() => radialGlowTexture(64), []);
  if (!layout) return null;
  const perVent = quality.tier === "high" ? 14 : quality.tier === "medium" ? 9 : 4;
  return (
    <group>
      {vents.length > 0 && (
        <ParticleField emitters={vents} perEmitter={perVent} texture={puff} color="#d9d2cc" lifetime={5.5} size={0.7} grow={1.8} spread={0.4} rise={3.4} drift={0.7} opacity={0.16} seed={5} />
      )}
      {quality.tier === "high" && (
        <ParticleField emitters={motes} perEmitter={30} texture={glow} color="#ffd9a0" lifetime={9} size={0.07} spread={7} rise={2.2} drift={1.5} opacity={0.55} additive seed={9} />
      )}
    </group>
  );
}
