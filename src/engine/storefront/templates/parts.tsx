"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BrandPalette, Merchant, Parcel, Product } from "@/types/domain";
import type { QualityTier } from "@/engine/canvas/quality";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { aabbFromCenter, type AABB } from "@/engine/physics/types";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { hashString, mulberry32 } from "@/engine/environment/prng";
import { useImageTexture } from "@/engine/interior/useImageTexture";
import { useCityStore } from "@/city/cityStore";
import { FACADE_SETBACK } from "@/city/layout";
import { formatCents } from "@/lib/utils/money";
import { now } from "@/lib/time/clock";
import { monogram } from "@/lib/media/monogram";
import { localToWorld } from "../types";
import { FACADE_TILE_M, getFacadeMaterial } from "../facade";
import { evenlySpaced, tiledBox } from "../geometry";
import { openStatus } from "../hours";
import {
  glowColor,
  inkOn,
  makeGlowTexture,
  makeInitialTexture,
  makeLabelTexture,
  makeMenuTexture,
  makeOpenSignTexture,
  makePosterTexture,
  makeSignTexture,
  mixHex,
  type SignStyle,
} from "../signage";

/**
 * Shared, low-poly building blocks for the procedural storefront templates. Geometries and
 * plain materials live at module scope; brand-tinted materials are cached by colour.
 * Local space: origin at the parcel centre, façade toward +Z, metres.
 */

export type Lod = 0 | 1 | 2;

// ---------------------------------------------------------------------------
// Frame: where the building sits inside its parcel
// ---------------------------------------------------------------------------

export interface FrameSpec {
  /** Side setback (m) on each side. */
  side: number;
  /** Front setback; defaults to FACADE_SETBACK so façades sit at the back of the sidewalk. */
  front?: number;
  back?: number;
  floors: number;
  floorHeight?: number;
  parapet?: number;
}

export interface Frame {
  w: number;
  d: number;
  /** Total height including parapet. */
  h: number;
  /** Local z of the building centre. */
  cz: number;
  /** Local z of the façade plane. */
  faceZ: number;
  floorH: number;
  floors: number;
  parapet: number;
}

export function buildingFrame(parcel: Parcel, spec: FrameSpec): Frame {
  const front = spec.front ?? FACADE_SETBACK;
  const back = spec.back ?? 1;
  const w = Math.max(3, parcel.size.width - spec.side * 2);
  const d = Math.max(3, parcel.size.depth - front - back);
  const floorH = spec.floorHeight ?? 3.6;
  const parapet = spec.parapet ?? 0.5;
  const floors = Math.max(1, spec.floors);
  const cz = (back - front) / 2;
  return { w, d, h: floors * floorH + parapet, cz, faceZ: cz + d / 2, floorH, floors, parapet };
}

export function frameFootprint(frame: Frame): { width: number; depth: number; height: number } {
  return { width: frame.w, depth: frame.d, height: frame.h };
}

/** World-space AABB of the building box. */
export function frameCollider(parcel: Parcel, frame: Frame): AABB {
  const c = localToWorld(parcel, { x: 0, z: frame.cz });
  return aabbFromCenter(`building:${parcel.id}`, c.x, c.z, frame.w, frame.d, parcel.rotationY);
}

/** World-space AABB for a small local footprint (planters, posts, vitrines). */
export function localCollider(parcel: Parcel, id: string, local: { x: number; z: number }, width: number, depth: number): AABB {
  const c = localToWorld(parcel, local);
  return aabbFromCenter(`${id}:${parcel.id}`, c.x, c.z, width, depth, parcel.rotationY);
}

export function clampFloors(floors: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, floors));
}

// ---------------------------------------------------------------------------
// Shared geometry + materials
// ---------------------------------------------------------------------------

function pyramid(): THREE.ConeGeometry {
  const g = new THREE.ConeGeometry(Math.SQRT2, 1, 4);
  g.rotateY(Math.PI / 4);
  return g;
}

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  /** Square pyramid: footprint 2×2 before scaling, base at y = -0.5. */
  pyramid: pyramid(),
  /** Bottom half-disc facing +Z (awning scallops). */
  scallop: new THREE.CircleGeometry(0.5, 8, Math.PI, Math.PI),
  ring: new THREE.RingGeometry(0.7, 1, 24),
  /** Open cone for spot-light beams: apex at the top (y = +0.5), base radius 1. */
  cone: new THREE.ConeGeometry(1, 1, 16, 1, true),
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface TintOptions {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

/** Cached MeshStandardMaterial for a colour + options combination. */
export function tinted(color: string, opts: TintOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? ""}|${opts.metalness ?? ""}|${opts.emissive ?? ""}|${opts.emissiveIntensity ?? ""}|${opts.transparent ?? ""}|${opts.opacity ?? ""}|${opts.side ?? ""}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? "#000000",
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    matCache.set(key, m);
  }
  return m;
}

const glowMatCache = new Map<string, THREE.MeshBasicMaterial>();

/** Additive, unlit glow sprite material for a colour (shared; never mutated per instance). */
export function glowMaterial(color: string, opacity = 0.55): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let m = glowMatCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    glowMatCache.set(key, m);
  }
  return m;
}

export const MAT = {
  windowGlow: tinted("#1b1409", { emissive: "#ffb86b", emissiveIntensity: 1.15, roughness: 0.25, metalness: 0.3 }),
  windowCool: tinted("#0f1620", { emissive: "#9fc4ff", emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.4 }),
  frame: tinted("#14151a", { roughness: 0.6, metalness: 0.4 }),
  darkMetal: tinted("#23252b", { roughness: 0.45, metalness: 0.7 }),
  brushed: tinted("#8c9097", { roughness: 0.35, metalness: 0.85 }),
  roof: tinted("#2a2b31", { roughness: 0.95 }),
  slate: tinted("#25262c", { roughness: 0.9 }),
  plinth: tinted("#3a3b41", { roughness: 0.92 }),
  glassDark: tinted("#0c1622", { roughness: 0.16, metalness: 0.75, emissive: "#2c1f12", emissiveIntensity: 0.45 }),
  glassClear: tinted("#9fb7c9", { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.22, emissive: "#101820", emissiveIntensity: 0.3 }),
  doorGlass: tinted("#0d1218", { roughness: 0.2, metalness: 0.6, emissive: "#ffb570", emissiveIntensity: 0.7 }),
  transom: tinted("#fff1d6", { emissive: "#ffd9a0", emissiveIntensity: 1.6, roughness: 0.4 }),
  bulb: tinted("#fff3d8", { emissive: "#ffcf8a", emissiveIntensity: 2.4, roughness: 0.3 }),
  sconce: tinted("#ffe9c4", { emissive: "#ffc27a", emissiveIntensity: 2.0, roughness: 0.4 }),
  mannequin: tinted("#2c2c31", { roughness: 0.55, metalness: 0.15 }),
  foliage: tinted("#2f5d3a", { roughness: 0.95 }),
  foliageAlt: tinted("#3f6b3c", { roughness: 0.95 }),
  foliageDeep: tinted("#243f2a", { roughness: 0.95 }),
  planter: tinted("#3a3b40", { roughness: 0.9 }),
  soil: tinted("#2b241f", { roughness: 1 }),
  step: tinted("#4a4b50", { roughness: 0.9 }),
  ledOff: tinted("#1a1b20", { roughness: 0.5, metalness: 0.3 }),
  cardFrame: tinted("#f4f1ea", { roughness: 0.6 }),
};

