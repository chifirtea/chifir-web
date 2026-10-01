"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { AiEmployeePublic, BrandPalette, Merchant, Product } from "@/types/domain";
import type { QualityTier } from "@/engine/canvas/quality";
import { aabbFromCenter, type AABB } from "@/engine/physics/types";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { tiledPlane } from "@/engine/environment/geometry";
import { hashString, mulberry32 } from "@/engine/environment/prng";
import { NpcAvatar } from "@/engine/player/Avatar";
import { concreteTexture, floorTileTexture, plankTexture, plasterTexture, stoneTexture, terrazzoTexture } from "@/engine/storefront/facade";
import { inkOn, makeInitialTexture, makeLabelTexture, mixHex } from "@/engine/storefront/signage";
import { GEO, ImageBanner, MAT, SignPlane, glowMaterial, tinted, useMaxTextureSize, useTextureMaterial } from "@/engine/storefront/templates/parts";
import { formatCents } from "@/lib/utils/money";
import type { InteriorTemplateDef } from "../types";
import { useImageTexture } from "../useImageTexture";

/**
 * Shared interior building blocks: the room shell, product displays, the employee figure and
 * collider helpers. Local space: origin at the room centre, entrance at +Z, metres.
 */

export const DOOR_GAP = 2.4;
export const WALL_T = 0.3;
export const DOOR_H = 2.8;

export type Slot = InteriorTemplateDef["productSlots"][number];

// ---------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------

