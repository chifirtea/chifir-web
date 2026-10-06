"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { districtAt } from "@/city/cityIndex";
import { useQuality } from "@/engine/canvas/qualityStore";
import { playerRig } from "@/engine/player/playerRig";
import { AMBIENCE, type Ambience } from "./atmosphere";
import { mulberry32 } from "./prng";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";
import { skylineWindowsTexture } from "./textures";

/**
 * Dusk-to-night sky: a vertex-coloured dome with a warm city-glow horizon that fades through
 * violet to a deep zenith, a distant skyline silhouette with lit windows that dissolves into the
 * fog, a soft moon and stars on medium/high. Fog is lerped toward the ambience of the district the
 * player is standing in, so Food Street breathes neon haze and Fashion Street stays cool.
 */

const BELOW = "#0b0910";
const HORIZON_WARM = "#5a3246";
const HORIZON_COOL = "#3a2c5a";
const LOW = "#2a2044";
const MID = "#141a32";
const ZENITH = "#05060e";
const BACKGROUND = "#0d0b14";
const DOME_RADIUS = 320;
const DISTRICT_INTERVAL = 0.25;

function domeGeometry(): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(DOME_RADIUS, 36, 20);
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const warm = new THREE.Color(HORIZON_WARM);
  const cool = new THREE.Color(HORIZON_COOL);
  const below = new THREE.Color(BELOW);
  const low = new THREE.Color(LOW);
  const mid = new THREE.Color(MID);
  const zenith = new THREE.Color(ZENITH);
  const horizon = new THREE.Color();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / DOME_RADIUS;
    // The glow is warmest toward the streets (±X) and cooler toward the square (−Z).
    const az = Math.atan2(pos.getX(i), pos.getZ(i));
    horizon.lerpColors(cool, warm, 0.5 + 0.5 * Math.abs(Math.sin(az)));
    if (y < 0) c.lerpColors(horizon, below, Math.min(1, -y * 4));
    else if (y < 0.1) c.lerpColors(horizon, low, y / 0.1);
    else if (y < 0.32) c.lerpColors(low, mid, (y - 0.1) / 0.22);
    else c.lerpColors(mid, zenith, Math.min(1, (y - 0.32) / 0.5));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A ring of dark towers far outside the city, seen through the fog as a glowing skyline. */
function skyline(): InstanceTransform[] {
  const rand = mulberry32(0x5c1);
  const out: InstanceTransform[] = [];
  const n = 84;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.04;
    const r = 235 + rand() * 45;
    const w = 9 + rand() * 16;
    const h = 7 + Math.pow(rand(), 1.6) * 42;
    out.push({ x: Math.sin(a) * r, y: h / 2, z: Math.cos(a) * r, yaw: a, sx: w, sy: h, sz: 8 + rand() * 10 });
  }
  return out;
}

const domeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
const moonMaterial = new THREE.MeshBasicMaterial({ color: "#efe9f5", fog: false, toneMapped: false });
const moonGlow = new THREE.MeshBasicMaterial({ color: "#c9c4e6", fog: false, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false });
const sphere = new THREE.SphereGeometry(1, 16, 12);
const SKYLINE = skyline();

export function Sky() {
  const quality = useQuality();
  const scene = useThree((s) => s.scene);
  const index = useCityStore((s) => s.index);
  const dome = useMemo(() => domeGeometry(), []);
  const skylineMat = useMemo(() => {
    const tex = skylineWindowsTexture(64);
    return new THREE.MeshBasicMaterial({ map: tex, color: tex ? "#ffffff" : "#0a0a12", fog: true });
  }, []);
  useEffect(
    () => () => {
      dome.dispose();
      skylineMat.dispose();
    },
    [dome, skylineMat],
  );

  // Fog: installed once, then steered toward the current district's ambience every frame.
  const target = useRef<Ambience>(AMBIENCE.warm);
  const acc = useRef(DISTRICT_INTERVAL);
  useEffect(() => {
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.Fog(target.current.fog, target.current.fogNear, target.current.fogFar);
    return () => {
      scene.background = prevBackground;
      scene.fog = prevFog;
    };
  }, [scene]);
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current >= DISTRICT_INTERVAL && index) {
      acc.current = 0;
      const district = districtAt(index, playerRig.x, playerRig.z);
      target.current = AMBIENCE[district?.theme.ambience ?? "warm"];
    }
    const fog = scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    const k = 1 - Math.exp(-delta * 0.9);
    fog.color.lerp(fogTargetColor.set(target.current.fog), k);
    fog.near += (target.current.fogNear - fog.near) * k;
    fog.far += (target.current.fogFar - fog.far) * k;
  });

  return (
    <group>
      <mesh geometry={dome} material={domeMaterial} renderOrder={-10} frustumCulled={false} />
      <mesh geometry={sphere} material={moonMaterial} position={[-130, 150, -250]} scale={[6, 6, 6]} renderOrder={-9} />
      <mesh geometry={sphere} material={moonGlow} position={[-130, 150, -250]} scale={[10, 10, 10]} renderOrder={-9} />
      <StaticInstances geometry={SKYLINE_BOX} material={skylineMat} items={SKYLINE} />
      {quality.tier !== "low" && <Stars radius={280} depth={50} count={quality.tier === "high" ? 2000 : 1000} factor={3} saturation={0} fade speed={0.15} />}
    </group>
  );
}

const fogTargetColor = new THREE.Color();
/** Unit box with UVs repeated so the window texture tiles at roughly building scale. */
const SKYLINE_BOX = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
  return g;
})();
