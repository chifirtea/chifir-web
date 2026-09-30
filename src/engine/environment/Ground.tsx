"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { FOUNTAIN_RADIUS, getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { asphaltTexture, stoneTexture } from "@/engine/storefront/facade";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, tinted } from "@/engine/storefront/templates/parts";
import { tiledDisc, tiledPlane } from "./geometry";

/**
 * The ground: a 600 m asphalt plane, the stone plaza disc at the origin and its fountain (basin,
 * animated water, a lit jet and a few sparkles on medium/high).
 */

function rippleTexture(size: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#1a3a52";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(200, 230, 255, 0.18)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * size + Math.sin(i * 1.7) * 3;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y + Math.sin(x / 11 + i) * 2.5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export function Ground() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const plaza = layout?.plaza ?? { x: 0, z: 0, radius: 30 };
  const plazaAccent = useMemo(() => {
    const d = index?.snapshot.districts.find((x) => x.theme.pavement === "plaza");
    return d?.theme.accent ?? "#ffc46b";
  }, [index]);

  const groundGeo = useMemo(() => tiledPlane(600, 600, 90, 90), []);
  const groundMat = useMemo(() => {
    const tex = asphaltTexture(Math.min(256, quality.maxTextureSize));
    return new THREE.MeshStandardMaterial({ color: tex ? "#9a9ca3" : "#1e1f24", map: tex, roughness: 0.96, metalness: 0 });
  }, [quality.maxTextureSize]);
  const plazaGeo = useMemo(() => tiledDisc(plaza.radius, 64, plaza.radius / 2.5), [plaza.radius]);
  const plazaMat = useMemo(() => {
    const tex = stoneTexture(mixHex("#6d675f", plazaAccent, 0.08), Math.min(256, quality.maxTextureSize));
    return new THREE.MeshStandardMaterial({ color: tex ? "#ffffff" : "#6d675f", map: tex, roughness: 0.8, metalness: 0.02 });
  }, [plazaAccent, quality.maxTextureSize]);
  const basinGeo = useMemo(() => new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.25, 0.9, 32, 1, true), []);
  const stone = tinted("#8e877c", { roughness: 0.85 });

  const ripple = useMemo(() => rippleTexture(128), []);
  const water = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2d6a8f",
        map: ripple,
        roughness: 0.12,
        metalness: 0.35,
        transparent: true,
        opacity: 0.86,
        emissive: new THREE.Color("#0f2e44"),
        emissiveIntensity: 0.7,
      }),
    [ripple],
  );
  const jet = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#cfe9ff", transparent: true, opacity: 0.45, roughness: 0.2, emissive: new THREE.Color("#9fd4ff"), emissiveIntensity: 0.8 }),
    [],
  );
  useEffect(
    () => () => {
      ripple?.dispose();
      water.dispose();
      jet.dispose();
    },
    [ripple, water, jet],
  );

  const jetRef = useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    if (ripple) {
      ripple.offset.x += delta * 0.03;
      ripple.offset.y -= delta * 0.02;
    }
    const t = state.clock.elapsedTime;
    water.opacity = 0.82 + Math.sin(t * 1.3) * 0.04;
    if (jetRef.current) jetRef.current.scale.y = 1.5 + Math.sin(t * 2.1) * 0.12;
  });

  return (
    <group>
      <mesh geometry={groundGeo} material={groundMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow />
      <mesh geometry={plazaGeo} material={plazaMat} rotation={[-Math.PI / 2, 0, 0]} position={[plaza.x, 0.012, plaza.z]} receiveShadow />
      {/* Fountain */}
      <group position={[plaza.x, 0, plaza.z]}>
        <mesh geometry={basinGeo} material={stone} position={[0, 0.45, 0]} castShadow receiveShadow />
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 0.9, 0]} scale={[FOUNTAIN_RADIUS + 0.3, 0.1, FOUNTAIN_RADIUS + 0.3]} />
        <mesh geometry={GEO.cylinder} material={tinted("#5a554d", { roughness: 0.9 })} position={[0, 0.1, 0]} scale={[FOUNTAIN_RADIUS - 0.05, 0.2, FOUNTAIN_RADIUS - 0.05]} />
        <mesh geometry={GEO.cylinder} material={water} position={[0, 0.72, 0]} scale={[FOUNTAIN_RADIUS - 0.15, 0.04, FOUNTAIN_RADIUS - 0.15]} />
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 1.2, 0]} scale={[0.7, 2.4, 0.7]} castShadow />
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 2.5, 0]} scale={[1.7, 0.35, 1.7]} castShadow />
        <mesh geometry={GEO.cylinder} material={water} position={[0, 2.66, 0]} scale={[1.55, 0.04, 1.55]} />
        <mesh ref={jetRef} geometry={GEO.cylinder} material={jet} position={[0, 3.4, 0]} scale={[0.14, 1.5, 0.14]} />
        <pointLight position={[0, 1.4, 0]} color="#7fc9ff" intensity={16} distance={14} decay={2} />
        {quality.tier !== "low" && (
          <Sparkles count={quality.tier === "high" ? 90 : 45} scale={[9, 3, 9]} position={[0, 2.4, 0]} size={3} speed={0.5} opacity={0.55} color="#dff3ff" noise={0.6} />
        )}
      </group>
    </group>
  );
}