export function useMaxTextureSize(): number {
  return useQualityStore((s) => s.settings.maxTextureSize);
}

export function useQualityTier(): QualityTier {
  return useQualityStore((s) => s.settings.tier);
}

export interface TextureMaterialOptions {
  roughness?: number;
  side?: THREE.Side;
  /** Multiplies the map (dims an image, e.g. a room seen through glass). */
  color?: string;
  transparent?: boolean;
  metalness?: number;
}

/** A per-instance material for a texture (map + emissive map). Disposed on unmount. */
export function useTextureMaterial(texture: THREE.Texture, emissiveIntensity: number, opts: TextureMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: new THREE.Color("#ffffff"),
        emissiveIntensity,
        color: opts.color ?? "#ffffff",
        roughness: opts.roughness ?? 0.6,
        metalness: opts.metalness ?? 0,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.transparent ?? false,
      }),
    [texture, emissiveIntensity, opts.roughness, opts.side, opts.color, opts.transparent, opts.metalness],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

// ---------------------------------------------------------------------------
// Shell: the building volume, its base and roof cap
// ---------------------------------------------------------------------------

export interface ShellProps {
  frame: Frame;
  merchant: Merchant;
  lod: Lod;
  /** Override the cap material (e.g. brand.secondary cornice). */
  capColor?: string;
  /** Dark stone skirting along the base (default true). */
  plinth?: boolean;
  /** Rooftop plant boxes, seeded by the parcel so neighbours differ. */
  roofUnits?: number;
  seed?: string;
}

