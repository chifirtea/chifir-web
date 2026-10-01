"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { districtAt } from "@/city/cityIndex";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { playerRig } from "@/engine/player/playerRig";
import { AMBIENCE } from "./atmosphere";

/**
 * Street lighting: a hemisphere fill tinted by the district the player stands in (so faces stay
 * readable on phones without flattening the night), a cool moon key light whose tight shadow
 * camera follows the player in 60 m steps, and a few real sodium lights parked on the lamps
 * nearest the player (two on low/medium, four on high). Every other lamp is emissive only.
 */

const SNAP = 60;
const SHADOW_EXTENT = 58;
const UPDATE_INTERVAL = 0.25;
const LAMP_COLOR = "#ffb257";
const MAX_LAMPS = 4;

export function Lighting() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const lamps = useMemo(() => (index ? getStreetLayout(index).lampPositions : []), [index]);
  const key = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const lampRefs = useRef<Array<THREE.PointLight | null>>([]);
  const acc = useRef(UPDATE_INTERVAL);
  const lastSnap = useRef({ x: NaN, z: NaN });
  const skyTarget = useMemo(() => new THREE.Color(AMBIENCE.warm.sky), []);
  const groundTarget = useMemo(() => new THREE.Color(AMBIENCE.warm.ground), []);
  const activeLamps = quality.tier === "high" ? MAX_LAMPS : 2;

  useEffect(() => {
    const light = key.current;
    if (!light || !target.current) return;
    light.target = target.current;
    const cam = light.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
  }, []);

  // Resizing the shadow map at runtime requires dropping the old render target.
  useEffect(() => {
    const light = key.current;
    if (!light) return;
    light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
    light.shadow.needsUpdate = true;
  }, [quality.shadowMapSize]);

  useFrame((_, delta) => {
    // Hemisphere tint eases toward the district ambience every frame (cheap, no allocations).
    const h = hemi.current;
    if (h) {
      const k = 1 - Math.exp(-delta * 0.9);
      h.color.lerp(skyTarget, k);
      h.groundColor.lerp(groundTarget, k);
    }
    acc.current += delta;
    if (acc.current < UPDATE_INTERVAL) return;
    acc.current = 0;
    if (index) {
      const ambience = AMBIENCE[districtAt(index, playerRig.x, playerRig.z)?.theme.ambience ?? "warm"];
      skyTarget.set(ambience.sky);
      groundTarget.set(ambience.ground);
    }
    const sx = Math.round(playerRig.x / SNAP) * SNAP;
    const sz = Math.round(playerRig.z / SNAP) * SNAP;
    if (sx !== lastSnap.current.x || sz !== lastSnap.current.z) {
      lastSnap.current = { x: sx, z: sz };
      key.current?.position.set(sx + 45, 80, sz - 35);
      target.current?.position.set(sx, 0, sz);
      target.current?.updateMatrixWorld();
    }
    // The nearest lamps get real light: a tiny insertion sort into fixed slots, no allocation.
    const best = nearest;
    for (let k = 0; k < MAX_LAMPS; k++) {
      best[k] = -1;
      bestDist[k] = Infinity;
    }
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i]!;
      const d = (l.x - playerRig.x) ** 2 + (l.z - playerRig.z) ** 2;
      let slot = -1;
      for (let k = 0; k < activeLamps; k++) {
        if (d < bestDist[k]!) {
          slot = k;
          break;
        }
      }
      if (slot < 0) continue;
      for (let k = activeLamps - 1; k > slot; k--) {
        best[k] = best[k - 1]!;
        bestDist[k] = bestDist[k - 1]!;
      }
      best[slot] = i;
      bestDist[slot] = d;
    }
    for (let k = 0; k < MAX_LAMPS; k++) {
      const light = lampRefs.current[k];
      if (!light) continue;
      const idx = best[k]!;
      const l = idx >= 0 && k < activeLamps ? lamps[idx] : undefined;
      light.visible = Boolean(l);
      if (l) light.position.set(l.x, 4.6, l.z);
    }
  });

  return (
    <group>
      <hemisphereLight ref={hemi} args={[AMBIENCE.warm.sky, AMBIENCE.warm.ground, 0.7]} />
      <ambientLight color="#ffd9b0" intensity={0.14} />
      <directionalLight
        ref={key}
        color="#a9bdea"
        intensity={0.8}
        position={[45, 80, -35]}
        castShadow={quality.shadows}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
        shadow-radius={2}
      />
      <object3D ref={target} />
      {Array.from({ length: MAX_LAMPS }, (_, k) => (
        <pointLight
          key={k}
          ref={(el) => {
            lampRefs.current[k] = el;
          }}
          color={LAMP_COLOR}
          intensity={46}
          distance={24}
          decay={2}
          position={[0, 4.6, 0]}
          visible={false}
        />
      ))}
    </group>
  );
}

const nearest: number[] = [-1, -1, -1, -1];
const bestDist: number[] = [Infinity, Infinity, Infinity, Infinity];
