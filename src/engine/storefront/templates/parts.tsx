"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BrandPalette, Merchant, Parcel } from "@/types/domain";
import type { QualityTier } from "@/engine/canvas/quality";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { aabbFromCenter, type AABB } from "@/engine/physics/types";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useImageTexture } from "@/engine/interior/useImageTexture";
import { useCityStore } from "@/city/cityStore";
import { FACADE_SETBACK } from "@/city/layout";
import { formatCents } from "@/lib/utils/money";
import { localToWorld } from "../types";
import { getFacadeMaterial } from "../facade";
import { glowColor, makeInitialTexture, makeMenuTexture, makePosterTexture, makeSignTexture, mixHex, type SignStyle } from "../signage";

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

export const MAT = {
  windowGlow: tinted("#1b1409", { emissive: "#ffb86b", emissiveIntensity: 1.15, roughness: 0.25, metalness: 0.3 }),
  windowCool: tinted("#0f1620", { emissive: "#9fc4ff", emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.4 }),
  frame: tinted("#14151a", { roughness: 0.6, metalness: 0.4 }),
  darkMetal: tinted("#23252b", { roughness: 0.45, metalness: 0.7 }),
  roof: tinted("#2a2b31", { roughness: 0.95 }),
  slate: tinted("#25262c", { roughness: 0.9 }),
  glassDark: tinted("#0c1622", { roughness: 0.16, metalness: 0.75, emissive: "#2c1f12", emissiveIntensity: 0.45 }),
  glassClear: tinted("#9fb7c9", { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.22, emissive: "#101820", emissiveIntensity: 0.3 }),
  doorGlass: tinted("#0d1218", { roughness: 0.2, metalness: 0.6, emissive: "#ffb570", emissiveIntensity: 0.7 }),
  transom: tinted("#fff1d6", { emissive: "#ffd9a0", emissiveIntensity: 1.6, roughness: 0.4 }),
  bulb: tinted("#fff3d8", { emissive: "#ffcf8a", emissiveIntensity: 2.4, roughness: 0.3 }),
  sconce: tinted("#ffe9c4", { emissive: "#ffc27a", emissiveIntensity: 2.0, roughness: 0.4 }),
  mannequin: tinted("#2c2c31", { roughness: 0.55, metalness: 0.15 }),
  foliage: tinted("#2f5d3a", { roughness: 0.95 }),
  foliageAlt: tinted("#3f6b3c", { roughness: 0.95 }),
  planter: tinted("#3a3b40", { roughness: 0.9 }),
  soil: tinted("#2b241f", { roughness: 1 }),
  step: tinted("#4a4b50", { roughness: 0.9 }),
  ledOff: tinted("#1a1b20", { roughness: 0.5, metalness: 0.3 }),
};

export function useMaxTextureSize(): number {
  return useQualityStore((s) => s.settings.maxTextureSize);
}

/** A per-instance material for a texture (map + emissive map). Disposed on unmount. */
export function useTextureMaterial(texture: THREE.Texture, emissiveIntensity: number, opts: { roughness?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: new THREE.Color("#ffffff"),
        emissiveIntensity,
        roughness: opts.roughness ?? 0.6,
        metalness: 0,
        side: opts.side ?? THREE.FrontSide,
      }),
    [texture, emissiveIntensity, opts.roughness, opts.side],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

// ---------------------------------------------------------------------------
// Shell: the building volume and its roof cap
// ---------------------------------------------------------------------------

export interface ShellProps {
  frame: Frame;
  merchant: Merchant;
  lod: Lod;
  /** Override the cap material (e.g. brand.secondary cornice). */
  capColor?: string;
}