export function Shell({ frame, merchant, lod, capColor, plinth = true, roofUnits = 0, seed = "" }: ShellProps) {
  const maxTex = useMaxTextureSize();
  const facade = merchant.storefrontConfig.facade;
  const material = getFacadeMaterial(facade, merchant.brand, maxTex);
  const bodyH = frame.h - frame.parapet;
  const geometry = useMemo(() => tiledBox(frame.w, bodyH, frame.d, FACADE_TILE_M[facade]), [frame.w, bodyH, frame.d, facade]);
  const cap = capColor ? tinted(capColor, { roughness: 0.85 }) : MAT.roof;
  const units = useMemo<InstanceTransform[]>(() => {
    if (roofUnits <= 0) return [];
    const rand = mulberry32(hashString(seed || merchant.id));
    const out: InstanceTransform[] = [];
    for (let i = 0; i < roofUnits; i++) {
      const w = 1.2 + rand() * 1.2;
      out.push({ x: (rand() - 0.5) * (frame.w - 3), y: frame.h + 0.35, z: frame.cz - frame.d * 0.15 - rand() * frame.d * 0.25, sx: w, sy: 0.7 + rand() * 0.3, sz: 0.9 + rand() * 0.6 });
    }
    return out;
  }, [roofUnits, seed, merchant.id, frame]);
  return (
    <group>
      <mesh geometry={geometry} material={material} position={[0, bodyH / 2, frame.cz]} scale={[frame.w, bodyH, frame.d]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={cap} position={[0, bodyH + frame.parapet / 2, frame.cz]} scale={[frame.w + 0.24, frame.parapet, frame.d + 0.24]} castShadow />
      {plinth && lod < 2 && (
        <mesh geometry={GEO.box} material={MAT.plinth} position={[0, 0.2, frame.cz]} scale={[frame.w + 0.08, 0.4, frame.d + 0.08]} receiveShadow />
      )}
      {lod < 2 && units.length > 0 && <StaticInstances geometry={GEO.box} material={MAT.roof} items={units} castShadow />}
    </group>
  );
}

/** A horizontal course line across the façade (string course between floors, cornice). */
export function Course({ frame, y, color, height = 0.16, depth = 0.26 }: { frame: Frame; y: number; color: string; height?: number; depth?: number }) {
  return <mesh geometry={GEO.box} material={tinted(color, { roughness: 0.85 })} position={[0, y, frame.faceZ + depth / 2 - 0.02]} scale={[frame.w + 0.1, height, depth]} castShadow />;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export interface WindowRowSpec {
  /** Centre height of the row. */
  y: number;
  paneW: number;
  paneH: number;
  /** Gap between panes. */
  gap?: number;
  /** Margin from the façade edges. */
  margin?: number;
  /** Local x range to leave empty (the door). */
  skip?: [number, number];
  /** Fixed count; otherwise as many as fit. */
  count?: number;
}

/** Pane transforms for a row on the façade plane. */
export function windowRow(frame: Frame, spec: WindowRowSpec): InstanceTransform[] {
  const gap = spec.gap ?? 0.9;
  const margin = spec.margin ?? 1.0;
  const usable = frame.w - margin * 2;
  const count = spec.count ?? Math.max(1, Math.floor((usable + gap) / (spec.paneW + gap)));
  const totalW = count * spec.paneW + (count - 1) * gap;
  const start = -totalW / 2 + spec.paneW / 2;
  const out: InstanceTransform[] = [];
  for (let i = 0; i < count; i++) {
    const x = start + i * (spec.paneW + gap);
    if (spec.skip && x + spec.paneW / 2 > spec.skip[0] && x - spec.paneW / 2 < spec.skip[1]) continue;
    out.push({ x, y: spec.y, z: frame.faceZ + 0.03, sx: spec.paneW, sy: spec.paneH, sz: 1 });
  }
  return out;
}

export interface WindowsProps {
  panes: InstanceTransform[];
  cool?: boolean;
  /** Frame border width in metres. */
  border?: number;
  /** Sill ledge under each pane and a lintel above (lod 0 detail). */
  sills?: boolean;
  sillColor?: string;
}

/** Instanced glowing panes with dark frames: two draw calls per building regardless of count. */
export function Windows({ panes, cool = false, border = 0.14, sills = false, sillColor = "#3a3b41" }: WindowsProps) {
  const frames = useMemo(
    () => panes.map((p) => ({ ...p, z: p.z - 0.015, sx: (p.sx ?? 1) + border, sy: (p.sy ?? 1) + border })),
    [panes, border],
  );
  const ledges = useMemo<InstanceTransform[]>(
    () => (sills ? panes.map((p) => ({ x: p.x, y: p.y - (p.sy ?? 1) / 2 - 0.04, z: p.z + 0.08, sx: (p.sx ?? 1) + 0.3, sy: 0.08, sz: 0.22 })) : []),
    [panes, sills],
  );
  if (panes.length === 0) return null;
  return (
    <group>
      <StaticInstances geometry={GEO.plane} material={MAT.frame} items={frames} />
      <StaticInstances geometry={GEO.plane} material={cool ? MAT.windowCool : MAT.windowGlow} items={panes} />
      {ledges.length > 0 && <StaticInstances geometry={GEO.box} material={tinted(sillColor, { roughness: 0.85 })} items={ledges} castShadow />}
    </group>
  );
}

/**
 * The room behind a glass front: the merchant's hero image dimmed and set back, so looking in
 * shows the brand's own imagery (a kitchen, a rail of clothes) rather than a flat glowing pane.
 */
export function HeroWindow({ merchant, x, y, width, height, z, depth = 0.6 }: { merchant: Merchant; x: number; y: number; width: number; height: number; z: number; depth?: number }) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(
    () => makePosterTexture({ title: merchant.tagline ?? merchant.name, eyebrow: merchant.name, brand: merchant.brand, width: 1024, height: 512, maxTextureSize: maxTex }),
    [merchant.name, merchant.tagline, merchant.brand, maxTex],
  );
  const image = useImageTexture(merchant.heroImageUrl, fallback);
  const material = useTextureMaterial(image, 0.42, { roughness: 0.9, color: "#7a7470" });
  const sideMat = tinted("#15161a", { roughness: 0.9 });
  return (
    <group>
      <mesh geometry={GEO.plane} material={material} position={[x, y, z - depth]} scale={[width, height, 1]} />
      <mesh geometry={GEO.box} material={sideMat} position={[x - width / 2, y, z - depth / 2]} scale={[0.04, height, depth]} />
      <mesh geometry={GEO.box} material={sideMat} position={[x + width / 2, y, z - depth / 2]} scale={[0.04, height, depth]} />
      <mesh geometry={GEO.box} material={sideMat} position={[x, y + height / 2, z - depth / 2]} scale={[width, 0.04, depth]} />
      <mesh geometry={GEO.box} material={tinted("#2a2420", { roughness: 0.9 })} position={[x, y - height / 2 + 0.02, z - depth / 2]} scale={[width, 0.04, depth]} />
      <mesh geometry={GEO.plane} material={MAT.glassClear} position={[x, y, z + 0.02]} scale={[width, height, 1]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Door
// ---------------------------------------------------------------------------

export interface DoorProps {
  frame: Frame;
  x: number;
  width?: number;
  height?: number;
  brand: BrandPalette;
  lod: Lod;
  /** Frame colour; defaults to a dark metal. */
  frameColor?: string;
  /** Double door: two panels with a centre mullion. */
  double?: boolean;
  /** Door plate number (from `houseNumber`). */
  number?: string;
  /** Monogram on the doormat (the merchant name). */
  matLabel?: string;
}

/** Portal (jambs + lintel), glazed door panel with warm interior glow, transom, step, mat and number. */
export function Door({ frame, x, width = 1.6, height = 2.6, brand, lod, frameColor, double = false, number, matLabel }: DoorProps) {
  const depth = 0.28;
  const jamb = 0.16;
  const z = frame.faceZ + depth / 2;
  const portal = useMemo<InstanceTransform[]>(
    () => [
      { x: x - width / 2 - jamb / 2, y: height / 2 + 0.05, z, sx: jamb, sy: height + 0.1, sz: depth },
      { x: x + width / 2 + jamb / 2, y: height / 2 + 0.05, z, sx: jamb, sy: height + 0.1, sz: depth },
      { x, y: height + 0.1 + jamb / 2 + 0.3, z, sx: width + jamb * 2, sy: jamb, sz: depth },
      ...(double ? [{ x, y: height / 2, z: frame.faceZ + 0.05, sx: 0.06, sy: height, sz: 0.06 }] : []),
      // Pull handle(s).
      ...(double
        ? [-1, 1].map((s) => ({ x: x + s * 0.12, y: height * 0.42, z: frame.faceZ + 0.08, sx: 0.03, sy: 0.5, sz: 0.03 }))
        : [{ x: x + width / 2 - 0.16, y: height * 0.42, z: frame.faceZ + 0.08, sx: 0.03, sy: 0.5, sz: 0.03 }]),
    ],
    [x, width, height, z, double, frame.faceZ],
  );
  const frameMat = frameColor ? tinted(frameColor, { roughness: 0.5, metalness: 0.3 }) : MAT.darkMetal;
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={frameMat} items={portal} castShadow />
      <mesh geometry={GEO.plane} material={MAT.doorGlass} position={[x, height / 2, frame.faceZ + 0.02]} scale={[width, height, 1]} />
      <mesh geometry={GEO.plane} material={MAT.transom} position={[x, height + 0.2, frame.faceZ + 0.02]} scale={[width, 0.28, 1]} />
      {lod === 0 && (
        <mesh geometry={GEO.box} material={MAT.step} position={[x, 0.04, frame.faceZ + 0.35]} scale={[width + 0.8, 0.08, 0.7]} receiveShadow />
      )}
      {lod === 0 && (
        <mesh
          geometry={GEO.box}
          material={tinted(brand.secondary, { roughness: 0.7 })}
          position={[x, height + 0.1 + jamb + 0.3 + 0.03, frame.faceZ + 0.2]}
          scale={[width + jamb * 2 + 0.3, 0.06, 0.5]}
        />
      )}
      {lod === 0 && matLabel && <Doormat x={x} z={frame.faceZ + 0.95} width={width + 0.2} brand={brand} label={matLabel} />}
      {lod === 0 && number && <HouseNumber x={x + width / 2 + jamb + 0.28} y={height - 0.25} z={frame.faceZ + 0.02} brand={brand} number={number} />}
    </group>
  );
}

/** A coir mat with the brand monogram, just outside the step. */
export function Doormat({ x, z, width, brand, label }: { x: number; z: number; width: number; brand: BrandPalette; label: string }) {
  const maxTex = useMaxTextureSize();
  const bg = mixHex(brand.primary, "#1a1613", 0.45);
  const texture = useMemo(
    () => makeLabelTexture(monogram(label), { bg, fg: brand.accent, width: 256, height: 128, radius: 0.08, tracking: 0.1, weight: 800, maxTextureSize: maxTex }),
    [label, bg, brand.accent, maxTex],
  );
  const material = useTextureMaterial(texture, 0.08, { roughness: 1 });
  return (
    <group position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={GEO.plane} material={material} scale={[width, width * 0.5, 1]} />
    </group>
  );
}

/** Brushed plate with the street number beside the door. */
export function HouseNumber({ x, y, z, brand, number }: { x: number; y: number; z: number; brand: BrandPalette; number: string }) {
  const maxTex = useMaxTextureSize();
  const texture = useMemo(
    () => makeLabelTexture(number, { bg: "#2b2d33", fg: mixHex(brand.accent, "#ffffff", 0.3), width: 256, height: 128, radius: 0.1, tracking: 0.08, weight: 800, maxTextureSize: maxTex }),
    [number, brand.accent, maxTex],
  );
  const material = useTextureMaterial(texture, 0.35, { roughness: 0.4, metalness: 0.5 });
  return (
    <group position={[x, y, z]}>
      <mesh geometry={GEO.box} material={MAT.brushed} position={[0, 0, 0.01]} scale={[0.34, 0.19, 0.02]} />
      <mesh geometry={GEO.plane} material={material} position={[0, 0, 0.025]} scale={[0.3, 0.15, 1]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Signage planes
// ---------------------------------------------------------------------------

export interface SignPlaneProps {
  text: string;
  style: SignStyle;
  brand: BrandPalette;
  /** Local position of the sign centre. */
  position: [number, number, number];
  width: number;
  /** Texture aspect (width / height). */
  aspect?: number;
  rotationY?: number;
  /** Backing panel behind the sign (default true). */
  backing?: boolean;
  doubleSided?: boolean;
  /** Second line for painted/backlit boards (tagline, category). */
  subtext?: string;
  /** Spill light onto the façade (medium/high; neon and backlit). Default true. */
  glow?: boolean;
}

const SIGN_EMISSIVE: Record<SignStyle, number> = { neon: 1.05, backlit: 0.95, marquee: 0.85, painted: 0.3 };

/**
 * Neon flicker: a slow shimmer plus a rare short dropout, driven by the frame clock. Writes two
 * numbers per frame and allocates nothing; only mounted on the high tier.
 */
function NeonFlicker({ sign, glow, seed }: { sign: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial | null; seed: number }) {
  const t = useRef(seed % 7);
  const base = sign.emissiveIntensity;
  const glowBase = glow?.opacity ?? 0;
  useFrame((_, delta) => {
    t.current += delta;
    const time = t.current;
    const shimmer = 1 - 0.05 * (0.5 + 0.5 * Math.sin(time * 17.3) * Math.sin(time * 5.1));
    const phase = time % 9.7;
    const drop = phase < 0.09 ? 0.45 : phase > 4.1 && phase < 4.16 ? 0.7 : 1;
    const f = shimmer * drop;
    sign.emissiveIntensity = base * f;
    if (glow) glow.opacity = glowBase * f;
  });
  return null;
}

export function SignPlane({ text, style, brand, position, width, aspect = 4, rotationY = 0, backing = true, doubleSided = false, subtext, glow = true }: SignPlaneProps) {
  const maxTex = useMaxTextureSize();
  const tier = useQualityTier();
  const texture = useMemo(
    () => makeSignTexture({ text, style, brand, subtext, width: 1024, height: Math.round(1024 / aspect), maxTextureSize: maxTex }),
    [text, style, brand, subtext, aspect, maxTex],
  );
  const material = useTextureMaterial(texture, SIGN_EMISSIVE[style], {
    roughness: style === "painted" ? 0.9 : 0.5,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  const height = width / aspect;
  const lit = style === "neon" || style === "backlit";
  const showGlow = glow && lit && tier !== "low";
  const glowColorHex = style === "neon" ? glowColor(brand) : mixHex(brand.primary, glowColor(brand), 0.5);
  // The flicker mutates opacity, so neon signs on the high tier get their own glow material.
  const flicker = showGlow && style === "neon" && tier === "high";
  const glowMat = useMemo(() => {
    if (!showGlow) return null;
    const shared = glowMaterial(glowColorHex, style === "neon" ? 0.5 : 0.28);
    return flicker ? shared.clone() : shared;
  }, [showGlow, flicker, style, glowColorHex]);
  useEffect(() => {
    if (!flicker || !glowMat) return;
    return () => glowMat.dispose();
  }, [flicker, glowMat]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {backing && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, 0, -0.05]} scale={[width + 0.12, height + 0.12, 0.08]} />}
      {glowMat && <mesh geometry={GEO.plane} material={glowMat} position={[0, 0, -0.08]} scale={[width * 1.35, height * 3.2, 1]} />}
      <mesh geometry={GEO.plane} material={material} />
      {style === "neon" && tier === "high" && <NeonFlicker sign={material} glow={glowMat} seed={hashString(text)} />}
    </group>
  );
}

/** A poster/screen plane (billboards, venue screens). */
export function PosterPlane({ title, subtitle, eyebrow, footer, brand, position, width, height, emissive = 0.9 }: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  footer?: string;
  brand: BrandPalette;
  position: [number, number, number];
  width: number;
  height: number;
  emissive?: number;
}) {
  const maxTex = useMaxTextureSize();
  const texture = useMemo(
    () => makePosterTexture({ title, subtitle, eyebrow, footer, brand, width: 1024, height: Math.round((1024 * height) / width), maxTextureSize: maxTex }),
    [title, subtitle, eyebrow, footer, brand, width, height, maxTex],
  );
  const material = useTextureMaterial(texture, emissive, { roughness: 0.4 });
  return <mesh geometry={GEO.plane} material={material} position={position} scale={[width, height, 1]} />;
}

export interface ImageBannerProps {
  /** Image URL (hero image); the poster below is drawn until it loads or when it fails. */
  url?: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  footer?: string;
  brand: BrandPalette;
  position: [number, number, number];
  rotationY?: number;
  width: number;
  height: number;
  emissive?: number;
  /** Frame colour (default dark metal); `null` for a bare print. */
  frameColor?: string | null;
  /** Caption strip under the image carrying the title (so a photo still names the event). */
  caption?: boolean;
}

/** A lit banner or screen showing real imagery with a branded poster fallback. */
export function ImageBanner({ url, title, subtitle, eyebrow, footer, brand, position, rotationY = 0, width, height, emissive = 0.75, frameColor, caption = false }: ImageBannerProps) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(
    () => makePosterTexture({ title, subtitle, eyebrow, footer, brand, width: 1024, height: Math.round((1024 * height) / width), maxTextureSize: maxTex }),
    [title, subtitle, eyebrow, footer, brand, width, height, maxTex],
  );
  const image = useImageTexture(url, fallback);
  const isPhoto = image !== fallback;
  const material = useTextureMaterial(image, emissive, { roughness: 0.45 });
  const captionTex = useMemo(
    () => makeLabelTexture(title, { bg: brand.primary, fg: inkOn(brand.primary, brand), subtext: footer ?? subtitle, accent: brand.accent, width: 1024, height: 192, radius: 0, maxTextureSize: maxTex }),
    [title, footer, subtitle, brand, maxTex],
  );
  const captionMat = useTextureMaterial(captionTex, 0.6, { roughness: 0.6 });
  const capH = caption ? height * 0.2 : 0;
  const frameMat = frameColor === null ? null : tinted(frameColor ?? "#23252b", { roughness: 0.5, metalness: 0.5 });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {frameMat && <mesh geometry={GEO.box} material={frameMat} position={[0, -capH / 2, -0.05]} scale={[width + 0.16, height + capH + 0.16, 0.08]} />}
      <mesh geometry={GEO.plane} material={material} scale={[width, height, 1]} />
      {caption && isPhoto && <mesh geometry={GEO.plane} material={captionMat} position={[0, -height / 2 - capH / 2, 0]} scale={[width, capH, 1]} />}
      {caption && !isPhoto && <mesh geometry={GEO.plane} material={tinted(brand.primary, { roughness: 0.7 })} position={[0, -height / 2 - capH / 2, 0]} scale={[width, capH, 1]} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Open sign
// ---------------------------------------------------------------------------

/** The small window sign: "OPEN" glowing in the brand colour, or a quiet "Opens 11:30 AM". */
export function OpenSign({ merchant, position, rotationY = 0, width = 0.62 }: { merchant: Merchant; position: [number, number, number]; rotationY?: number; width?: number }) {
  const maxTex = useMaxTextureSize();
  const tier = useQualityTier();
  // Re-evaluated whenever the index is rebuilt (phase ticker) and on mount; hours change slowly.
  const builtAt = useCityStore((s) => s.index?.builtAt ?? 0);
  const status = useMemo(() => openStatus(merchant.openingHours, Math.max(now(), builtAt)), [merchant.openingHours, builtAt]);
  const texture = useMemo(
    () => makeOpenSignTexture({ label: status?.label ?? "Open", open: status?.open ?? true, brand: merchant.brand, maxTextureSize: maxTex }),
    [status, merchant.brand, maxTex],
  );
  const material = useTextureMaterial(texture, status?.open === false ? 0.3 : 1.1, { roughness: 0.5 });
  const height = width * 0.375;
  const lit = status?.open !== false;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box} material={MAT.frame} position={[0, 0, -0.02]} scale={[width + 0.04, height + 0.04, 0.03]} />
      {lit && tier !== "low" && <mesh geometry={GEO.plane} material={glowMaterial(glowColor(merchant.brand), 0.4)} position={[0, 0, -0.04]} scale={[width * 1.8, height * 3, 1]} />}
      <mesh geometry={GEO.plane} material={material} />
      {/* Hanging chain. */}
      <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[0, height / 2 + 0.12, 0]} scale={[0.008, 0.24, 0.008]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Awnings and canopies
// ---------------------------------------------------------------------------

export interface AwningProps {
  frame: Frame;
  x: number;
  width: number;
  /** Height of the wall edge. */
  y: number;
  brand: BrandPalette;
  lod: Lod;
  depth?: number;
  kind?: "scalloped" | "flat";
}

export function Awning({ frame, x, width, y, brand, lod, depth = 1.5, kind = "scalloped" }: AwningProps) {
  const fabric = tinted(brand.secondary, { roughness: 0.92, side: THREE.DoubleSide });
  const tilt = kind === "scalloped" ? 0.32 : 0;
  const outerY = y - Math.sin(tilt) * depth;
  const outerZ = frame.faceZ + Math.cos(tilt) * depth;
  const scallops = useMemo<InstanceTransform[]>(() => {
    if (kind !== "scalloped") return [];
    const n = Math.max(2, Math.floor(width / 0.42));
    const step = width / n;
    const out: InstanceTransform[] = [];
    for (let i = 0; i < n; i++) out.push({ x: x - width / 2 + step / 2 + i * step, y: outerY - 0.01, z: outerZ + 0.01, sx: step, sy: 0.42, sz: 1 });
    return out;
  }, [kind, width, x, outerY, outerZ]);
  const arms = useMemo<InstanceTransform[]>(() => {
    if (kind !== "scalloped") return [];
    const n = Math.max(2, Math.round(width / 2.2) + 1);
    return evenlySpaced(x - width / 2 + 0.1, x + width / 2 - 0.1, n).map((ax) => ({
      x: ax,
      y: (y + outerY) / 2 - 0.08,
      z: (frame.faceZ + outerZ) / 2 - 0.05,
      tiltX: tilt,
      sx: 0.03,
      sy: 0.03,
      sz: depth * 0.96,
    }));
  }, [kind, width, x, y, outerY, outerZ, frame.faceZ, tilt, depth]);
  const stripe = mixHex(brand.secondary, brand.accent, 0.5);
  return (
    <group>
      <mesh
        geometry={GEO.box}
        material={fabric}
        position={[x, (y + outerY) / 2, (frame.faceZ + outerZ) / 2]}
        rotation={[tilt, 0, 0]}
        scale={[width, 0.05, depth]}
        castShadow
      />
      {kind === "flat" && (
        <mesh geometry={GEO.box} material={tinted(stripe, { roughness: 0.8 })} position={[x, outerY - 0.16, outerZ]} scale={[width, 0.3, 0.05]} />
      )}
      {lod === 0 && scallops.length > 0 && <StaticInstances geometry={GEO.scallop} material={fabric} items={scallops} />}
      {lod === 0 && arms.length > 0 && <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={arms} />}
      {lod === 0 && kind === "scalloped" && (
        <mesh geometry={GEO.box} material={tinted(stripe, { roughness: 0.8 })} position={[x, outerY - 0.02, outerZ]} scale={[width, 0.04, 0.05]} />
      )}
    </group>
  );
}

/** Flat slab canopy on posts (kiosks, venue entrances). */
export function Canopy({ position, width, depth, color, lod, posts, thickness = 0.16, underside }: {
  position: [number, number, number];
  width: number;
  depth: number;
  color: string;
  lod: Lod;
  /** Post foot positions in local space (x, z); posts run from the ground to the canopy. */
  posts?: Array<{ x: number; z: number }>;
  thickness?: number;
  /** Emissive colour for a lit underside band. */
  underside?: string;
}) {
  const [x, y, z] = position;
  const postItems = useMemo<InstanceTransform[]>(
    () => (posts ?? []).map((p) => ({ x: p.x, y: y / 2, z: p.z, sx: 0.07, sy: y, sz: 0.07 })),
    [posts, y],
  );
  return (
    <group>
      <mesh geometry={GEO.box} material={tinted(color, { roughness: 0.85 })} position={[x, y, z]} scale={[width, thickness, depth]} castShadow />
      {underside && lod <= 1 && (
        <mesh geometry={GEO.plane} material={tinted(underside, { emissive: underside, emissiveIntensity: 1.1, roughness: 0.6 })} position={[x, y - thickness / 2 - 0.01, z]} rotation={[Math.PI / 2, 0, 0]} scale={[width * 0.92, depth * 0.85, 1]} />
      )}
      {postItems.length > 0 && <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={postItems} castShadow />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Lighting accents
// ---------------------------------------------------------------------------

export interface AccentStripProps {
  brand: BrandPalette;
  position: [number, number, number];
  width: number;
  height?: number;
  depth?: number;
  quality: QualityTier;
  lod: Lod;
  /** Add a real point light (high tier, lod 0 only). */
  light?: boolean;
  intensity?: number;
  /** Vertical strip (LED edge on a container corner). */
  vertical?: boolean;
}

/** Emissive band in the brand accent; a real light only where the budget allows. */
export function AccentStrip({ brand, position, width, height = 0.14, depth = 0.1, quality, lod, light = false, intensity = 1.6, vertical = false }: AccentStripProps) {
  const color = glowColor(brand);
  const material = tinted(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const [x, y, z] = position;
  return (
    <group>
      <mesh geometry={GEO.box} material={material} position={position} scale={vertical ? [height, width, depth] : [width, height, depth]} />
      {quality !== "low" && lod === 0 && (
        <mesh geometry={GEO.plane} material={glowMaterial(color, 0.3)} position={[x, y, z + 0.02]} scale={vertical ? [height * 10, width * 1.1, 1] : [width * 1.1, height * 10, 1]} />
      )}
      {light && quality === "high" && lod === 0 && (
        <pointLight position={[x, y - 0.6, z + 1.4]} color={color} intensity={7} distance={10} decay={2} />
      )}
    </group>
  );
}

/** A row of warm bulbs (string lights) between two local points at a height. */
export function StringLights({ from, to, y, z, count, sag = 0.12 }: { from: number; to: number; y: number; z: number; count: number; sag?: number }) {
  const items = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = from + (to - from) * t;
      const dip = Math.sin(t * Math.PI) * sag;
      out.push({ x, y: y - dip, z, sx: 0.07, sy: 0.09, sz: 0.07 });
    }
    return out;
  }, [from, to, y, z, count, sag]);
  const wire = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    const segs = Math.max(2, count - 1);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const x0 = from + (to - from) * t0;
      const x1 = from + (to - from) * t1;
      const y0 = y - Math.sin(t0 * Math.PI) * sag;
      const y1 = y - Math.sin(t1 * Math.PI) * sag;
      out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 0.04, z, tiltZ: Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, sx: 0.012, sy: Math.hypot(x1 - x0, y1 - y0), sz: 0.012 });
    }
    return out;
  }, [from, to, y, z, count, sag]);
  return (
    <group>
      <StaticInstances geometry={GEO.cylinder} material={MAT.frame} items={wire} />
      <StaticInstances geometry={GEO.sphere} material={MAT.bulb} items={items} />
    </group>
  );
}

/** Wall sconces: a small warm globe on a dark bracket, with a soft wash on medium/high. */
export function Sconces({ positions, z, quality = "medium" }: { positions: Array<[number, number]>; z: number; quality?: QualityTier }) {
  const globes = useMemo<InstanceTransform[]>(() => positions.map(([x, y]) => ({ x, y, z: z + 0.22, sx: 0.13, sy: 0.16, sz: 0.13 })), [positions, z]);
  const brackets = useMemo<InstanceTransform[]>(() => positions.map(([x, y]) => ({ x, y: y + 0.1, z: z + 0.1, sx: 0.06, sy: 0.3, sz: 0.24 })), [positions, z]);
  const washes = useMemo<InstanceTransform[]>(() => positions.map(([x, y]) => ({ x, y: y - 0.1, z: z + 0.03, sx: 1.6, sy: 2.2, sz: 1 })), [positions, z]);
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={brackets} />
      <StaticInstances geometry={GEO.sphere} material={MAT.sconce} items={globes} />
      {quality !== "low" && <StaticInstances geometry={GEO.plane} material={glowMaterial("#ffc27a", 0.22)} items={washes} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Vitrine (protruding shadow-box display) and its contents
// ---------------------------------------------------------------------------

export interface VitrineProps {
  frame: Frame;
  x: number;
  y: number;
  width: number;
  height: number;
  depth?: number;
  brand: BrandPalette;
  lod: Lod;
  /** What stands inside; derived from the merchant category by `displayKind`. */
  contents: "mannequins" | "bouquets" | "boxes" | "none";
  frameColor?: string;
  /** Products to show as framed cards on plinths (featured first); up to three fit. */
  products?: Product[];
  quality?: QualityTier;
}

export type DisplayKind = VitrineProps["contents"];

export function displayKind(merchant: Merchant): DisplayKind {
  if (merchant.storefrontConfig.windowDisplay !== "products") return "none";
  const c = merchant.category;
  if (c.startsWith("fashion")) return "mannequins";
  if (c.includes("flower") || c.includes("plant") || c.includes("garden")) return "bouquets";
  return "boxes";
}

/** How many product cards a window shows per tier (each is one image texture). */
export function cardsPerWindow(quality: QualityTier | undefined, width: number): number {
  const fit = Math.max(1, Math.min(3, Math.floor(width / 0.95)));
  if (quality === "low") return Math.min(1, fit);
  if (quality === "medium") return Math.min(2, fit);
  return fit;
}

/**
 * The building shell is a solid box, so display windows are built as shallow lit bays that
 * protrude from the façade: a lit back panel, thin sides, a clear glass front and the contents.
 */
export function Vitrine({ frame, x, y, width, height, depth = 0.8, brand, lod, contents, frameColor, products, quality }: VitrineProps) {
  const z0 = frame.faceZ;
  const sideMat = frameColor ? tinted(frameColor, { roughness: 0.6, metalness: 0.3 }) : MAT.darkMetal;
  const sides = useMemo<InstanceTransform[]>(
    () => [
      { x: x - width / 2 - 0.03, y, z: z0 + depth / 2, sx: 0.06, sy: height + 0.12, sz: depth },
      { x: x + width / 2 + 0.03, y, z: z0 + depth / 2, sx: 0.06, sy: height + 0.12, sz: depth },
      { x, y: y + height / 2 + 0.03, z: z0 + depth / 2, sx: width + 0.12, sy: 0.06, sz: depth },
      { x, y: y - height / 2 - 0.03, z: z0 + depth / 2, sx: width + 0.12, sy: 0.06, sz: depth },
    ],
    [x, y, width, height, depth, z0],
  );
  const backlight = mixHex(brand.primary, "#ffffff", 0.1);
  const back = tinted(backlight, { emissive: mixHex(brand.accent, "#ffffff", 0.3), emissiveIntensity: 0.3, roughness: 0.9 });
  const floorY = y - height / 2;
  const cz = z0 + depth / 2;
  const shown = useMemo(() => {
    if (!products || contents === "none") return [];
    const list = [...products].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
    return list.slice(0, cardsPerWindow(quality, width));
  }, [products, contents, quality, width]);
  const items = useMemo(() => vitrineContents(contents, x, floorY, cz, width, depth, brand, shown.length), [contents, x, floorY, cz, width, depth, brand, shown.length]);
  // Downlights along the top of the bay.
  const spots = useMemo<InstanceTransform[]>(() => {
    const n = Math.max(1, Math.round(width / 0.9));
    return evenlySpaced(x - width / 2 + 0.4, x + width / 2 - 0.4, n).map((sx) => ({ x: sx, y: y + height / 2 - 0.05, z: cz, sx: 0.08, sy: 0.03, sz: 0.08 }));
  }, [x, y, width, height, cz]);
  const cardStep = width / (shown.length + 1);
  return (
    <group>
      <mesh geometry={GEO.plane} material={back} position={[x, y, z0 + 0.01]} scale={[width, height, 1]} />
      <StaticInstances geometry={GEO.box} material={sideMat} items={sides} castShadow />
      <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#ffffff", 0.15), { roughness: 0.7 })} position={[x, floorY + 0.015, cz]} scale={[width, 0.03, depth]} />
      {lod === 0 && items.plinths.length > 0 && <StaticInstances geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.7 })} items={items.plinths} />}
      {lod <= 1 && items.bodies.length > 0 && <StaticInstances geometry={items.bodyGeometry} material={items.bodyMaterial} items={items.bodies} />}
      {lod === 0 && items.heads.length > 0 && <StaticInstances geometry={GEO.sphere} material={items.headMaterial} items={items.heads} />}
      {lod === 0 && <StaticInstances geometry={GEO.cylinder} material={MAT.transom} items={spots} />}
      {lod <= 1 &&
        shown.map((product, i) => (
          <WindowCard
            key={product.id}
            product={product}
            brand={brand}
            position={[x - width / 2 + cardStep * (i + 1), floorY + 0.12, cz + depth * 0.12]}
            size={Math.min(0.74, Math.max(0.5, cardStep * 0.78))}
            plinth
          />
        ))}
      <mesh geometry={GEO.plane} material={MAT.glassClear} position={[x, y, z0 + depth + 0.01]} scale={[width, height, 1]} />
    </group>
  );
}

function vitrineContents(kind: DisplayKind, x: number, floorY: number, cz: number, width: number, depth: number, brand: BrandPalette, cards: number) {
  const plinths: InstanceTransform[] = [];
  const bodies: InstanceTransform[] = [];
  const heads: InstanceTransform[] = [];
  let bodyGeometry: THREE.BufferGeometry = GEO.box;
  let bodyMaterial: THREE.Material = MAT.mannequin;
  let headMaterial: THREE.Material = MAT.mannequin;
  // With product cards in front, the props stand behind them against the back panel.
  const count = Math.max(1, Math.min(3, Math.floor(width / 1.1)));
  const step = width / (count + 1);
  const z = cards > 0 ? cz - depth * 0.25 : cz;
  const bodyDepth = Math.min(0.3, depth * 0.4);
  for (let i = 0; i < count; i++) {
    const px = x - width / 2 + step * (i + 1) + (cards > 0 ? (i % 2 === 0 ? -0.12 : 0.12) : 0);
    switch (kind) {
      case "mannequins":
        bodyGeometry = GEO.box;
        bodyMaterial = tinted(mixHex(brand.primary, "#2c2c31", 0.5), { roughness: 0.55, metalness: 0.15 });
        plinths.push({ x: px, y: floorY + 0.06, z, sx: 0.6, sy: 0.12, sz: Math.min(0.6, depth * 0.8) });
        bodies.push({ x: px, y: floorY + 0.12 + 0.75, z, sx: 0.42, sy: 1.5, sz: bodyDepth });
        heads.push({ x: px, y: floorY + 0.12 + 1.5 + 0.17, z, sx: 0.13, sy: 0.16, sz: 0.13 });
        break;
      case "bouquets":
        bodyGeometry = GEO.cylinder;
        bodyMaterial = tinted(brand.secondary, { roughness: 0.6 });
        headMaterial = tinted(mixHex(brand.secondary, brand.accent, 0.5), { roughness: 0.9 });
        plinths.push({ x: px, y: floorY + 0.35, z, sx: 0.5, sy: 0.7, sz: Math.min(0.5, depth * 0.7) });
        bodies.push({ x: px, y: floorY + 0.7 + 0.22, z, sx: 0.14, sy: 0.44, sz: 0.14 });
        heads.push({ x: px, y: floorY + 0.7 + 0.44 + 0.22, z, sx: 0.32, sy: 0.28, sz: Math.min(0.32, depth * 0.45) });
        break;
      case "boxes":
        if (cards > 0) break; // the cards are the goods
        bodyGeometry = GEO.box;
        bodyMaterial = tinted(brand.accent, { roughness: 0.5 });
        plinths.push({ x: px, y: floorY + 0.3, z, sx: 0.55, sy: 0.6, sz: Math.min(0.55, depth * 0.7) });
        bodies.push({ x: px, y: floorY + 0.6 + 0.2 + (i % 2) * 0.08, z, sx: 0.36 + (i % 2) * 0.1, sy: 0.4 + (i % 2) * 0.16, sz: bodyDepth });
        break;
      case "none":
        break;
    }
  }
  return { plinths, bodies, heads, bodyGeometry, bodyMaterial, headMaterial };
}

/**
 * A product as a framed photo card on a small plinth, with a price tag. The image is the
 * product's own (`useImageTexture`); a branded monogram card stands in while it loads or fails.
 */
export function WindowCard({ product, brand, position, size = 0.7, plinth = false, rotationY = 0, lean = -0.12 }: {
  product: Product;
  brand: BrandPalette;
  position: [number, number, number];
  size?: number;
  plinth?: boolean;
  rotationY?: number;
  lean?: number;
}) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(() => makeInitialTexture({ label: product.title, brand, size: 256, caption: product.title, maxTextureSize: maxTex }), [product.title, brand, maxTex]);
  const image = useImageTexture(product.imageUrl, fallback);
  const cardMat = useTextureMaterial(image, 0.4, { roughness: 0.55 });
  const tagTex = useMemo(
    () => makeLabelTexture(formatCents(product.priceCents, product.currency), { bg: "#f4f1ea", fg: "#1a1d24", accent: brand.accent, width: 256, height: 96, radius: 0.15, weight: 800, maxTextureSize: maxTex }),
    [product.priceCents, product.currency, brand.accent, maxTex],
  );
  const tagMat = useTextureMaterial(tagTex, 0.25, { roughness: 0.8 });
  const w = size;
  const h = size * 0.75;
  const plinthH = plinth ? 0.22 : 0;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {plinth && <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#ffffff", 0.1), { roughness: 0.6 })} position={[0, plinthH / 2, 0]} scale={[w * 0.9, plinthH, 0.3]} castShadow />}
      <group position={[0, plinthH + h / 2 + 0.03, 0]} rotation={[lean, 0, 0]}>
        <mesh geometry={GEO.box} material={MAT.cardFrame} position={[0, 0, -0.02]} scale={[w + 0.06, h + 0.06, 0.025]} />
        <mesh geometry={GEO.plane} material={cardMat} scale={[w, h, 1]} />
      </group>
      <mesh geometry={GEO.plane} material={tagMat} position={[w * 0.28, plinthH + 0.07, 0.17]} rotation={[-0.35, 0, 0]} scale={[0.26, 0.1, 1]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Menu board, logo, planters
// ---------------------------------------------------------------------------

export interface MenuBoardProps {
  merchant: Merchant;
  position: [number, number, number];
  width?: number;
  lod: Lod;
  /** Include prices (default true: a menu without prices is a poster). */
  prices?: boolean;
  lines?: number;
  rotationY?: number;
  /** Products to list; defaults to the merchant's catalog from the index. */
  products?: Product[];
}

/** Lit menu board listing featured products with prices and tonight's opening note. */
export function MenuBoard({ merchant, position, width = 0.85, lod, prices = true, lines = 4, rotationY = 0, products }: MenuBoardProps) {
  const maxTex = useMaxTextureSize();
  const indexed = useCityStore((s) => s.index?.productsByMerchant[merchant.id]);
  const builtAt = useCityStore((s) => s.index?.builtAt ?? 0);
  const source = products ?? indexed;
  const picked = useMemo(() => {
    const list = source ? [...source] : [];
    list.sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
    return list.slice(0, lines).map((p) => (prices ? ([p.title, formatCents(p.priceCents, p.currency)] as [string, string]) : p.title));
  }, [source, lines, prices]);
  const status = useMemo(() => openStatus(merchant.openingHours, Math.max(now(), builtAt)), [merchant.openingHours, builtAt]);
  const texture = useMemo(
    () =>
      makeMenuTexture({
        title: merchant.merchantType === "restaurant" ? "Tonight" : "Now in",
        note: status?.open ? status.detail : status?.label,
        lines: picked.length ? picked : [merchant.tagline ?? merchant.name],
        brand: merchant.brand,
        width: 512,
        height: 640,
        maxTextureSize: maxTex,
      }),
    [merchant, picked, status, maxTex],
  );
  const material = useTextureMaterial(texture, 0.6, { roughness: 0.75 });
  const height = width * 1.25;
  const [x, y, z] = position;
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, 0, -0.04]} scale={[width + 0.1, height + 0.1, 0.06]} />
      <mesh geometry={GEO.plane} material={material} scale={[width, height, 1]} />
      {lod === 0 && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, height / 2 + 0.14, 0.1]} scale={[width * 0.7, 0.04, 0.22]} />}
      {lod === 0 && <mesh geometry={GEO.box} material={MAT.transom} position={[0, height / 2 + 0.11, 0.12]} scale={[width * 0.6, 0.03, 0.14]} />}
    </group>
  );
}

