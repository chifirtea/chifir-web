"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { District } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { getStreetLayout, parcelFacing, segmentCenter, type StreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, tinted } from "@/engine/storefront/templates/parts";
import { hashString } from "./prng";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";
import { bannerTexture, lightPoolTexture } from "./textures";

/**
 * Instanced street furniture from the layout: sodium lamps with warm light pools on the ground
 * and district banners, trees that sway in the wind (vertex shader, no CPU work), benches,
 * planters, bollards, and a soft accent wash in front of every open storefront. Counts scale with
 * `propDensity`; instances receive shadows and only cast them on high.
 */

function thin<T>(items: readonly T[], density: number, keepAll = false): T[] {
  if (keepAll || density >= 1) return [...items];
  return items.filter((_, i) => Math.floor(i * density) !== Math.floor((i + 1) * density));
}

const LAMP_COLOR = "#ffb257";
const SODIUM = tinted("#ffd9a0", { emissive: "#ffb257", emissiveIntensity: 3.2, roughness: 0.3 });
const BOLLARD_CAP = tinted("#ffe9c4", {
  emissive: "#ffc46b",
  emissiveIntensity: 1.6,
  roughness: 0.4,
});
const TRUNK = tinted("#4a3526", { roughness: 0.95 });
const BENCH_WOOD = tinted("#6b4b32", { roughness: 0.8 });
const BENCH_SLAT = tinted("#7d5a3c", { roughness: 0.75 });
const PLANTER = tinted("#3a3b41", { roughness: 0.9 });
const CANOPY_TINTS = ["#2f5d3a", "#3f6b3c", "#35563f"];