export interface ExtraCollider {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Four walls (front split by the door gap), a stopper past the exit, plus template furniture. */
export function roomColliders(room: InteriorTemplateDef["room"], origin: { x: number; z: number }, extra: ExtraCollider[]): AABB[] {
  const { width: W, depth: D } = room;
  const ox = origin.x;
  const oz = origin.z;
  const side = (W - DOOR_GAP) / 2;
  return [
    aabbFromCenter("wall:back", ox, oz - D / 2 - WALL_T / 2, W + WALL_T * 2, WALL_T),
    aabbFromCenter("wall:left", ox - W / 2 - WALL_T / 2, oz, WALL_T, D + WALL_T * 2),
    aabbFromCenter("wall:right", ox + W / 2 + WALL_T / 2, oz, WALL_T, D + WALL_T * 2),
    aabbFromCenter("wall:front-left", ox - DOOR_GAP / 2 - side / 2, oz + D / 2 + WALL_T / 2, side, WALL_T),
    aabbFromCenter("wall:front-right", ox + DOOR_GAP / 2 + side / 2, oz + D / 2 + WALL_T / 2, side, WALL_T),
    // The doorway itself: the exit is a hotspot inside the room, so nobody walks through it, and
    // closing it keeps the follow camera inside the room instead of behind the lintel.
    aabbFromCenter("door:camera", ox, oz + D / 2 + WALL_T / 2, DOOR_GAP + 0.2, WALL_T),
    aabbFromCenter("wall:vestibule", ox, oz + D / 2 + 1.7, DOOR_GAP + 1.2, WALL_T),
    aabbFromCenter("wall:vestibule-left", ox - DOOR_GAP / 2 - 0.3, oz + D / 2 + 0.9, 0.3, 1.8),
    aabbFromCenter("wall:vestibule-right", ox + DOOR_GAP / 2 + 0.3, oz + D / 2 + 0.9, 0.3, 1.8),
    ...extra.map((e) => aabbFromCenter(e.id, ox + e.x, oz + e.z, e.w, e.d)),
  ];
}

// ---------------------------------------------------------------------------
// Room shell
// ---------------------------------------------------------------------------

export type FloorKind = "wood" | "stone" | "concrete" | "terrazzo" | "tile";

export interface RoomProps {
  room: InteriorTemplateDef["room"];
  brand: BrandPalette;
  quality: QualityTier;
  floor: FloorKind;
  wallColor: string;
  /** Wall band colour at 1.1 m (defaults to brand.secondary). */
  bandColor?: string;
  /** Ceiling light panel grid. */
  panels?: { rows: number; cols: number };
  floorTint?: string;
  /** Cove light along the ceiling perimeter in the accent colour (default on). */
  cove?: boolean;
  /** Ceiling colour (default a dark warm grey). */
  ceilingColor?: string;
  /** Wall sconces (default on; off for dark event rooms). */
  sconces?: boolean;
}

/** Metres covered by one floor texture repeat. */
const FLOOR_TILE: Record<FloorKind, number> = { wood: 2.6, stone: 2.6, concrete: 3.2, terrazzo: 2.0, tile: 2.4 };

function floorMaterial(kind: FloorKind, tint: string | undefined, brand: BrandPalette, maxTex: number): THREE.MeshStandardMaterial {
  const size = Math.min(512, maxTex);
  let material: THREE.MeshStandardMaterial;
  switch (kind) {
    case "wood":
      material = new THREE.MeshStandardMaterial({ map: plankTexture(tint ?? "#7a5236", size), roughness: 0.45, metalness: 0.05 });
      break;
    case "stone":
      material = new THREE.MeshStandardMaterial({ map: stoneTexture(tint ?? "#5c5751", size), roughness: 0.65, metalness: 0.02 });
      break;
    case "concrete":
      material = new THREE.MeshStandardMaterial({ map: concreteTexture(tint ?? "#a09b95", size), roughness: 0.4, metalness: 0.05 });
      break;
    case "terrazzo":
      material = new THREE.MeshStandardMaterial({ map: terrazzoTexture(tint ?? "#d9d2c7", brand.secondary, size), roughness: 0.3, metalness: 0.05 });
      break;
    case "tile":
      material = new THREE.MeshStandardMaterial({ map: floorTileTexture(tint ?? mixHex(brand.primary, "#6b655e", 0.7), size), roughness: 0.35, metalness: 0.04 });
      break;
  }
  if (material.map && maxTex >= 1024) {
    material.bumpMap = material.map;
    material.bumpScale = 0.01;
  }
  return material;
}

export function Room({ room, brand, quality, floor, wallColor, bandColor, panels = { rows: 2, cols: 3 }, floorTint, cove = true, ceilingColor = "#1d1a18", sconces: withSconces = true }: RoomProps) {
  const { width: W, depth: D, height: H } = room;
  const maxTex = useMaxTextureSize();
  const tile = FLOOR_TILE[floor];
  const floorGeo = useMemo(() => tiledPlane(W, D, W / tile, D / tile), [W, D, tile]);
  const floorMat = useMemo(() => floorMaterial(floor, floorTint, brand, maxTex), [floor, floorTint, brand, maxTex]);
  const wallMat = useMemo(() => {
    const size = Math.min(512, maxTex);
    const m = new THREE.MeshStandardMaterial({ color: "#ffffff", map: plasterTexture(wallColor, size), roughness: 0.96, metalness: 0 });
    if (!m.map) m.color.set(wallColor);
    if (m.map) {
      // Walls are boxes scaled to their size; repeat the plaster about every 4 m along the long axis.
      m.map = m.map.clone();
      m.map.repeat.set(Math.max(1, Math.round(Math.max(W, D) / 4)), Math.max(1, Math.round(H / 4)));
      m.map.needsUpdate = true;
    }
    return m;
  }, [wallColor, maxTex, W, D, H]);
  const side = (W - DOOR_GAP) / 2;
  const walls = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: H / 2, z: -D / 2 - WALL_T / 2, sx: W + WALL_T * 2, sy: H, sz: WALL_T },
      { x: -W / 2 - WALL_T / 2, y: H / 2, z: 0, sx: WALL_T, sy: H, sz: D },
      { x: W / 2 + WALL_T / 2, y: H / 2, z: 0, sx: WALL_T, sy: H, sz: D },
      { x: -DOOR_GAP / 2 - side / 2, y: H / 2, z: D / 2 + WALL_T / 2, sx: side, sy: H, sz: WALL_T },
      { x: DOOR_GAP / 2 + side / 2, y: H / 2, z: D / 2 + WALL_T / 2, sx: side, sy: H, sz: WALL_T },
      { x: 0, y: DOOR_H + (H - DOOR_H) / 2, z: D / 2 + WALL_T / 2, sx: DOOR_GAP + 0.2, sy: H - DOOR_H, sz: WALL_T },
      // Vestibule walls outside the gap.
      { x: -DOOR_GAP / 2 - 0.15, y: H / 2, z: D / 2 + 1.0, sx: WALL_T, sy: H, sz: 1.8 },
      { x: DOOR_GAP / 2 + 0.15, y: H / 2, z: D / 2 + 1.0, sx: WALL_T, sy: H, sz: 1.8 },
      { x: 0, y: H / 2, z: D / 2 + 1.9, sx: DOOR_GAP + 0.6, sy: H, sz: WALL_T },
    ],
    [W, D, H, side],
  );
  const band = bandColor ?? brand.secondary;
  const bands = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: 1.15, z: -D / 2 + 0.01, sx: W, sy: 0.16, sz: 0.03 },
      { x: -W / 2 + 0.01, y: 1.15, z: 0, sx: 0.03, sy: 0.16, sz: D },
      { x: W / 2 - 0.01, y: 1.15, z: 0, sx: 0.03, sy: 0.16, sz: D },
    ],
    [W, D],
  );
  const baseboards = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: 0.06, z: -D / 2 + 0.02, sx: W, sy: 0.12, sz: 0.04 },
      { x: -W / 2 + 0.02, y: 0.06, z: 0, sx: 0.04, sy: 0.12, sz: D },
      { x: W / 2 - 0.02, y: 0.06, z: 0, sx: 0.04, sy: 0.12, sz: D },
      { x: -DOOR_GAP / 2 - side / 2, y: 0.06, z: D / 2 - 0.02, sx: side, sy: 0.12, sz: 0.04 },
      { x: DOOR_GAP / 2 + side / 2, y: 0.06, z: D / 2 - 0.02, sx: side, sy: 0.12, sz: 0.04 },
    ],
    [W, D, side],
  );
  const coves = useMemo<InstanceTransform[]>(
    () =>
      cove
        ? [
            { x: 0, y: H - 0.12, z: -D / 2 + 0.06, sx: W - 0.4, sy: 0.04, sz: 0.04 },
            { x: -W / 2 + 0.06, y: H - 0.12, z: 0, sx: 0.04, sy: 0.04, sz: D - 0.4 },
            { x: W / 2 - 0.06, y: H - 0.12, z: 0, sx: 0.04, sy: 0.04, sz: D - 0.4 },
          ]
        : [],
    [cove, W, D, H],
  );
  const doorFrame = useMemo<InstanceTransform[]>(
    () => [
      { x: -DOOR_GAP / 2 - 0.05, y: DOOR_H / 2, z: D / 2, sx: 0.1, sy: DOOR_H, sz: WALL_T + 0.1 },
      { x: DOOR_GAP / 2 + 0.05, y: DOOR_H / 2, z: D / 2, sx: 0.1, sy: DOOR_H, sz: WALL_T + 0.1 },
      { x: 0, y: DOOR_H + 0.05, z: D / 2, sx: DOOR_GAP + 0.2, sy: 0.1, sz: WALL_T + 0.1 },
    ],
    [D],
  );
  const lightPanels = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (let r = 0; r < panels.rows; r++) {
      for (let c = 0; c < panels.cols; c++) {
        const x = -W / 2 + (W / panels.cols) * (c + 0.5);
        const z = -D / 2 + (D / panels.rows) * (r + 0.5);
        out.push({ x, y: H - 0.03, z, tiltX: Math.PI / 2, sx: Math.min(2.4, W / panels.cols - 1), sy: 0.5, sz: 1 });
      }
    }
    return out;
  }, [W, D, H, panels.rows, panels.cols]);
  const panelMat = tinted("#fff3de", { emissive: "#ffe6c2", emissiveIntensity: 1.5, roughness: 0.6 });
  const accentGlow = tinted(brand.accent, { emissive: brand.accent, emissiveIntensity: 0.9, roughness: 0.5 });
  const shadows = quality === "high";
  // Wall sconces: a warm bulb and a soft light wash every ~3.5 m so bare walls read as lit plaster
  // rather than a void. Emissive only (no extra real lights).
  const sconces = useMemo(() => {
    const bulbs: InstanceTransform[] = [];
    const washes: InstanceTransform[] = [];
    if (!withSconces) return { bulbs, washes };
    const y = 2.25;
    const along = (count: number, at: (i: number) => { x: number; z: number; yaw: number }) => {
      for (let i = 0; i < count; i++) {
        const { x, z, yaw } = at(i);
        bulbs.push({ x, y, z, sx: 0.16, sy: 0.16, sz: 0.16 });
        washes.push({ x, y: y + 0.7, z, yaw, sx: 1.6, sy: 2.4, sz: 1 });
      }
    };
    const nBack = Math.max(2, Math.round(W / 3.5));
    along(nBack, (i) => ({ x: -W / 2 + (W / nBack) * (i + 0.5), z: -D / 2 + 0.08, yaw: 0 }));
    const nSide = Math.max(2, Math.round(D / 3.5));
    along(nSide, (i) => ({ x: -W / 2 + 0.08, z: -D / 2 + (D / nSide) * (i + 0.5), yaw: Math.PI / 2 }));
    along(nSide, (i) => ({ x: W / 2 - 0.08, z: -D / 2 + (D / nSide) * (i + 0.5), yaw: -Math.PI / 2 }));
    return { bulbs, washes };
  }, [W, D, withSconces]);
  const bulbMat = tinted("#ffe9c4", { emissive: "#ffcf8a", emissiveIntensity: 3.2, roughness: 0.4 });
  const washMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffd9a8", emissive: new THREE.Color("#ffbf78"), emissiveIntensity: 0.55, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }),
    [],
  );

  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
      <mesh geometry={GEO.plane} material={tinted(ceilingColor, { roughness: 1 })} position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[W + WALL_T * 2, D + 4, 1]} />
      <StaticInstances geometry={GEO.box} material={wallMat} items={walls} receiveShadow castShadow={shadows} />
      <StaticInstances geometry={GEO.box} material={tinted(band, { roughness: 0.7 })} items={bands} />
      <StaticInstances geometry={GEO.box} material={tinted(mixHex(wallColor, "#000000", 0.55), { roughness: 0.8 })} items={baseboards} />
      {coves.length > 0 && <StaticInstances geometry={GEO.box} material={accentGlow} items={coves} />}
      <StaticInstances geometry={GEO.box} material={accentGlow} items={doorFrame} />
      <StaticInstances geometry={GEO.plane} material={panelMat} items={lightPanels} />
      {sconces.bulbs.length > 0 && <StaticInstances geometry={GEO.sphere} material={bulbMat} items={sconces.bulbs} />}
      {sconces.washes.length > 0 && <StaticInstances geometry={GEO.plane} material={washMat} items={sconces.washes} />}
      <mesh geometry={GEO.box} material={tinted("#2a2c33", { roughness: 0.95 })} position={[0, 0.01, D / 2 + 0.9]} scale={[DOOR_GAP + 0.2, 0.02, 1.8]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Product display
// ---------------------------------------------------------------------------

export type DisplayVariant = "plinth" | "shelf" | "hanger" | "table";

const CARD_W = 0.8;
const CARD_H = 0.6;

/** A soft cone of light from a ceiling spot onto a display (additive; medium/high only). */
export function SpotCone({ x, z, top, bottom, radius = 0.8, color = "#ffe2bf", opacity = 0.14 }: { x: number; z: number; top: number; bottom: number; radius?: number; color?: string; opacity?: number }) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [color, opacity],
  );
  const h = top - bottom;
  return (
    <group position={[x, bottom + h / 2, z]}>
      <mesh geometry={GEO.cone} material={material} scale={[radius, h, radius]} />
      <mesh geometry={GEO.plane} material={glowMaterial(color, opacity * 2.2)} position={[0, -h / 2 + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[radius * 2.4, radius * 2.4, 1]} />
    </group>
  );
}