export function Shell({ frame, merchant, lod, capColor }: ShellProps) {
  const maxTex = useMaxTextureSize();
  const facade = getFacadeMaterial(merchant.storefrontConfig.facade, merchant.brand, maxTex);
  const bodyH = frame.h - frame.parapet;
  const cap = capColor ? tinted(capColor, { roughness: 0.85 }) : MAT.roof;
  return (
    <group>
      <mesh geometry={GEO.box} material={facade} position={[0, bodyH / 2, frame.cz]} scale={[frame.w, bodyH, frame.d]} castShadow receiveShadow />
      {lod <= 2 && (
        <mesh
          geometry={GEO.box}
          material={cap}
          position={[0, bodyH + frame.parapet / 2, frame.cz]}
          scale={[frame.w + 0.24, frame.parapet, frame.d + 0.24]}
          castShadow
        />
      )}
    </group>
  );
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
}

/** Instanced glowing panes with dark frames: two draw calls per building regardless of count. */
export function Windows({ panes, cool = false, border = 0.14 }: WindowsProps) {
  const frames = useMemo(
    () => panes.map((p) => ({ ...p, z: p.z - 0.015, sx: (p.sx ?? 1) + border, sy: (p.sy ?? 1) + border })),
    [panes, border],
  );
  if (panes.length === 0) return null;
  return (
    <group>
      <StaticInstances geometry={GEO.plane} material={MAT.frame} items={frames} />
      <StaticInstances geometry={GEO.plane} material={cool ? MAT.windowCool : MAT.windowGlow} items={panes} />
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
}

/** Portal (jambs + lintel), glazed door panel with warm interior glow, transom light and a step. */
export function Door({ frame, x, width = 1.6, height = 2.6, brand, lod, frameColor, double = false }: DoorProps) {
  const depth = 0.28;
  const jamb = 0.16;
  const z = frame.faceZ + depth / 2;
  const portal = useMemo<InstanceTransform[]>(
    () => [
      { x: x - width / 2 - jamb / 2, y: height / 2 + 0.05, z, sx: jamb, sy: height + 0.1, sz: depth },
      { x: x + width / 2 + jamb / 2, y: height / 2 + 0.05, z, sx: jamb, sy: height + 0.1, sz: depth },
      { x, y: height + 0.1 + jamb / 2 + 0.3, z, sx: width + jamb * 2, sy: jamb, sz: depth },
      ...(double ? [{ x, y: height / 2, z: frame.faceZ + 0.05, sx: 0.06, sy: height, sz: 0.06 }] : []),
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
}

const SIGN_EMISSIVE: Record<SignStyle, number> = { neon: 1.0, backlit: 0.85, marquee: 0.8, painted: 0.35 };

export function SignPlane({ text, style, brand, position, width, aspect = 4, rotationY = 0, backing = true, doubleSided = false }: SignPlaneProps) {
  const maxTex = useMaxTextureSize();
  const texture = useMemo(
    () => makeSignTexture({ text, style, brand, width: 1024, height: Math.round(1024 / aspect), maxTextureSize: maxTex }),
    [text, style, brand, aspect, maxTex],
  );
  const material = useTextureMaterial(texture, SIGN_EMISSIVE[style], { roughness: style === "painted" ? 0.9 : 0.5, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const height = width / aspect;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {backing && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, 0, -0.05]} scale={[width + 0.12, height + 0.12, 0.08]} />}
      <mesh geometry={GEO.plane} material={material} />
    </group>
  );
}

/** A poster/screen plane (billboards, venue screens). */
export function PosterPlane({ title, subtitle, eyebrow, brand, position, width, height, emissive = 0.9 }: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  brand: BrandPalette;
  position: [number, number, number];
  width: number;
  height: number;
  emissive?: number;
}) {
  const maxTex = useMaxTextureSize();
  const texture = useMemo(
    () => makePosterTexture({ title, subtitle, eyebrow, brand, width: 1024, height: Math.round((1024 * height) / width), maxTextureSize: maxTex }),
    [title, subtitle, eyebrow, brand, width, height, maxTex],
  );
  const material = useTextureMaterial(texture, emissive, { roughness: 0.4 });
  return <mesh geometry={GEO.plane} material={material} position={position} scale={[width, height, 1]} />;
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
  const fabric = tinted(brand.secondary, { roughness: 0.9, side: THREE.DoubleSide });
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
}

/** Emissive band in the brand accent; a real light only where the budget allows. */
export function AccentStrip({ brand, position, width, height = 0.14, depth = 0.1, quality, lod, light = false, intensity = 1.6 }: AccentStripProps) {
  const color = glowColor(brand);
  const material = tinted(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const [x, y, z] = position;
  return (
    <group>
      <mesh geometry={GEO.box} material={material} position={position} scale={[width, height, depth]} />
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
  return <StaticInstances geometry={GEO.sphere} material={MAT.bulb} items={items} />;
}

/** Wall sconces: a small warm globe on a dark bracket. */
export function Sconces({ positions, z }: { positions: Array<[number, number]>; z: number }) {
  const globes = useMemo<InstanceTransform[]>(() => positions.map(([x, y]) => ({ x, y, z: z + 0.22, sx: 0.13, sy: 0.16, sz: 0.13 })), [positions, z]);
  const brackets = useMemo<InstanceTransform[]>(() => positions.map(([x, y]) => ({ x, y: y + 0.1, z: z + 0.1, sx: 0.06, sy: 0.3, sz: 0.24 })), [positions, z]);
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={brackets} />
      <StaticInstances geometry={GEO.sphere} material={MAT.sconce} items={globes} />
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
}

export type DisplayKind = VitrineProps["contents"];

export function displayKind(merchant: Merchant): DisplayKind {
  if (merchant.storefrontConfig.windowDisplay !== "products") return "none";
  const c = merchant.category;
  if (c.startsWith("fashion")) return "mannequins";
  if (c.includes("flower") || c.includes("plant") || c.includes("garden")) return "bouquets";
  return "boxes";
}

/**
 * The building shell is a solid box, so display windows are built as shallow lit bays that
 * protrude from the façade: a lit back panel, thin sides, a clear glass front and the contents.
 */
export function Vitrine({ frame, x, y, width, height, depth = 0.8, brand, lod, contents, frameColor }: VitrineProps) {
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
  const backlight = mixHex(brand.primary, "#ffffff", 0.12);
  const back = tinted(backlight, { emissive: mixHex(brand.accent, "#ffffff", 0.3), emissiveIntensity: 0.35, roughness: 0.9 });
  const floorY = y - height / 2;
  const cz = z0 + depth / 2;
  const items = useMemo(() => vitrineContents(contents, x, floorY, cz, width, depth, brand), [contents, x, floorY, cz, width, depth, brand]);
  return (
    <group>
      <mesh geometry={GEO.plane} material={back} position={[x, y, z0 + 0.01]} scale={[width, height, 1]} />
      <StaticInstances geometry={GEO.box} material={sideMat} items={sides} castShadow />
      {lod === 0 && items.plinths.length > 0 && <StaticInstances geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.7 })} items={items.plinths} />}
      {lod <= 1 && items.bodies.length > 0 && <StaticInstances geometry={items.bodyGeometry} material={items.bodyMaterial} items={items.bodies} />}
      {lod === 0 && items.heads.length > 0 && <StaticInstances geometry={GEO.sphere} material={items.headMaterial} items={items.heads} />}
      <mesh geometry={GEO.plane} material={MAT.glassClear} position={[x, y, z0 + depth + 0.01]} scale={[width, height, 1]} />
    </group>
  );
}

