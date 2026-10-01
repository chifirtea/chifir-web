"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { FOUNTAIN_RADIUS, FOUNTAIN_SEAT_WIDTH, getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { asphaltTexture } from "@/engine/storefront/facade";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, tinted } from "@/engine/storefront/templates/parts";
import { getDuskEnvMap } from "./atmosphere";
import { tiledDisc, tiledPlane } from "./geometry";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";
import { lightPoolTexture, pavementTexture } from "./textures";

/**
 * The ground: a 600 m asphalt plane, the plaza disc in the plaza district's pavement with an
 * accent inlay ring, and the fountain: seating step, basin, shader-animated water, a ring of
 * arcing jets around the centre column, an underwater light and spray sparkles on medium/high.
 */

const WATER_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying float vFogDepth;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  vFogDepth = -mvPosition.z;
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uAccent;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying vec3 vWorld;
varying float vFogDepth;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p);
  float t = uTime;
  float rings = sin(d * 70.0 - t * 3.2) * 0.5 + 0.5;
  float cross = sin(p.x * 48.0 + t * 1.4) * sin(p.y * 44.0 - t * 1.1);
  float h = rings * 0.55 + cross * 0.45;
  vec3 col = mix(uDeep, uLight, smoothstep(0.15, 0.95, h) * 0.75);
  // Caustic-like bright threads near the centre column and a faint accent tint at the rim.
  float threads = smoothstep(0.82, 1.0, rings) * smoothstep(0.5, 0.0, d) * 0.6;
  col += uLight * threads;
  col = mix(col, uAccent, smoothstep(0.3, 0.5, d) * 0.12);
  float alpha = 0.9;
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  col = mix(col, fogColor, fogFactor);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ARC_COUNT = 6;

