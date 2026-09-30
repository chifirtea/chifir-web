"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { playerRig } from "@/engine/player/playerRig";

/**
 * Street lighting: a hemisphere fill, a cool moon key light whose tight shadow camera follows the
 * player in 60 m steps, and two real sodium lights parked on the lamps nearest the player. Every
 * other lamp is emissive only.
 */

const SNAP = 60;
const SHADOW_EXTENT = 58;
const UPDATE_INTERVAL = 0.25;
const LAMP_COLOR = "#ffb257";

export function Lighting() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const lamps = useMemo(() => (index ? getStreetLayout(index).lampPositions : []), [index]);
  const key = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const lampA = useRef<THREE.PointLight>(null);
  const lampB = useRef<THREE.PointLight>(null);
  const acc = useRef(UPDATE_INTERVAL);
  const lastSnap = useRef({ x: NaN, z: NaN });

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
    acc.current += delta;
    if (acc.current < UPDATE_INTERVAL) return;
    acc.current = 0;
    const sx = Math.round(playerRig.x / SNAP) * SNAP;
    const sz = Math.round(playerRig.z / SNAP) * SNAP;
    if (sx !== lastSnap.current.x || sz !== lastSnap.current.z) {
      lastSnap.current = { x: sx, z: sz };
      key.current?.position.set(sx + 45, 80, sz - 35);
      target.current?.position.set(sx, 0, sz);
      target.current?.updateMatrixWorld();
    }
    // Two nearest lamps get real light.
    let bestA = -1;
    let bestB = -1;
    let dA = Infinity;
    let dB = Infinity;
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i]!;
      const d = (l.x - playerRig.x) ** 2 + (l.z - playerRig.z) ** 2;
      if (d < dA) {
        dB = dA;
        bestB = bestA;
        dA = d;
        bestA = i;
      } else if (d < dB) {
        dB = d;
        bestB = i;
      }
    }
    const a = bestA >= 0 ? lamps[bestA] : undefined;
    const b = bestB >= 0 ? lamps[bestB] : undefined;
    if (lampA.current && a) lampA.current.position.set(a.x, 4.6, a.z);
    if (lampB.current && b) lampB.current.position.set(b.x, 4.6, b.z);
  });

  return (
    <group>
      <hemisphereLight args={["#6f7fb8", "#4a3626", 0.62]} />
      <ambientLight color="#ffd9b0" intensity={0.16} />
      <directionalLight
        ref={key}
        color="#a9bdea"
        intensity={0.85}
        position={[45, 80, -35]}
        castShadow={quality.shadows}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
        shadow-radius={2}
      />
      <object3D ref={target} />
      <pointLight ref={lampA} color={LAMP_COLOR} intensity={48} distance={24} decay={2} position={[0, 4.6, 0]} />
      <pointLight ref={lampB} color={LAMP_COLOR} intensity={48} distance={24} decay={2} position={[0, 4.6, 0]} />
    </group>
  );
}