function vitrineContents(kind: DisplayKind, x: number, floorY: number, cz: number, width: number, depth: number, brand: BrandPalette) {
  const plinths: InstanceTransform[] = [];
  const bodies: InstanceTransform[] = [];
  const heads: InstanceTransform[] = [];
  let bodyGeometry: THREE.BufferGeometry = GEO.box;
  let bodyMaterial: THREE.Material = MAT.mannequin;
  let headMaterial: THREE.Material = MAT.mannequin;
  const count = Math.max(1, Math.min(3, Math.floor(width / 1.1)));
  const step = width / (count + 1);
  const z = cz;
  const bodyDepth = Math.min(0.32, depth * 0.45);
  for (let i = 0; i < count; i++) {
    const px = x - width / 2 + step * (i + 1);
    switch (kind) {
      case "mannequins":
        bodyGeometry = GEO.box;
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

// ---------------------------------------------------------------------------
// Menu board, logo, planters
// ---------------------------------------------------------------------------

export interface MenuBoardProps {
  merchant: Merchant;
  position: [number, number, number];
  width?: number;
  lod: Lod;
  /** Include prices (interiors); street boards show titles only by default. */
  prices?: boolean;
  lines?: number;
}

/** Menu board beside the door listing 2–3 product titles from the live index. */
export function MenuBoard({ merchant, position, width = 0.85, lod, prices = false, lines = 3 }: MenuBoardProps) {
  const maxTex = useMaxTextureSize();
  const products = useCityStore((s) => s.index?.productsByMerchant[merchant.id]);
  const picked = useMemo(() => {
    const list = products ? [...products] : [];
    list.sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
    return list.slice(0, lines).map((p) => (prices ? ([p.title, formatCents(p.priceCents, p.currency)] as [string, string]) : p.title));
  }, [products, lines, prices]);
  const texture = useMemo(
    () =>
      makeMenuTexture({
        title: merchant.merchantType === "restaurant" ? "Tonight" : "Now in",
        lines: picked.length ? picked : [merchant.tagline ?? merchant.name],
        brand: merchant.brand,
        width: 512,
        height: 640,
        maxTextureSize: maxTex,
      }),
    [merchant, picked, maxTex],
  );
  const material = useTextureMaterial(texture, 0.55, { roughness: 0.8 });
  const height = width * 1.25;
  const [x, y, z] = position;
  return (
    <group>
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[x, y, z - 0.04]} scale={[width + 0.1, height + 0.1, 0.06]} />
      <mesh geometry={GEO.plane} material={material} position={[x, y, z]} scale={[width, height, 1]} />
      {lod === 0 && <mesh geometry={GEO.box} material={MAT.transom} position={[x, y + height / 2 + 0.12, z + 0.08]} scale={[width * 0.6, 0.05, 0.18]} />}
    </group>
  );
}

/** Merchant logo plane with a branded-initial fallback. */
export function Logo({ merchant, position, size = 1.1, rotationY = 0 }: { merchant: Merchant; position: [number, number, number]; size?: number; rotationY?: number }) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(() => makeInitialTexture({ label: merchant.name, brand: merchant.brand, size: 256, maxTextureSize: maxTex }), [merchant, maxTex]);
  const texture = useImageTexture(merchant.logoUrl, fallback);
  const material = useTextureMaterial(texture, 0.6, { roughness: 0.7 });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={GEO.box} material={tinted(merchant.brand.primary, { roughness: 0.7 })} position={[0, 0, -0.05]} scale={[size + 0.12, size + 0.12, 0.08]} />
      <mesh geometry={GEO.plane} material={material} scale={[size, size, 1]} />
    </group>
  );
}

/** Planter boxes with foliage at local positions; colliders come from `planterColliders`. */
export function Planters({ positions, alt = false }: { positions: Array<{ x: number; z: number }>; alt?: boolean }) {
  const boxes = useMemo<InstanceTransform[]>(() => positions.map((p) => ({ x: p.x, y: 0.28, z: p.z, sx: 0.9, sy: 0.56, sz: 0.9 })), [positions]);
  const soil = useMemo<InstanceTransform[]>(() => positions.map((p) => ({ x: p.x, y: 0.57, z: p.z, sx: 0.8, sy: 0.04, sz: 0.8 })), [positions]);
  const bushes = useMemo<InstanceTransform[]>(() => positions.map((p, i) => ({ x: p.x, y: 0.95, z: p.z, sx: 0.5, sy: 0.42 + (i % 2) * 0.08, sz: 0.5 })), [positions]);
  if (positions.length === 0) return null;
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={MAT.planter} items={boxes} castShadow receiveShadow />
      <StaticInstances geometry={GEO.box} material={MAT.soil} items={soil} />
      <StaticInstances geometry={GEO.sphere} material={alt ? MAT.foliageAlt : MAT.foliage} items={bushes} castShadow />
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
