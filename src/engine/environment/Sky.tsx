"use client";

import { useEffect, useMemo } from "react";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { useQuality } from "@/engine/canvas/qualityStore";
import { useSceneAtmosphere } from "./atmosphere";

/**
 * Dusk sky: a vertex-coloured dome from a warm horizon to a deep zenith, a faint moon, stars on
 * medium/high, and scene fog matched to the horizon so the city fades believably.
 */

const HORIZON = "#3a2634";
const BELOW = "#141018";
const MID = "#1a1c30";
const ZENITH = "#07080f";
const FOG = "#1c1620";
const BACKGROUND = "#110f16";

function domeGeometry(): THREE.SphereGeometry {
  const radius = 420;
  const geo = new THREE.SphereGeometry(radius, 28, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos!.count * 3);
  const horizon = new THREE.Color(HORIZON);
  const below = new THREE.Color(BELOW);
  const mid = new THREE.Color(MID);
  const zenith = new THREE.Color(ZENITH);
  const c = new THREE.Color();
  for (let i = 0; i < pos!.count; i++) {
    const y = pos!.getY(i) / radius;
    if (y < 0) c.lerpColors(horizon, below, Math.min(1, -y * 3));
    else if (y < 0.22) c.lerpColors(horizon, mid, y / 0.22);
    else c.lerpColors(mid, zenith, Math.min(1, (y - 0.22) / 0.6));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

const domeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
const moonMaterial = new THREE.MeshBasicMaterial({ color: "#e9e6f2", fog: false, toneMapped: false });
const moonGlow = new THREE.MeshBasicMaterial({ color: "#c9c4e6", fog: false, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false });
const sphere = new THREE.SphereGeometry(1, 16, 12);

export function Sky() {
  const quality = useQuality();
  useSceneAtmosphere(BACKGROUND, { color: FOG, near: 70, far: 330 });
  const dome = useMemo(() => domeGeometry(), []);
  useEffect(() => () => dome.dispose(), [dome]);
  return (
    <group>
      <mesh geometry={dome} material={domeMaterial} renderOrder={-10} frustumCulled={false} />
      <mesh geometry={sphere} material={moonMaterial} position={[-150, 170, -300]} scale={[7, 7, 7]} renderOrder={-9} />
      <mesh geometry={sphere} material={moonGlow} position={[-150, 170, -300]} scale={[11, 11, 11]} renderOrder={-9} />
      {quality.tier !== "low" && <Stars radius={300} depth={60} count={quality.tier === "high" ? 1800 : 900} factor={3} saturation={0} fade speed={0.15} />}
    </group>
  );
}
