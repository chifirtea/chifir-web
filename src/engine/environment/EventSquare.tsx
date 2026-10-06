"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BrandPalette, CityEvent, District } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { getStreetLayout, type StagePose } from "@/city/layout";
import type { QualityTier } from "@/engine/canvas/quality";
import { useQuality } from "@/engine/canvas/qualityStore";
import { loadImageTexture } from "@/engine/interior/useImageTexture";
import { eventWhenLabel } from "@/engine/storefront/events";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, tinted } from "@/engine/storefront/templates/parts";
import { formatLaunchTime } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import { countdownFor, screenMode, stageEvent, type ScreenMode } from "./eventStage";
import { createOverlay, drawScreenOverlay, tickerTexture, type ScreenState } from "./eventScreen";
import { ParticleField } from "./Particles";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";
import { puffTexture, radialGlowTexture } from "./textures";

/**
 * Event Square as a stage, derived from the venue parcel and the city index: a riser beside the
 * avenue to The Hall, a truss with colour-cycling moving heads, floor light strips, and a big LED
 * screen showing the live-or-next event: its hero image (or looping video, or a procedural brand
 * visual when neither loads), a countdown before the start, OPEN NOW + a LIVE chip and ticker
 * while live, and a livestream placeholder when the event has a stream URL. Everything that moves
 * is tier-gated; the countdown redraws once a second from the city clock.
 */

const RISER_H = 0.9;
const FIXTURES = 6;
const BEAM_H = 7.4;
const SCREEN_ASPECT = 16 / 9;

const CITY_BRAND: BrandPalette = { primary: "#14121a", secondary: "#8B5CF6", accent: "#F0ABFC", onPrimary: "#F5F3FF" };

const RISER = tinted("#1c1c22", { roughness: 0.75, metalness: 0.1 });
const DECK = tinted("#2e2e36", { roughness: 0.6, metalness: 0.15 });
const HOUSING = tinted("#121217", { roughness: 0.6, metalness: 0.3 });
const TRUSS = tinted("#2a2b31", { roughness: 0.4, metalness: 0.8 });
const BEZEL = tinted("#06060a", { roughness: 0.3, metalness: 0.5 });