export function ProductDisplay({ product, brand, slot, variant, quality = "medium", ceiling }: { product: Product; brand: BrandPalette; slot: Slot; variant: DisplayVariant; quality?: QualityTier; ceiling?: number }) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(
    () => makeInitialTexture({ label: product.title, brand, size: 256, caption: product.title, maxTextureSize: maxTex }),
    [product.title, brand, maxTex],
  );
  const image = useImageTexture(product.imageUrl, fallback);
  const cardMat = useTextureMaterial(image, 0.45, { roughness: 0.5 });
  const priceTexture = useMemo(
    () =>
      makeLabelTexture(formatCents(product.priceCents, product.currency), {
        bg: "#f4f1ea",
        fg: "#1a1d24",
        subtext: product.title,
        accent: brand.accent,
        width: 512,
        height: 160,
        maxTextureSize: maxTex,
        weight: 800,
      }),
    [product.priceCents, product.currency, product.title, brand.accent, maxTex],
  );
  const priceMat = useTextureMaterial(priceTexture, 0.35, { roughness: 0.8 });

  let cardY = slot.y + CARD_H / 2 + 0.05;
  let lean = -0.14;
  let cardZ = 0;
  if (variant === "hanger") {
    cardY = slot.y - 0.22 - CARD_H / 2;
    lean = 0;
  } else if (variant === "table") {
    cardY = slot.y + CARD_H / 2 + 0.04;
    lean = -0.28;
  } else if (variant === "shelf") {
    cardY = slot.y + 0.02 + CARD_H / 2 + 0.03;
    cardZ = 0.02;
  }
  const labelY = cardY - CARD_H / 2 - 0.14;
  const frameColor = variant === "hanger" ? MAT.cardFrame : tinted(mixHex(brand.secondary, "#f4f1ea", 0.5), { roughness: 0.6 });
  const spotTop = ceiling ?? 0;
  const cardTop = cardY + CARD_H / 2;

  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.yaw, 0]}>
      {variant === "plinth" && (
        <group>
          <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.7 })} position={[0, slot.y / 2, 0]} scale={[0.6, slot.y, 0.6]} castShadow receiveShadow />
          <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#ffffff", 0.25), { roughness: 0.45 })} position={[0, slot.y + 0.02, 0]} scale={[0.66, 0.04, 0.66]} />
          {/* Lit edge under the top slab. */}
          <mesh geometry={GEO.box} material={tinted(brand.accent, { emissive: brand.accent, emissiveIntensity: 1.2, roughness: 0.5 })} position={[0, slot.y - 0.02, 0]} scale={[0.62, 0.02, 0.62]} />
          <mesh geometry={GEO.box} material={tinted("#111216", { roughness: 0.9 })} position={[0, 0.04, 0]} scale={[0.62, 0.08, 0.62]} />
        </group>
      )}
      {variant === "shelf" && (
        <group>
          <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[0, slot.y, -0.1]} scale={[1.05, 0.04, 0.36]} castShadow />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, slot.y - 0.12, -0.22]} scale={[0.06, 0.24, 0.1]} />
          <mesh geometry={GEO.box} material={tinted("#fff1d6", { emissive: "#ffd9a0", emissiveIntensity: 1.2, roughness: 0.5 })} position={[0, slot.y - 0.025, 0.02]} scale={[0.9, 0.012, 0.03]} />
        </group>
      )}
      {variant === "hanger" && (
        <group>
          <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[0, slot.y - 0.11, 0]} scale={[0.02, 0.22, 0.02]} />
          <mesh geometry={GEO.box} material={MAT.brushed} position={[-0.25, slot.y - 0.26, 0]} rotation={[0, 0, 0.35]} scale={[0.5, 0.02, 0.02]} />
          <mesh geometry={GEO.box} material={MAT.brushed} position={[0.25, slot.y - 0.26, 0]} rotation={[0, 0, -0.35]} scale={[0.5, 0.02, 0.02]} />
        </group>
      )}
      {variant === "table" && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, slot.y + 0.03, -0.08]} scale={[0.3, 0.06, 0.18]} />}
      <group position={[0, cardY, cardZ]} rotation={[lean, 0, 0]}>
        <mesh geometry={GEO.box} material={frameColor} position={[0, 0, -0.025]} scale={[CARD_W + 0.08, CARD_H + 0.08, 0.03]} />
        <mesh geometry={GEO.plane} material={cardMat} scale={[CARD_W, CARD_H, 1]} />
      </group>
      <mesh geometry={GEO.plane} material={priceMat} position={[0, labelY, cardZ + 0.06]} scale={[0.52, 0.16, 1]} />
      {variant === "plinth" && quality !== "low" && spotTop > cardTop && (
        <SpotCone x={0} z={0.05} top={spotTop - 0.1} bottom={cardTop - 0.3} radius={0.7} />
      )}
    </group>
  );
}

