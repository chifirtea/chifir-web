"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A field of camera-facing sprites animated entirely on the GPU: one draw call, no per-frame
 * CPU work beyond bumping a time uniform. Used for steam over Food Street grates, haze over the
 * stage and light motes on high. Each particle loops through its own life offset; `seed` keeps the
 * field identical across loads.
 */
export interface ParticleFieldProps {
  /** Emitter origins (x, y, z); particles are spread across them round-robin. */
  emitters: ReadonlyArray<readonly [number, number, number]>;
  perEmitter: number;
  texture: THREE.Texture | null;
  color: string;
  /** Seconds one particle lives before it respawns at its emitter. */
  lifetime: number;
  /** Sprite size (m) at birth and how much it grows over its life (1 = doubles). */
  size: number;
  grow?: number;
  /** Horizontal radius particles are born in, how far they rise and how far they wander. */
  spread: number;
  rise: number;
  drift?: number;
  opacity: number;
  additive?: boolean;
  seed?: number;
}

const VERTEX = /* glsl */ `
attribute vec3 aOrigin;
attribute vec4 aSeed;
uniform float uTime;
uniform float uLife;
uniform float uSize;
uniform float uGrow;
uniform float uSpread;
uniform float uRise;
uniform float uDrift;
varying vec2 vUv;
varying float vAlpha;
varying float vFogDepth;
void main() {
  float t = fract(uTime / uLife + aSeed.z);
  vec3 origin = aOrigin + vec3((aSeed.x - 0.5) * 2.0 * uSpread, 0.0, (aSeed.y - 0.5) * 2.0 * uSpread);
  float wx = sin(uTime * 0.9 + aSeed.z * 6.2831) * uDrift * t;
  float wz = cos(uTime * 0.7 + aSeed.w * 6.2831) * uDrift * t;
  vec3 center = origin + vec3(wx, uRise * t, wz);
  float s = uSize * (0.7 + aSeed.w * 0.6) * (1.0 + uGrow * t);
  vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
  mvPosition.xy += position.xy * s;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vAlpha = sin(t * 3.14159);
  vFogDepth = -mvPosition.z;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAdditive;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying float vAlpha;
varying float vFogDepth;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vAlpha * uOpacity;
  vec3 col = uColor * tex.rgb;
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  // Additive sprites fade to nothing in the fog; alpha sprites fade toward the fog colour.
  col = mix(col, mix(fogColor, vec3(0.0), uAdditive), fogFactor);
  a *= mix(1.0, 1.0 - fogFactor, uAdditive);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ParticleField({
  emitters,
  perEmitter,
  texture,
  color,
  lifetime,
  size,
  grow = 0,
  spread,
  rise,
  drift = 0,
  opacity,
  additive = false,
  seed = 1,
}: ParticleFieldProps) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const count = emitters.length * perEmitter;

  const geometry = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    const origins = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    const rand = mulberry(seed);
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (let i = 0; i < count; i++) {
      const e = emitters[i % emitters.length] ?? [0, 0, 0];
      origins[i * 3] = e[0];
      origins[i * 3 + 1] = e[1];
      origins[i * 3 + 2] = e[2];
      seeds[i * 4] = rand();
      seeds[i * 4 + 1] = rand();
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
    }
    for (const e of emitters) {
      cx += e[0] / emitters.length;
      cy += e[1] / emitters.length;
      cz += e[2] / emitters.length;
    }
    geo.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(origins, 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    let radius = 0;
    for (const e of emitters) radius = Math.max(radius, Math.hypot(e[0] - cx, e[1] - cy, e[2] - cz));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy + rise / 2, cz), radius + rise + spread + drift + size * (1 + grow) * 2);
    return geo;
  }, [emitters, count, seed, rise, spread, drift, size, grow]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLife: { value: lifetime },
      uSize: { value: size },
      uGrow: { value: grow },
      uSpread: { value: spread },
      uRise: { value: rise },
      uDrift: { value: drift },
      uMap: { value: texture },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uAdditive: { value: additive ? 1 : 0 },
      fogColor: { value: new THREE.Color("#000000") },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    }),
    // The material is rebuilt when any look parameter changes; uTime is driven per frame.
    [lifetime, size, grow, spread, rise, drift, texture, color, opacity, additive],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const m = material.current;
    if (!m) return;
    m.uniforms["uTime"]!.value = state.clock.elapsedTime;
    const fog = state.scene.fog;
    if (fog instanceof THREE.Fog) {
      (m.uniforms["fogColor"]!.value as THREE.Color).copy(fog.color);
      m.uniforms["fogNear"]!.value = fog.near;
      m.uniforms["fogFar"]!.value = fog.far;
    }
  });

  if (count === 0 || !texture) return null;
  return (
    <mesh geometry={geometry} frustumCulled renderOrder={5}>
      <shaderMaterial
        key={`${additive}`}
        ref={material}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </mesh>
  );
}