const BRAND_VISUAL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BRAND_VISUAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec2 vUv;
void main() {
  vec2 p = vUv;
  float t = uTime * 0.18;
  float w1 = sin(p.x * 3.0 + t * 2.0 + sin(p.y * 2.0 + t));
  float w2 = sin((p.x + p.y) * 4.0 - t * 1.7);
  float band = smoothstep(0.25, 0.85, 0.5 + 0.5 * w1 * w2);
  vec3 col = mix(uA, uB, clamp(p.y + 0.25 * w1, 0.0, 1.0));
  col = mix(col, uC, band * 0.55);
  // Slow diagonal sweep and a faint LED grid.
  float sweep = smoothstep(0.0, 0.08, abs(fract(p.x * 0.6 - p.y * 0.3 - t * 0.4) - 0.5) - 0.42);
  col += uC * (1.0 - sweep) * 0.18;
  float grid = step(0.5, fract(p.x * 96.0)) * step(0.5, fract(p.y * 54.0));
  col *= 0.9 + 0.1 * grid;
  float v = smoothstep(1.25, 0.35, length(p - 0.5) * 1.5);
  gl_FragColor = vec4(col * v, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Clone-and-crop so any aspect covers the 16:9 screen; the shared cached texture stays untouched. */
function coverFit(texture: THREE.Texture | null): THREE.Texture | null {
  if (!texture) return null;
  const img = texture.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return texture;
  const aspect = w / h;
  if (Math.abs(aspect - SCREEN_ASPECT) < 0.02) return texture;
  const t = texture.clone();
  if (aspect > SCREEN_ASPECT) {
    t.repeat.set(SCREEN_ASPECT / aspect, 1);
    t.offset.set((1 - SCREEN_ASPECT / aspect) / 2, 0);
  } else {
    t.repeat.set(1, aspect / SCREEN_ASPECT);
    t.offset.set(0, (1 - aspect / SCREEN_ASPECT) / 2);
  }
  t.needsUpdate = true;
  return t;
}

function useHeroImage(url: string | undefined): THREE.Texture | null {
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture | null }>({ url: "", texture: null });
  useEffect(() => {
    if (!url) return;
    let active = true;
    const unsubscribe = loadImageTexture(url, (texture) => {
      if (active) setLoaded({ url, texture });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [url]);
  const texture = url && loaded.url === url ? loaded.texture : null;
  const fitted = useMemo(() => coverFit(texture), [texture]);
  useEffect(() => () => {
    if (fitted && fitted !== texture) fitted.dispose();
  }, [fitted, texture]);
  return fitted;
}

/** A muted, looping, inline video as a texture; null until it can play or when it fails. */
function useHeroVideo(url: string | undefined): THREE.VideoTexture | null {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  useEffect(() => {
    if (!url || typeof document === "undefined" || !/^https?:\/\//i.test(url)) return;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    let active = true;
    let tex: THREE.VideoTexture | null = null;
    const onReady = () => {
      if (!active || tex) return;
      tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      setTexture(tex);
      video.play().catch(() => undefined);
    };
    const onError = () => {
      if (active) setTexture(null);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
    video.load();
    return () => {
      active = false;
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
      tex?.dispose();
      setTexture(null);
    };
  }, [url]);
  return texture;
}

function BrandVisual({ brand, width, height }: { brand: BrandPalette; width: number; height: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uA: { value: new THREE.Color(brand.primary) },
      uB: { value: new THREE.Color(mixHex(brand.primary, brand.secondary, 0.7)) },
      uC: { value: new THREE.Color(brand.accent) },
    }),
    [brand],
  );
  useFrame((state) => {
    if (material.current) material.current.uniforms["uTime"]!.value = state.clock.elapsedTime;
  });
  return (
    <mesh geometry={GEO.plane} scale={[width, height, 1]}>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={BRAND_VISUAL_VERTEX} fragmentShader={BRAND_VISUAL_FRAGMENT} />
    </mesh>
  );
}

function ScreenBackdrop({ event, brand, width, height }: { event: CityEvent | null; brand: BrandPalette; width: number; height: number }) {
  const video = useHeroVideo(event?.heroVideoUrl);
  const image = useHeroImage(event?.heroImageUrl);
  const map = video ?? image;
  const material = useMemo(() => (map ? new THREE.MeshBasicMaterial({ map, toneMapped: true }) : null), [map]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!material) return <BrandVisual brand={brand} width={width} height={height} />;
  return <mesh geometry={GEO.plane} material={material} scale={[width, height, 1]} />;
}

function ScreenOverlay({ event, brand, district, width, height }: { event: CityEvent | null; brand: BrandPalette; district: District | undefined; width: number; height: number }) {
  const index = useCityStore((s) => s.index);
  const overlay = useMemo(() => createOverlay(), []);
  const material = useMemo(
    () => (overlay ? new THREE.MeshBasicMaterial({ map: overlay.texture, transparent: true, depthWrite: false }) : null),
    [overlay],
  );
  useEffect(
    () => () => {
      material?.dispose();
      overlay?.texture.dispose();
    },
    [material, overlay],
  );
  const lastKey = useRef("");
  const merchantName = event?.merchantId && index ? index.merchantsById[event.merchantId]?.name : undefined;

  // Redraw only when the visible text changes: once a second during a countdown, otherwise never.
  useFrame(() => {
    if (!overlay) return;
    const t = clockNow();
    const mode: ScreenMode = screenMode(event, t);
    const countdown = event && mode === "countdown" ? countdownFor(event, t) : "";
    const key = `${event?.id ?? "-"}|${mode}|${countdown}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const state: ScreenState =
      event && mode !== "idle"
        ? {
            mode,
            title: event.title,
            eyebrow: merchantName ?? district?.name ?? "Event Square",
            countdown,
            when: mode === "live" ? `until ${formatLaunchTime(event.endsAt, t)}` : eventWhenLabel(event, t),
            brand,
            livestream: Boolean(event.livestreamUrl),
            tagline: "",
          }
        : {
            mode: "idle",
            title: district?.name ?? "Event Square",
            eyebrow: "Chifir",
            countdown: "",
            when: "",
            brand,
            livestream: false,
            tagline: district?.description ?? "Something is always scheduled.",
          };
    drawScreenOverlay(overlay.ctx, state);
    overlay.texture.needsUpdate = true;
  });
  if (!material) return null;
  return <mesh geometry={GEO.plane} material={material} scale={[width, height, 1]} />;
}

function Ticker({ title, accent, width }: { title: string; accent: string; width: number }) {
  const texture = useMemo(() => tickerTexture(title, accent), [title, accent]);
  const material = useMemo(() => (texture ? new THREE.MeshBasicMaterial({ map: texture }) : null), [texture]);
  useEffect(
    () => () => {
      material?.dispose();
      texture?.dispose();
    },
    [material, texture],
  );
  useFrame((_, delta) => {
    if (texture) texture.offset.x = (texture.offset.x + delta * 0.045) % 1;
  });
  if (!material || !texture) return null;
  // The strip shows a third of the texture at a time so the text stays large.
  texture.repeat.x = 0.34;
  return <mesh geometry={GEO.plane} material={material} scale={[width, 0.5, 1]} />;
}

/** Six moving heads on the truss: additive beam cones that pan, tilt and cycle through the palette. */
function MovingHeads({ brand, districtAccent, animate, live, x0, x1, y, z }: { brand: BrandPalette; districtAccent: string; animate: boolean; live: boolean; x0: number; x1: number; y: number; z: number }) {
  const pivots = useRef<Array<THREE.Group | null>>([]);
  const materials = useMemo(
    () =>
      Array.from({ length: FIXTURES }, () =>
        new THREE.MeshBasicMaterial({ color: brand.accent, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
      ),
    [brand.accent],
  );
  const headMats = useMemo(
    () => Array.from({ length: FIXTURES }, () => new THREE.MeshStandardMaterial({ color: "#0b0b0f", emissive: new THREE.Color(brand.accent), emissiveIntensity: 2.2, roughness: 0.4 })),
    [brand.accent],
  );
  const palette = useMemo(() => [new THREE.Color(brand.accent), new THREE.Color(brand.secondary), new THREE.Color(districtAccent), new THREE.Color("#ffffff")], [brand, districtAccent]);
  const cone = useMemo(() => new THREE.ConeGeometry(1.5, BEAM_H - 0.4, 14, 1, true), []);
  useEffect(
    () => () => {
      cone.dispose();
      for (const m of materials) m.dispose();
      for (const m of headMats) m.dispose();
    },
    [cone, materials, headMats],
  );
  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime * (live ? 1.6 : 0.9);
    for (let i = 0; i < FIXTURES; i++) {
      const g = pivots.current[i];
      if (!g) continue;
      g.rotation.z = Math.sin(t * 0.7 + i * 1.1) * 0.45;
      g.rotation.x = Math.cos(t * 0.5 + i * 0.8) * 0.28 + 0.15;
      const phase = (t * 0.12 + i / FIXTURES) % 1;
      const a = Math.floor(phase * palette.length);
      const b = (a + 1) % palette.length;
      const k = phase * palette.length - a;
      const col = materials[i]!.color;
      col.copy(palette[a]!).lerp(palette[b]!, k);
      headMats[i]!.emissive.copy(col);
    }
  });
  return (
    <group>
      {Array.from({ length: FIXTURES }, (_, i) => {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / FIXTURES;
        return (
          <group key={i} position={[x, y, z]}>
            <mesh geometry={GEO.box} material={headMats[i]} scale={[0.28, 0.34, 0.28]} />
            <group
              ref={(el) => {
                pivots.current[i] = el;
              }}
              rotation={[0.15, 0, (i - (FIXTURES - 1) / 2) * 0.12]}
            >
              <mesh geometry={cone} material={materials[i]} position={[0, -(BEAM_H - 0.4) / 2 - 0.2, 0]} />
            </group>
          </group>
        );
      })}
    </group>
  );
}

function Stage({ stage, event, brand, district, quality, index }: { stage: StagePose; event: CityEvent | null; brand: BrandPalette; district: District | undefined; quality: QualityTier; index: CityIndex }) {
  const live = Boolean(event && screenMode(event, index.builtAt) === "live");
  const animate = quality !== "low";
  const W = stage.width;
  const D = stage.depth;
  const riserW = W - 2;
  const riserX = -1;
  const screenW = riserW - 0.8;
  const screenH = screenW / SCREEN_ASPECT;
  const screenY = RISER_H + 0.75 + screenH / 2;
  const screenZ = -D / 2 + 0.56;
  const accent = district?.theme.accent ?? brand.accent;
  const strip = useMemo(() => tinted(accent, { emissive: accent, emissiveIntensity: 1.4, roughness: 0.4 }), [accent]);
  const skirt = useMemo(() => tinted(brand.secondary, { emissive: brand.secondary, emissiveIntensity: 0.25, roughness: 0.7 }), [brand.secondary]);

  const truss = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    const ux = riserW / 2 - 0.35;
    const uz = D / 2 - 0.9;
    for (const s of [-1, 1]) out.push({ x: riserX + s * ux, y: BEAM_H / 2 + 0.5, z: uz, sx: 0.28, sy: BEAM_H + 1, sz: 0.28 });
    out.push({ x: riserX, y: BEAM_H + 0.9, z: uz, sx: riserW - 0.4, sy: 0.26, sz: 0.26 });
    out.push({ x: riserX, y: BEAM_H + 0.3, z: uz, sx: riserW - 0.4, sy: 0.12, sz: 0.12 });
    // Lattice diagonals between the two chords.
    const n = Math.round(riserW / 1.1);
    for (let i = 0; i < n; i++) {
      const x = riserX - (riserW - 0.6) / 2 + ((riserW - 0.6) * (i + 0.5)) / n;
      out.push({ x, y: BEAM_H + 0.6, z: uz, tiltZ: i % 2 === 0 ? 0.9 : -0.9, sx: 0.06, sy: 0.8, sz: 0.06 });
    }
    return out;
  }, [riserX, riserW, D]);
  const floorStrips = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 7; i++) out.push({ x: riserX + s * (riserW / 2 + 0.3), y: 0.03, z: D / 2 + 1.4 + i * 1.3, sx: 0.28, sy: 0.05, sz: 0.8 });
    }
    out.push({ x: riserX, y: RISER_H + 0.03, z: D / 2 + 0.02, sx: riserW, sy: 0.06, sz: 0.08 });
    return out;
  }, [riserX, riserW, D]);
  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    strip.emissiveIntensity = live ? 1.3 + Math.sin(t * 4.2) * 0.7 : 1.2 + Math.sin(t * 1.6) * 0.3;
  });

  const haze = useMemo(() => [[riserX - 3, RISER_H + 0.4, -0.5], [riserX + 2.5, RISER_H + 0.4, 0.5]] as const, [riserX]);
  const motes = useMemo(() => [[riserX - 4, 1.2, D / 2 + 4], [riserX + 3, 1.4, D / 2 + 6], [riserX, 2, D / 2 + 2]] as const, [riserX, D]);
  const puff = useMemo(() => puffTexture(64), []);
  const glow = useMemo(() => radialGlowTexture(64), []);

  return (
    <group position={[stage.x, 0, stage.z]} rotation={[0, stage.yaw, 0]}>
      <mesh geometry={GEO.box} material={RISER} position={[riserX, RISER_H / 2, 0]} scale={[riserW, RISER_H, D]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={DECK} position={[riserX, RISER_H + 0.02, 0]} scale={[riserW - 0.1, 0.04, D - 0.1]} receiveShadow />
      <mesh geometry={GEO.plane} material={skirt} position={[riserX, RISER_H / 2 - 0.05, D / 2 + 0.01]} scale={[riserW, RISER_H - 0.16, 1]} />
      {/* Steps down the right-hand end of the riser. */}
      <mesh geometry={GEO.box} material={RISER} position={[W / 2 - 1.5, 0.3, 0]} scale={[1, 0.6, D * 0.5]} castShadow />
      <mesh geometry={GEO.box} material={RISER} position={[W / 2 - 0.5, 0.15, 0]} scale={[1, 0.3, D * 0.5]} />
      {/* Screen housing and the LED surface. */}
      <mesh geometry={GEO.box} material={HOUSING} position={[riserX, RISER_H + 0.3 + (screenH + 1.1) / 2, -D / 2 + 0.25]} scale={[riserW - 0.2, screenH + 1.1, 0.5]} castShadow />
      <mesh geometry={GEO.plane} material={BEZEL} position={[riserX, screenY, screenZ - 0.02]} scale={[screenW + 0.3, screenH + 0.3, 1]} />
      <group position={[riserX, screenY, screenZ]}>
        <ScreenBackdrop event={event} brand={brand} width={screenW} height={screenH} />
        <group position={[0, 0, 0.012]}>
          <ScreenOverlay event={event} brand={brand} district={district} width={screenW} height={screenH} />
        </group>
      </group>
      {live && event && (
        <group position={[riserX, RISER_H + 0.42, screenZ + 0.012]}>
          <Ticker title={event.title} accent={accent} width={screenW} />
        </group>
      )}
      <StaticInstances geometry={GEO.box} material={TRUSS} items={truss} castShadow={quality === "high"} />
      <MovingHeads brand={brand} districtAccent={accent} animate={animate} live={live} x0={riserX - riserW / 2 + 1.2} x1={riserX + riserW / 2 - 1.2} y={BEAM_H + 0.55} z={D / 2 - 0.9} />
      <StaticInstances geometry={GEO.box} material={strip} items={floorStrips} />
      {animate && live && <pointLight position={[riserX, 5.5, D / 2 + 1]} color={brand.accent} intensity={44} distance={28} decay={2} />}
      {quality === "high" && live && (
        <spotLight position={[riserX, BEAM_H, D / 2 - 0.5]} color={accent} intensity={120} angle={0.7} penumbra={0.6} distance={40} decay={2} target-position={[riserX, 0, D / 2 + 9]} />
      )}
      {animate && <ParticleField emitters={haze} perEmitter={10} texture={puff} color={mixHex(accent, "#ffffff", 0.6)} lifetime={8} size={1.4} grow={1.4} spread={1.6} rise={3.2} drift={0.8} opacity={0.075} seed={11} />}
      {quality === "high" && <ParticleField emitters={motes} perEmitter={24} texture={glow} color={mixHex(accent, "#ffffff", 0.3)} lifetime={7} size={0.09} spread={4} rise={2} drift={1.2} opacity={0.7} additive seed={23} />}
    </group>
  );
}

export function EventSquare() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const stage = layout?.stage ?? null;
  const venue = stage && index ? index.parcelsById[stage.venueParcelId] : undefined;
  // Live-first selection changes at phase boundaries, which rebuild the index; `builtAt` is the
  // consistent clock for that derivation.
  const event = useMemo(() => (index && venue ? stageEvent(index, venue, index.builtAt) : null), [index, venue]);
  const district = stage && index ? index.districtsById[stage.districtId] : undefined;
  const brand = useMemo<BrandPalette>(() => {
    const merchant = event?.merchantId && index ? index.merchantsById[event.merchantId] : undefined;
    if (merchant) return merchant.brand;
    const accent = district?.theme.accent ?? CITY_BRAND.accent;
    return { ...CITY_BRAND, secondary: mixHex(accent, "#000000", 0.35), accent };
  }, [event, index, district]);
  if (!stage || !index) return null;
  return <Stage stage={stage} event={event} brand={brand} district={district} quality={quality.tier} index={index} />;
}