/** Featured first, then sortOrder; capped to the slot count. */
export function orderProducts(products: Product[], slots: number): Product[] {
  return [...products].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder).slice(0, slots);
}

// ---------------------------------------------------------------------------
// Employee, signage, lamps
// ---------------------------------------------------------------------------

export function EmployeeFigure({ employee, brand, pose }: { employee: AiEmployeePublic; brand: BrandPalette; pose: { x: number; z: number; yaw: number } }) {
  const maxTex = useMaxTextureSize();
  const texture = useMemo(
    () => makeLabelTexture(employee.name, { bg: brand.primary, fg: inkOn(brand.primary, brand), subtext: employee.role, accent: brand.accent, width: 512, height: 160, maxTextureSize: maxTex }),
    [employee.name, employee.role, brand, maxTex],
  );
  const material = useTextureMaterial(texture, 0.6, { roughness: 0.7, side: THREE.DoubleSide });
  return (
    <group position={[pose.x, 0, pose.z]} rotation={[0, pose.yaw, 0]}>
      <NpcAvatar bodyColor={brand.secondary} hairColor="#2a1c14" />
      <mesh geometry={GEO.plane} material={material} position={[0, 2.15, 0]} scale={[0.9, 0.28, 1]} />
    </group>
  );
}

export function BackWallSign({ merchant, position, width, rotationY = 0 }: { merchant: Merchant; position: [number, number, number]; width: number; rotationY?: number }) {
  return <SignPlane text={merchant.name} style={merchant.storefrontConfig.signStyle} brand={merchant.brand} position={position} width={width} aspect={5} rotationY={rotationY} />;
}

