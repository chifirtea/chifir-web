"use client";

import { useMemo } from "react";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout, type StreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { GEO, MAT, tinted } from "@/engine/storefront/templates/parts";
import { hashString } from "./prng";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";

/**
 * Instanced street furniture from the layout: sodium lamps, trees in two tints, benches,
 * planters and bollards. Counts scale with `propDensity`; instances receive shadows and only
 * cast them on high.
 */

function thin<T>(items: readonly T[], density: number, keepAll = false): T[] {
  if (keepAll || density >= 1) return [...items];
  return items.filter((_, i) => Math.floor(i * density) !== Math.floor((i + 1) * density));
}

const SODIUM = tinted("#ffd9a0", { emissive: "#ffb257", emissiveIntensity: 3.2, roughness: 0.3 });
const BOLLARD_CAP = tinted("#ffe9c4", { emissive: "#ffc46b", emissiveIntensity: 1.6, roughness: 0.4 });
const TRUNK = tinted("#4a3526", { roughness: 0.95 });
const CANOPY = tinted("#ffffff", { roughness: 0.95 });
const BENCH_WOOD = tinted("#6b4b32", { roughness: 0.8 });
const PLANTER = tinted("#3a3b41", { roughness: 0.9 });
const CANOPY_TINTS = ["#2f5d3a", "#3f6b3c", "#35563f"];

function buildItems(layout: StreetLayout, density: number) {
  const lamps = layout.lampPositions;
  const trees = thin(layout.treePositions, Math.max(0.4, density));
  const benches = thin(layout.benchPoses, Math.max(0.5, density));
  const planters = thin(layout.planterPositions, Math.max(0.5, density));
  const bollards = layout.bollards;

  const posts: InstanceTransform[] = lamps.map((p) => ({ x: p.x, y: 2.3, z: p.z, sx: 0.09, sy: 4.6, sz: 0.09 }));
  const heads: InstanceTransform[] = lamps.map((p) => ({ x: p.x, y: 4.82, z: p.z, sx: 0.56, sy: 0.22, sz: 0.56 }));
  const bulbs: InstanceTransform[] = lamps.map((p) => ({ x: p.x, y: 4.62, z: p.z, sx: 0.17, sy: 0.14, sz: 0.17 }));

  const trunks: InstanceTransform[] = [];
  const canopies: InstanceTransform[] = [];
  trees.forEach((p, i) => {
    const h = hashString(`${p.x.toFixed(1)}:${p.z.toFixed(1)}`);
    const scale = 0.85 + ((h >>> 3) % 100) / 300;
    const tint = CANOPY_TINTS[h % CANOPY_TINTS.length]!;
    const yaw = ((h >>> 8) % 628) / 100;
    trunks.push({ x: p.x, y: 1.4 * scale, z: p.z, sx: 0.16, sy: 2.8 * scale, sz: 0.16 });
    canopies.push({ x: p.x, y: 3.7 * scale, z: p.z, sx: 1.5 * scale, sy: 1.35 * scale, sz: 1.5 * scale, color: tint });
    canopies.push({ x: p.x + Math.sin(yaw) * 0.6, y: 3.1 * scale, z: p.z + Math.cos(yaw) * 0.6, sx: 1.05 * scale, sy: 0.95 * scale, sz: 1.05 * scale, color: tint });
    canopies.push({ x: p.x - Math.sin(yaw) * 0.5, y: 3.35 * scale, z: p.z - Math.cos(yaw) * 0.55, sx: 0.95 * scale, sy: 0.9 * scale, sz: 0.95 * scale, color: CANOPY_TINTS[(h + 1 + i) % CANOPY_TINTS.length] });
  });

  const seats: InstanceTransform[] = [];
  const backs: InstanceTransform[] = [];
  const legs: InstanceTransform[] = [];
  for (const b of benches) {
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const rx = fz;
    const rz = -fx;
    seats.push({ x: b.x, y: 0.45, z: b.z, yaw: b.yaw, sx: 1.8, sy: 0.08, sz: 0.46 });
    backs.push({ x: b.x - fx * 0.22, y: 0.74, z: b.z - fz * 0.22, yaw: b.yaw, tiltX: -0.18, sx: 1.8, sy: 0.44, sz: 0.06 });
    for (const s of [-1, 1]) legs.push({ x: b.x + rx * 0.72 * s, y: 0.22, z: b.z + rz * 0.72 * s, yaw: b.yaw, sx: 0.08, sy: 0.44, sz: 0.42 });
  }

  const boxes: InstanceTransform[] = planters.map((p) => ({ x: p.x, y: 0.28, z: p.z, sx: 1.25, sy: 0.56, sz: 1.25 }));
  const soil: InstanceTransform[] = planters.map((p) => ({ x: p.x, y: 0.57, z: p.z, sx: 1.12, sy: 0.04, sz: 1.12 }));
  const bushes: InstanceTransform[] = planters.flatMap((p, i) => [
    { x: p.x - 0.2, y: 0.95, z: p.z + 0.1, sx: 0.55, sy: 0.45, sz: 0.55, color: CANOPY_TINTS[i % 3] },
    { x: p.x + 0.25, y: 0.9, z: p.z - 0.15, sx: 0.42, sy: 0.38, sz: 0.42, color: CANOPY_TINTS[(i + 1) % 3] },
  ]);

  const stems: InstanceTransform[] = bollards.map((p) => ({ x: p.x, y: 0.47, z: p.z, sx: 0.12, sy: 0.94, sz: 0.12 }));
  const caps: InstanceTransform[] = bollards.map((p) => ({ x: p.x, y: 0.96, z: p.z, sx: 0.09, sy: 0.06, sz: 0.09 }));

  return { posts, heads, bulbs, trunks, canopies, seats, backs, legs, boxes, soil, bushes, stems, caps };
}

export function Props() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const items = useMemo(() => (layout ? buildItems(layout, quality.propDensity) : null), [layout, quality.propDensity]);
  if (!items) return null;
  const cast = quality.tier === "high";
  return (
    <group>
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={items.posts} castShadow={cast} receiveShadow />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={items.heads} castShadow={cast} />
      <StaticInstances geometry={GEO.sphere} material={SODIUM} items={items.bulbs} />
      <StaticInstances geometry={GEO.cylinder} material={TRUNK} items={items.trunks} castShadow={cast} receiveShadow />
      <StaticInstances geometry={GEO.sphere} material={CANOPY} items={items.canopies} castShadow={cast} receiveShadow />
      <StaticInstances geometry={GEO.box} material={BENCH_WOOD} items={items.seats} castShadow={cast} receiveShadow />
      <StaticInstances geometry={GEO.box} material={BENCH_WOOD} items={items.backs} castShadow={cast} />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={items.legs} />
      <StaticInstances geometry={GEO.box} material={PLANTER} items={items.boxes} castShadow={cast} receiveShadow />
      <StaticInstances geometry={GEO.box} material={MAT.soil} items={items.soil} />
      <StaticInstances geometry={GEO.sphere} material={CANOPY} items={items.bushes} receiveShadow />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={items.stems} receiveShadow />
      <StaticInstances geometry={GEO.cylinder} material={BOLLARD_CAP} items={items.caps} />
    </group>
  );
}