/** Canopy material whose vertices sway with a time uniform; the program is unique to it. */
const swayTime = { value: 0 };
const CANOPY = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, metalness: 0 });
CANOPY.onBeforeCompile = (shader) => {
  shader.uniforms["uSway"] = swayTime;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uSway;")
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 swayAnchor = instanceMatrix[3].xz;
      #else
        vec2 swayAnchor = vec2(0.0);
      #endif
      float swayLift = clamp(position.y + 0.7, 0.0, 1.7);
      transformed.x += sin(uSway * 1.1 + swayAnchor.x * 0.35 + swayAnchor.y * 0.21) * 0.07 * swayLift;
      transformed.z += cos(uSway * 0.9 + swayAnchor.y * 0.3 + swayAnchor.x * 0.17) * 0.05 * swayLift;`,
    );
};
CANOPY.customProgramCacheKey = () => "canopy-sway";

function buildItems(layout: StreetLayout, index: CityIndex, density: number) {
  const lamps = layout.lamps;
  const trees = thin(layout.treePositions, Math.max(0.4, density));
  const benches = thin(layout.benchPoses, Math.max(0.5, density));
  const planters = thin(layout.planterPositions, Math.max(0.5, density));
  const bollards = layout.bollards;
  const accentOf = (districtId: string) =>
    index.districtsById[districtId]?.theme.accent ?? LAMP_COLOR;

  const posts: InstanceTransform[] = lamps.map((p) => ({
    x: p.x,
    y: 2.3,
    z: p.z,
    sx: 0.09,
    sy: 4.6,
    sz: 0.09,
  }));
  const heads: InstanceTransform[] = lamps.map((p) => ({
    x: p.x,
    y: 4.82,
    z: p.z,
    sx: 0.56,
    sy: 0.22,
    sz: 0.56,
  }));
  const bulbs: InstanceTransform[] = lamps.map((p) => ({
    x: p.x,
    y: 4.62,
    z: p.z,
    sx: 0.17,
    sy: 0.14,
    sz: 0.17,
  }));
  const pools: InstanceTransform[] = lamps.map((p) => ({
    x: p.x,
    y: 0.026,
    z: p.z,
    tiltX: -Math.PI / 2,
    sx: 9,
    sy: 9,
    sz: 1,
    color: mixHex(LAMP_COLOR, accentOf(p.districtId), 0.3),
  }));
  // Every other lamp carries a banner on the open side; arms and banners are grouped by district.
  const arms: InstanceTransform[] = [];
  const bannersByDistrict = new Map<string, InstanceTransform[]>();
  lamps.forEach((p, i) => {
    if (i % 2 === 1) return;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const bx = p.x + fx * 0.47;
    const bz = p.z + fz * 0.47;
    arms.push({
      x: p.x + fx * 0.4,
      y: 4.15,
      z: p.z + fz * 0.4,
      yaw: p.facing,
      sx: 0.05,
      sy: 0.05,
      sz: 0.85,
    });
    arms.push({
      x: p.x + fx * 0.4,
      y: 2.55,
      z: p.z + fz * 0.4,
      yaw: p.facing,
      sx: 0.05,
      sy: 0.05,
      sz: 0.85,
    });
    const list = bannersByDistrict.get(p.districtId) ?? [];
    list.push({ x: bx, y: 3.35, z: bz, yaw: p.facing + Math.PI / 2, sx: 0.78, sy: 1.55, sz: 1 });
    bannersByDistrict.set(p.districtId, list);
  });

  const trunks: InstanceTransform[] = [];
  const canopies: InstanceTransform[] = [];
  trees.forEach((p, i) => {
    const h = hashString(`${p.x.toFixed(1)}:${p.z.toFixed(1)}`);
    const scale = 0.85 + ((h >>> 3) % 100) / 300;
    const tint = CANOPY_TINTS[h % CANOPY_TINTS.length]!;
    const yaw = ((h >>> 8) % 628) / 100;
    trunks.push({ x: p.x, y: 1.4 * scale, z: p.z, sx: 0.16, sy: 2.8 * scale, sz: 0.16 });
    canopies.push({
      x: p.x,
      y: 3.7 * scale,
      z: p.z,
      sx: 1.5 * scale,
      sy: 1.35 * scale,
      sz: 1.5 * scale,
      color: tint,
    });
    canopies.push({
      x: p.x + Math.sin(yaw) * 0.6,
      y: 3.1 * scale,
      z: p.z + Math.cos(yaw) * 0.6,
      sx: 1.05 * scale,
      sy: 0.95 * scale,
      sz: 1.05 * scale,
      color: tint,
    });
    canopies.push({
      x: p.x - Math.sin(yaw) * 0.5,
      y: 3.35 * scale,
      z: p.z - Math.cos(yaw) * 0.55,
      sx: 0.95 * scale,
      sy: 0.9 * scale,
      sz: 0.95 * scale,
      color: CANOPY_TINTS[(h + 1 + i) % CANOPY_TINTS.length],
    });
  });
  // A tree-pit grate ring at every trunk foot.
  const pits: InstanceTransform[] = trees.map((p) => ({
    x: p.x,
    y: 0.135,
    z: p.z,
    sx: 0.55,
    sy: 0.02,
    sz: 0.55,
  }));

  const seats: InstanceTransform[] = [];
  const backs: InstanceTransform[] = [];
  const legs: InstanceTransform[] = [];
  for (const b of benches) {
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const rx = fz;
    const rz = -fx;
    for (const s of [-1, 0, 1])
      seats.push({
        x: b.x + fx * s * 0.15,
        y: 0.45,
        z: b.z + fz * s * 0.15,
        yaw: b.yaw,
        sx: 1.8,
        sy: 0.06,
        sz: 0.12,
      });
    backs.push({
      x: b.x - fx * 0.24,
      y: 0.74,
      z: b.z - fz * 0.24,
      yaw: b.yaw,
      tiltX: -0.18,
      sx: 1.8,
      sy: 0.4,
      sz: 0.05,
    });
    for (const s of [-1, 1])
      legs.push({
        x: b.x + rx * 0.72 * s,
        y: 0.22,
        z: b.z + rz * 0.72 * s,
        yaw: b.yaw,
        sx: 0.08,
        sy: 0.44,
        sz: 0.42,
      });
  }

  const boxes: InstanceTransform[] = planters.map((p) => ({
    x: p.x,
    y: 0.28,
    z: p.z,
    sx: 1.25,
    sy: 0.56,
    sz: 1.25,
  }));
  const soil: InstanceTransform[] = planters.map((p) => ({
    x: p.x,
    y: 0.57,
    z: p.z,
    sx: 1.12,
    sy: 0.04,
    sz: 1.12,
  }));
  const bushes: InstanceTransform[] = planters.flatMap((p, i) => [
    {
      x: p.x - 0.2,
      y: 0.95,
      z: p.z + 0.1,
      sx: 0.55,
      sy: 0.45,
      sz: 0.55,
      color: CANOPY_TINTS[i % 3],
    },
    {
      x: p.x + 0.25,
      y: 0.9,
      z: p.z - 0.15,
      sx: 0.42,
      sy: 0.38,
      sz: 0.42,
      color: CANOPY_TINTS[(i + 1) % 3],
    },
  ]);

  const stems: InstanceTransform[] = bollards.map((p) => ({
    x: p.x,
    y: 0.47,
    z: p.z,
    sx: 0.12,
    sy: 0.94,
    sz: 0.12,
  }));
  const caps: InstanceTransform[] = bollards.map((p) => ({
    x: p.x,
    y: 0.96,
    z: p.z,
    sx: 0.09,
    sy: 0.06,
    sz: 0.09,
  }));

  // District accent bleeding onto the pavement in front of every open storefront.
  const occupied = new Set(index.occupiedParcels.map((p) => p.id));
  const washes: InstanceTransform[] = [];
  for (const s of layout.sidewalks) {
    if (s.kind !== "forecourt" || !s.parcelId || !occupied.has(s.parcelId)) continue;
    const parcel = index.parcelsById[s.parcelId];
    if (!parcel) continue;
    const f = parcelFacing(parcel);
    const c = segmentCenter(s);
    const w = parcel.size.width;
    washes.push({
      x: c.x + f.x * 2.2,
      y: 0.024,
      z: c.z + f.z * 2.2,
      tiltX: -Math.PI / 2,
      tiltZ: -parcel.rotationY,
      sx: w * 1.1,
      sy: 7,
      sz: 1,
      color: accentOf(parcel.districtId),
    });
  }

  return {
    posts,
    heads,
    bulbs,
    pools,
    arms,
    bannersByDistrict,
    trunks,
    canopies,
    pits,
    seats,
    backs,
    legs,
    boxes,
    soil,
    bushes,
    stems,
    caps,
    washes,
  };
}

function Banners({
  district,
  items,
  texSize,
}: {
  district: District;
  items: InstanceTransform[];
  texSize: number;
}) {
  const material = useMemo(() => {
    const tex = bannerTexture(district.name, district.theme.accent, texSize);
    return new THREE.MeshStandardMaterial({
      map: tex,
      color: tex ? "#ffffff" : district.theme.accent,
      emissive: new THREE.Color(district.theme.accent),
      emissiveMap: tex,
      emissiveIntensity: 0.35,
      roughness: 0.85,
    });
  }, [district.name, district.theme.accent, texSize]);
  useEffect(() => () => material.dispose(), [material]);
  // A double-sided plane mirrors its text on the back. Two front-faced sets (one turned around)
  // read correctly from both pavements; only the facing one survives culling, so they never fight.
  const both = useMemo(
    () => [...items, ...items.map((it) => ({ ...it, yaw: (it.yaw ?? 0) + Math.PI }))],
    [items],
  );
  return <StaticInstances geometry={GEO.plane} material={material} items={both} />;
}

export function Props() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const items = useMemo(
    () => (layout && index ? buildItems(layout, index, quality.propDensity) : null),
    [layout, index, quality.propDensity],
  );
  const poolMat = useMemo(() => {
    const tex = lightPoolTexture(128);
    return new THREE.MeshBasicMaterial({
      map: tex,
      color: "#ffffff",
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);
  const washMat = useMemo(() => {
    const tex = lightPoolTexture(128);
    return new THREE.MeshBasicMaterial({
      map: tex,
      color: "#ffffff",
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);
  useEffect(
    () => () => {
      poolMat.dispose();
      washMat.dispose();
    },
    [poolMat, washMat],
  );
  useFrame((state) => {
    swayTime.value = state.clock.elapsedTime;
  });
  if (!items || !index) return null;
  const cast = quality.tier === "high";
  const texSize = Math.min(512, quality.maxTextureSize);
  return (
    <group>
      <StaticInstances
        geometry={GEO.cylinder}
        material={MAT.darkMetal}
        items={items.posts}
        castShadow={cast}
        receiveShadow
      />
      <StaticInstances
        geometry={GEO.box}
        material={MAT.darkMetal}
        items={items.heads}
        castShadow={cast}
      />
      <StaticInstances geometry={GEO.sphere} material={SODIUM} items={items.bulbs} />
      <StaticInstances geometry={GEO.plane} material={poolMat} items={items.pools} />
      <StaticInstances geometry={GEO.plane} material={washMat} items={items.washes} />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={items.arms} />
      {[...items.bannersByDistrict.entries()].map(([districtId, banners]) => {
        const district = index.districtsById[districtId];
        return district ? (
          <Banners key={districtId} district={district} items={banners} texSize={texSize} />
        ) : null;
      })}
      <StaticInstances
        geometry={GEO.cylinder}
        material={TRUNK}
        items={items.trunks}
        castShadow={cast}
        receiveShadow
      />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={items.pits} />
      <StaticInstances
        geometry={GEO.sphere}
        material={CANOPY}
        items={items.canopies}
        castShadow={cast}
        receiveShadow
      />
      <StaticInstances
        geometry={GEO.box}
        material={BENCH_SLAT}
        items={items.seats}
        castShadow={cast}
        receiveShadow
      />
      <StaticInstances
        geometry={GEO.box}
        material={BENCH_WOOD}
        items={items.backs}
        castShadow={cast}
      />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={items.legs} />
      <StaticInstances
        geometry={GEO.box}
        material={PLANTER}
        items={items.boxes}
        castShadow={cast}
        receiveShadow
      />
      <StaticInstances geometry={GEO.box} material={MAT.soil} items={items.soil} />
      <StaticInstances geometry={GEO.sphere} material={CANOPY} items={items.bushes} receiveShadow />
      <StaticInstances
        geometry={GEO.cylinder}
        material={MAT.darkMetal}
        items={items.stems}
        receiveShadow
      />
      <StaticInstances geometry={GEO.cylinder} material={BOLLARD_CAP} items={items.caps} />
    </group>
  );
}
