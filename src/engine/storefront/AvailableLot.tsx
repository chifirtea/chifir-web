"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import type { AABB } from "@/engine/physics/types";
import type { Hotspot } from "@/engine/interaction/hotspots";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { GEO, MAT, localCollider, tinted, useMaxTextureSize, useTextureMaterial } from "./templates/parts";
import { localToWorld } from "./types";
import { makeLabelTexture } from "./signage";

/**
 * An unoccupied parcel: a low stone platform with a soft sodium edge glow and a small standing
 * sign. Quiet on purpose; it reads as real estate waiting for a tenant, not an error.
 */

const SODIUM = "#ffc46b";
const INK = "#1a1d24";
const FOG = "#e9e6df";

function signLocal(parcel: Parcel): { x: number; z: number } {
  return { x: 0, z: parcel.size.depth / 2 - 1.3 };
}

export function availableLotColliders(parcel: Parcel): AABB[] {
  return [localCollider(parcel, "lotsign", signLocal(parcel), 0.4, 0.4)];
}

export function availableLotHotspot(parcel: Parcel): Hotspot {
  const s = signLocal(parcel);
  const p = localToWorld(parcel, { x: s.x, z: s.z + 1.6 });
  return {
    id: `lot:${parcel.id}`,
    kind: "info",
    label: parcel.status === "reserved" ? "This lot is reserved" : "This lot is available",
    x: p.x,
    z: p.z,
    radius: 2.2,
    payload: {},
  };
}

export function AvailableLot({ parcel }: { parcel: Parcel }) {
  const maxTex = useMaxTextureSize();
  const w = parcel.size.width - 1.6;
  const d = parcel.size.depth - 1.6;
  const reserved = parcel.status === "reserved";
  const texture = useMemo(
    () =>
      makeLabelTexture(reserved ? "Reserved" : "Available", {
        bg: INK,
        fg: reserved ? FOG : SODIUM,
        subtext: reserved ? "Opening soon" : "Your storefront here",
        accent: SODIUM,
        width: 512,
        height: 256,
        maxTextureSize: maxTex,
      }),
    [reserved, maxTex],
  );
  const material = useTextureMaterial(texture, 0.7, { roughness: 0.8, side: 2 });
  const edges = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: 0.09, z: d / 2 - 0.05, sx: w, sy: 0.02, sz: 0.06 },
      { x: 0, y: 0.09, z: -d / 2 + 0.05, sx: w, sy: 0.02, sz: 0.06 },
      { x: w / 2 - 0.05, y: 0.09, z: 0, sx: 0.06, sy: 0.02, sz: d },
      { x: -w / 2 + 0.05, y: 0.09, z: 0, sx: 0.06, sy: 0.02, sz: d },
    ],
    [w, d],
  );
  const sign = signLocal(parcel);
  return (
    <group position={[parcel.position.x, 0, parcel.position.z]} rotation={[0, parcel.rotationY, 0]}>
      <mesh geometry={GEO.box} material={tinted("#2b2c33", { roughness: 0.95 })} position={[0, 0.04, 0]} scale={[w, 0.08, d]} receiveShadow />
      <StaticInstances geometry={GEO.box} material={tinted(SODIUM, { emissive: SODIUM, emissiveIntensity: 0.45, roughness: 0.5 })} items={edges} />
      <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[sign.x, 1.1, sign.z]} scale={[0.05, 2.2, 0.05]} castShadow />
      <mesh geometry={GEO.plane} material={material} position={[sign.x, 2.05, sign.z + 0.03]} scale={[1.4, 0.7, 1]} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[sign.x, 2.05, sign.z - 0.02]} scale={[1.48, 0.78, 0.04]} />
    </group>
  );
}