/**
 * The hero wall: the merchant's hero image as a large framed print (or lit screen) with an accent
 * light bar, falling back to a branded poster with the tagline. One per room, on the back wall.
 */
export function HeroWall({ merchant, position, width, height, rotationY = 0, screen = false, caption }: { merchant: Merchant; position: [number, number, number]; width: number; height: number; rotationY?: number; screen?: boolean; caption?: string }) {
  const brand = merchant.brand;
  const [x, y, z] = position;
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <ImageBanner
        url={merchant.heroImageUrl}
        title={caption ?? merchant.tagline ?? merchant.name}
        eyebrow={merchant.name}
        brand={brand}
        position={[0, 0, 0]}
        width={width}
        height={height}
        emissive={screen ? 0.85 : 0.5}
        frameColor={screen ? "#14151a" : mixHex(brand.secondary, "#2a2622", 0.4)}
      />
      <mesh geometry={GEO.box} material={tinted(brand.accent, { emissive: brand.accent, emissiveIntensity: 0.9, roughness: 0.5 })} position={[0, -height / 2 - 0.18, 0.02]} scale={[width, 0.04, 0.04]} />
      <mesh geometry={GEO.plane} material={glowMaterial(brand.accent, 0.2)} position={[0, -height / 2 - 0.2, 0.03]} scale={[width * 1.05, 0.9, 1]} />
    </group>
  );
}