/** Merchant logo plane with a branded monogram fallback. */
export function Logo({ merchant, position, size = 1.1, rotationY = 0, lit = true }: { merchant: Merchant; position: [number, number, number]; size?: number; rotationY?: number; lit?: boolean }) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(() => makeInitialTexture({ label: merchant.name, brand: merchant.brand, size: 256, maxTextureSize: maxTex }), [merchant.name, merchant.brand, maxTex]);
  const texture = useImageTexture(merchant.logoUrl, fallback);
  const material = useTextureMaterial(texture, lit ? 0.6 : 0.2, { roughness: 0.7 });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box} material={tinted(merchant.brand.primary, { roughness: 0.7 })} position={[0, 0, -0.05]} scale={[size + 0.12, size + 0.12, 0.08]} />
      <mesh geometry={GEO.plane} material={material} scale={[size, size, 1]} />
    </group>
  );
}

/** Planter boxes with layered foliage at local positions; colliders come from `planterColliders`. */
export function Planters({ positions, alt = false, trimColor }: { positions: Array<{ x: number; z: number }>; alt?: boolean; trimColor?: string }) {
  const boxes = useMemo<InstanceTransform[]>(() => positions.map((p) => ({ x: p.x, y: 0.28, z: p.z, sx: 0.9, sy: 0.56, sz: 0.9 })), [positions]);
  const trims = useMemo<InstanceTransform[]>(() => positions.map((p) => ({ x: p.x, y: 0.55, z: p.z, sx: 0.96, sy: 0.05, sz: 0.96 })), [positions]);
  const soil = useMemo<InstanceTransform[]>(() => positions.map((p) => ({ x: p.x, y: 0.57, z: p.z, sx: 0.8, sy: 0.04, sz: 0.8 })), [positions]);
  const bushes = useMemo<InstanceTransform[]>(
    () =>
      positions.flatMap((p, i) => [
        { x: p.x, y: 0.95, z: p.z, sx: 0.46, sy: 0.4 + (i % 2) * 0.08, sz: 0.46 },
        { x: p.x + 0.22, y: 0.82, z: p.z - 0.16, sx: 0.3, sy: 0.26, sz: 0.3 },
        { x: p.x - 0.2, y: 0.84, z: p.z + 0.14, sx: 0.28, sy: 0.24, sz: 0.28 },
      ]),
    [positions],
  );
  const tall = useMemo<InstanceTransform[]>(() => positions.filter((_, i) => i % 2 === 0).map((p) => ({ x: p.x - 0.05, y: 1.25, z: p.z - 0.05, sx: 0.2, sy: 0.5, sz: 0.2 })), [positions]);
  if (positions.length === 0) return null;
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={MAT.planter} items={boxes} castShadow receiveShadow />
      <StaticInstances geometry={GEO.box} material={trimColor ? tinted(trimColor, { roughness: 0.6, metalness: 0.2 }) : MAT.darkMetal} items={trims} />
      <StaticInstances geometry={GEO.box} material={MAT.soil} items={soil} />
      <StaticInstances geometry={GEO.sphere} material={alt ? MAT.foliageAlt : MAT.foliage} items={bushes} castShadow />
      {tall.length > 0 && <StaticInstances geometry={GEO.sphere} material={MAT.foliageDeep} items={tall} />}
    </group>
  );
}