export function Ground() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const plaza = layout?.plaza ?? { x: 0, z: 0, radius: 30 };
  const plazaTheme = useMemo(() => {
    const d = index?.snapshot.districts.find((x) => x.theme.pavement === "plaza") ?? index?.snapshot.districts[0];
    return { accent: d?.theme.accent ?? "#ffc46b", pavement: d?.theme.pavement ?? "plaza" } as const;
  }, [index]);
  const wet = quality.tier === "high";

  const groundGeo = useMemo(() => tiledPlane(600, 600, 90, 90), []);
  const groundMat = useMemo(() => {
    const tex = asphaltTexture(Math.min(256, quality.maxTextureSize));
    return new THREE.MeshStandardMaterial({
      color: tex ? "#9a9ca3" : "#1e1f24",
      map: tex,
      roughness: wet ? 0.5 : 0.96,
      metalness: wet ? 0.18 : 0,
      envMap: wet ? getDuskEnvMap() : null,
      envMapIntensity: 0.7,
    });
  }, [quality.maxTextureSize, wet]);
  const plazaGeo = useMemo(() => tiledDisc(plaza.radius, 64, plaza.radius / 2.5), [plaza.radius]);
  const plazaMat = useMemo(() => {
    const tex = pavementTexture(plazaTheme.pavement, plazaTheme.accent, Math.min(256, quality.maxTextureSize));
    return new THREE.MeshStandardMaterial({ color: tex ? "#ffffff" : "#6d675f", map: tex, roughness: wet ? 0.55 : 0.78, metalness: wet ? 0.1 : 0.02, envMap: wet ? getDuskEnvMap() : null, envMapIntensity: 0.5 });
  }, [plazaTheme, quality.maxTextureSize, wet]);
  const inlayGeo = useMemo(() => new THREE.RingGeometry(plaza.radius * 0.5, plaza.radius * 0.5 + 0.3, 72), [plaza.radius]);
  const inlayInnerGeo = useMemo(() => new THREE.RingGeometry(FOUNTAIN_RADIUS + FOUNTAIN_SEAT_WIDTH + 1.6, FOUNTAIN_RADIUS + FOUNTAIN_SEAT_WIDTH + 1.85, 64), []);
  const inlayMat = useMemo(
    () => tinted(mixHex(plazaTheme.accent, "#000000", 0.25), { emissive: plazaTheme.accent, emissiveIntensity: 0.22, roughness: 0.6, metalness: 0.2 }),
    [plazaTheme.accent],
  );
  const basinGeo = useMemo(() => new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.25, 0.9, 40, 1, true), []);
  const seatGeo = useMemo(() => new THREE.CylinderGeometry(FOUNTAIN_RADIUS + FOUNTAIN_SEAT_WIDTH, FOUNTAIN_RADIUS + FOUNTAIN_SEAT_WIDTH + 0.1, 0.42, 48), []);
  const stone = tinted("#8e877c", { roughness: 0.85 });
  const seatStone = tinted("#9a9185", { roughness: 0.8 });
  const poolMat = useMemo(() => {
    const tex = lightPoolTexture(128);
    return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(plazaTheme.accent), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
  }, [plazaTheme.accent]);

  const waterUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color("#163a55") },
      uLight: { value: new THREE.Color("#8fd3ff") },
      uAccent: { value: new THREE.Color(plazaTheme.accent) },
      fogColor: { value: new THREE.Color("#000000") },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    }),
    [plazaTheme.accent],
  );
  const water = useRef<THREE.ShaderMaterial>(null);
  const jet = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#cfe9ff", transparent: true, opacity: 0.5, roughness: 0.15, emissive: new THREE.Color("#9fd4ff"), emissiveIntensity: 0.9, depthWrite: false }),
    [],
  );
  const arcs = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (let i = 0; i < ARC_COUNT; i++) {
      const a = (i / ARC_COUNT) * Math.PI * 2;
      const tilt = 0.62;
      const len = 2.6;
      const x = Math.sin(a) * (0.9 + Math.sin(tilt) * len * 0.5);
      const z = Math.cos(a) * (0.9 + Math.sin(tilt) * len * 0.5);
      // A cylinder along local Y tilted outward: tiltX leans it along the radial direction once yawed.
      out.push({ x, y: 2.75 + Math.cos(tilt) * len * 0.5, z, yaw: a, tiltX: tilt, sx: 0.09, sy: len, sz: 0.09 });
    }
    return out;
  }, []);
  useEffect(
    () => () => {
      groundMat.dispose();
      plazaMat.dispose();
      inlayGeo.dispose();
      inlayInnerGeo.dispose();
      basinGeo.dispose();
      seatGeo.dispose();
      poolMat.dispose();
      jet.dispose();
    },
    [groundMat, plazaMat, inlayGeo, inlayInnerGeo, basinGeo, seatGeo, poolMat, jet],
  );

  const jetRef = useRef<THREE.Mesh>(null);
  const arcGroup = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const m = water.current;
    if (m) {
      m.uniforms["uTime"]!.value = t;
      const fog = state.scene.fog;
      if (fog instanceof THREE.Fog) {
        (m.uniforms["fogColor"]!.value as THREE.Color).copy(fog.color);
        m.uniforms["fogNear"]!.value = fog.near;
        m.uniforms["fogFar"]!.value = fog.far;
      }
    }
    if (jetRef.current) jetRef.current.scale.y = 1.6 + Math.sin(t * 2.1) * 0.14;
    if (arcGroup.current) arcGroup.current.scale.y = 1 + Math.sin(t * 1.7 + 1) * 0.05;
  });

  return (
    <group>
      <mesh geometry={groundGeo} material={groundMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow />
      <mesh geometry={plazaGeo} material={plazaMat} rotation={[-Math.PI / 2, 0, 0]} position={[plaza.x, 0.012, plaza.z]} receiveShadow />
      <mesh geometry={inlayGeo} material={inlayMat} rotation={[-Math.PI / 2, 0, 0]} position={[plaza.x, 0.018, plaza.z]} />
      <mesh geometry={inlayInnerGeo} material={inlayMat} rotation={[-Math.PI / 2, 0, 0]} position={[plaza.x, 0.018, plaza.z]} />
      {/* Fountain */}
      <group position={[plaza.x, 0, plaza.z]}>
        <mesh geometry={GEO.plane} material={poolMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[30, 30, 1]} />
        <mesh geometry={seatGeo} material={seatStone} position={[0, 0.21, 0]} castShadow receiveShadow />
        <mesh geometry={basinGeo} material={stone} position={[0, 0.45, 0]} castShadow receiveShadow />
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 0.9, 0]} scale={[FOUNTAIN_RADIUS + 0.3, 0.1, FOUNTAIN_RADIUS + 0.3]} />
        <mesh geometry={GEO.cylinder} material={tinted("#5a554d", { roughness: 0.9 })} position={[0, 0.1, 0]} scale={[FOUNTAIN_RADIUS - 0.05, 0.2, FOUNTAIN_RADIUS - 0.05]} />
        <mesh geometry={GEO.cylinder} position={[0, 0.74, 0]} scale={[FOUNTAIN_RADIUS - 0.15, 0.04, FOUNTAIN_RADIUS - 0.15]}>
          <shaderMaterial ref={water} uniforms={waterUniforms} vertexShader={WATER_VERTEX} fragmentShader={WATER_FRAGMENT} transparent depthWrite={false} />
        </mesh>
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 1.2, 0]} scale={[0.7, 2.4, 0.7]} castShadow />
        <mesh geometry={GEO.cylinder} material={stone} position={[0, 2.5, 0]} scale={[1.7, 0.35, 1.7]} castShadow />
        <mesh geometry={GEO.cylinder} material={tinted("#2d6a8f", { emissive: "#0f2e44", emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.3 })} position={[0, 2.66, 0]} scale={[1.55, 0.04, 1.55]} />
        <mesh ref={jetRef} geometry={GEO.cylinder} material={jet} position={[0, 3.4, 0]} scale={[0.14, 1.6, 0.14]} />
        <group ref={arcGroup}>
          <StaticInstances geometry={GEO.cylinder} material={jet} items={arcs} />
        </group>
        <pointLight position={[0, 1.4, 0]} color="#7fc9ff" intensity={18} distance={16} decay={2} />
        {quality.tier !== "low" && (
          <Sparkles count={quality.tier === "high" ? 110 : 50} scale={[10, 3.5, 10]} position={[0, 2.6, 0]} size={3} speed={0.5} opacity={0.6} color="#dff3ff" noise={0.6} />
        )}
      </group>
    </group>
  );
}