/** Pendant lamps: cord, shade and a warm bulb, instanced (three draw calls for any count). */
export function PendantLamps({ positions, y, ceiling, shadeColor = "#23252b", quality = "medium" }: { positions: Array<[number, number]>; y: number; ceiling: number; shadeColor?: string; quality?: QualityTier }) {
  const cords = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: (y + ceiling) / 2, z, sx: 0.012, sy: ceiling - y, sz: 0.012 })), [positions, y, ceiling]);
  const shades = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y, z, sx: 0.24, sy: 0.22, sz: 0.24 })), [positions, y]);
  const bulbs = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: y - 0.12, z, sx: 0.07, sy: 0.07, sz: 0.07 })), [positions, y]);
  const halos = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: y - 0.14, z, sx: 0.9, sy: 0.9, sz: 1 })), [positions, y]);
  return (
    <group>
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={cords} />
      <StaticInstances geometry={GEO.cylinder} material={tinted(shadeColor, { roughness: 0.6, metalness: 0.3 })} items={shades} />
      <StaticInstances geometry={GEO.sphere} material={MAT.bulb} items={bulbs} />
      {quality !== "low" && <StaticInstances geometry={GEO.plane} material={glowMaterial("#ffcf8a", 0.28)} items={halos} />}
    </group>
  );
}