export function planterColliders(parcel: Parcel, positions: Array<{ x: number; z: number }>): AABB[] {
  return positions.map((p, i) => localCollider(parcel, `planter${i}`, p, 0.95, 0.95));
}

/** Sign text: the configured override or the merchant name. */
export function signText(merchant: Merchant): string {
  return merchant.storefrontConfig.signText?.trim() || merchant.name;
}

/**
 * LED strip: a thin emissive bar plus a run of bright diodes, in the brand's glow colour.
 * `from`/`to` are local x values at height `y`; set `vertical` to run it up a corner instead.
 */
export function LedStrip({ from, to, y, z, color, count, vertical = false, x = 0, intensity = 2.2 }: { from: number; to: number; y: number; z: number; color: string; count: number; vertical?: boolean; x?: number; intensity?: number }) {
  const diodes = useMemo<InstanceTransform[]>(
    () => evenlySpaced(from, to, count).map((v) => (vertical ? { x, y: v, z, sx: 0.05, sy: 0.05, sz: 0.05 } : { x: v, y, z, sx: 0.05, sy: 0.05, sz: 0.05 })),
    [from, to, count, vertical, x, y, z],
  );
  const len = Math.abs(to - from);
  const mid = (from + to) / 2;
  const bar = tinted(color, { emissive: color, emissiveIntensity: intensity * 0.5, roughness: 0.4 });
  const diode = tinted(mixHex(color, "#ffffff", 0.4), { emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
  return (
    <group>
      <mesh geometry={GEO.box} material={bar} position={vertical ? [x, mid, z] : [mid, y, z]} scale={vertical ? [0.03, len, 0.03] : [len, 0.03, 0.03]} />
      <StaticInstances geometry={GEO.box} material={diode} items={diodes} />
    </group>
  );
}