/** A counter: front panel in a brand colour, a wood top, a dark kick with a toe light and a till. */
export function Counter({ position, width, depth = 0.7, height = 1.05, color, topColor = "#c9a27a", yaw = 0, accent, till = false }: {
  position: [number, number];
  width: number;
  depth?: number;
  height?: number;
  color: string;
  topColor?: string;
  yaw?: number;
  /** Toe-kick LED colour; omit for none. */
  accent?: string;
  till?: boolean;
}) {
  const [x, z] = position;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={GEO.box} material={tinted(color, { roughness: 0.7 })} position={[0, height / 2, 0]} scale={[width, height, depth]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={tinted(topColor, { roughness: 0.5 })} position={[0, height + 0.03, 0]} scale={[width + 0.15, 0.06, depth + 0.15]} />
      <mesh geometry={GEO.box} material={tinted("#111216", { roughness: 0.9 })} position={[0, 0.06, 0]} scale={[width + 0.02, 0.12, depth + 0.02]} />
      {accent && <mesh geometry={GEO.box} material={tinted(accent, { emissive: accent, emissiveIntensity: 1.0, roughness: 0.5 })} position={[0, 0.13, depth / 2 + 0.02]} scale={[width - 0.2, 0.02, 0.02]} />}
      {till && (
        <group position={[width * 0.3, height + 0.06, -depth * 0.15]}>
          <mesh geometry={GEO.box} material={MAT.frame} position={[0, 0.12, 0]} scale={[0.36, 0.24, 0.3]} />
          <mesh geometry={GEO.plane} material={tinted("#9fc4ff", { emissive: "#9fc4ff", emissiveIntensity: 0.9, roughness: 0.4 })} position={[0, 0.2, 0.16]} rotation={[-0.3, 0, 0]} scale={[0.28, 0.16, 1]} />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Set dressing: shelves, booths, plants
// ---------------------------------------------------------------------------

/** A back-bar: shelves with backlit bottles/jars in brand-tinted glass. */
export function BarShelf({ position, width, yaw = 0, brand, seed = "bar", levels = 2 }: { position: [number, number, number]; width: number; yaw?: number; brand: BrandPalette; seed?: string; levels?: number }) {
  const items = useMemo(() => {
    const rand = mulberry32(hashString(seed));
    const shelves: InstanceTransform[] = [];
    const bottles: InstanceTransform[] = [];
    const palette = [mixHex(brand.secondary, "#ffffff", 0.2), mixHex(brand.accent, "#8a5a2a", 0.4), "#6b3b1f", "#3b5a2a", mixHex(brand.primary, "#ffffff", 0.35), "#b48a4a"];
    for (let l = 0; l < levels; l++) {
      const y = 0.55 * l;
      shelves.push({ x: 0, y, z: 0, sx: width, sy: 0.04, sz: 0.3 });
      const n = Math.floor(width / 0.16);
      for (let i = 0; i < n; i++) {
        if (rand() < 0.2) continue;
        const h = 0.22 + rand() * 0.22;
        bottles.push({ x: -width / 2 + 0.1 + i * 0.16 + (rand() - 0.5) * 0.03, y: y + h / 2 + 0.02, z: (rand() - 0.5) * 0.1, sx: 0.035 + rand() * 0.02, sy: h, sz: 0.035 + rand() * 0.02, color: palette[Math.floor(rand() * palette.length)] });
      }
    }
    return { shelves, bottles };
  }, [width, brand, seed, levels]);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85 }), []);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh geometry={GEO.plane} material={tinted("#ffe3bd", { emissive: "#ffd39a", emissiveIntensity: 0.55, roughness: 0.8 })} position={[0, 0.55 * (levels - 1) / 2 + 0.25, -0.16]} scale={[width + 0.1, 0.55 * levels + 0.2, 1]} />
      <StaticInstances geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} items={items.shelves} />
      <StaticInstances geometry={GEO.cylinder} material={glass} items={items.bottles} />
    </group>
  );
}

/** Banquette: an upholstered bench with a tall back along a wall. */
export function Booth({ position, length, yaw = 0, color, seats = 0 }: { position: [number, number]; length: number; yaw?: number; color: string; seats?: number }) {
  const [x, z] = position;
  const upholstery = tinted(color, { roughness: 0.9 });
  const buttons = useMemo<InstanceTransform[]>(() => {
    const n = Math.max(2, Math.round(length / 0.5));
    const out: InstanceTransform[] = [];
    for (let i = 0; i < n; i++) out.push({ x: -length / 2 + (length / n) * (i + 0.5), y: 0.95, z: -0.28, sx: 0.04, sy: 0.04, sz: 0.04 });
    return out;
  }, [length]);
  const tables = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (let i = 0; i < seats; i++) out.push({ x: -length / 2 + (length / seats) * (i + 0.5), y: 0.74, z: 0.45, sx: 0.7, sy: 0.05, sz: 0.6 });
    return out;
  }, [length, seats]);
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={GEO.box} material={upholstery} position={[0, 0.25, 0]} scale={[length, 0.5, 0.6]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={upholstery} position={[0, 0.85, -0.25]} scale={[length, 0.8, 0.12]} castShadow />
      <StaticInstances geometry={GEO.sphere} material={MAT.darkMetal} items={buttons} />
      {tables.length > 0 && <StaticInstances geometry={GEO.box} material={tinted("#3b2b21", { roughness: 0.45 })} items={tables} />}
      {tables.length > 0 && <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={tables.map((t) => ({ ...t, y: 0.36, sx: 0.05, sy: 0.72, sz: 0.05 }))} />}
    </group>
  );
}

/** Potted plants: a tall pot and layered foliage spheres. */
export function Plants({ positions, potColor = "#2f3036" }: { positions: Array<[number, number]>; potColor?: string }) {
  const pots = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: 0.3, z, sx: 0.28, sy: 0.6, sz: 0.28 })), [positions]);
  const leaves = useMemo<InstanceTransform[]>(
    () => positions.flatMap(([x, z], i) => [
      { x, y: 1.05, z, sx: 0.45, sy: 0.5 + (i % 2) * 0.1, sz: 0.45 },
      { x: x + 0.2, y: 1.35, z: z - 0.1, sx: 0.3, sy: 0.35, sz: 0.3 },
      { x: x - 0.18, y: 1.4, z: z + 0.12, sx: 0.26, sy: 0.3, sz: 0.26 },
    ]),
    [positions],
  );
  if (positions.length === 0) return null;
  return (
    <group>
      <StaticInstances geometry={GEO.cylinder} material={tinted(potColor, { roughness: 0.85 })} items={pots} castShadow />
      <StaticInstances geometry={GEO.sphere} material={MAT.foliage} items={leaves} castShadow />
    </group>
  );
}

/** Ceiling track with angled spot heads over a line of displays. */
export function TrackSpots({ positions, ceiling, length }: { positions: Array<[number, number]>; ceiling: number; length: number }) {
  const heads = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: ceiling - 0.16, z: z + 0.5, sx: 0.07, sy: 0.22, sz: 0.07, tiltX: 0.35 })), [positions, ceiling]);
  const discs = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: ceiling - 0.3, z: z + 0.56, sx: 0.06, sy: 0.02, sz: 0.06, tiltX: 0.35 })), [positions, ceiling]);
  const zs = useMemo(() => Array.from(new Set(positions.map(([, z]) => z))), [positions]);
  const tracks = useMemo<InstanceTransform[]>(() => zs.map((z) => ({ x: 0, y: ceiling - 0.04, z: z + 0.5, sx: length, sy: 0.05, sz: 0.06 })), [zs, ceiling, length]);
  return (
    <group>
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={tracks} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={heads} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.transom} items={discs} />
    </group>
  );
}
