"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { AiEmployeePublic, BrandPalette, Merchant, Product } from "@/types/domain";
import type { QualityTier } from "@/engine/canvas/quality";
import { aabbFromCenter, type AABB } from "@/engine/physics/types";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { tiledPlane } from "@/engine/environment/geometry";
import { NpcAvatar } from "@/engine/player/Avatar";
import { concreteTexture, plankTexture, stoneTexture } from "@/engine/storefront/facade";
import { makeInitialTexture, makeLabelTexture, mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, SignPlane, tinted, useMaxTextureSize, useTextureMaterial } from "@/engine/storefront/templates/parts";
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

export type FloorKind = "wood" | "stone" | "concrete";

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
}

function floorMaterial(kind: FloorKind, tint: string | undefined, maxTex: number): THREE.MeshStandardMaterial {
  const size = Math.min(512, maxTex);
  switch (kind) {
    case "wood":
      return new THREE.MeshStandardMaterial({ map: plankTexture(tint ?? "#7a5236", size), roughness: 0.5, metalness: 0.05 });
    case "stone":
      return new THREE.MeshStandardMaterial({ map: stoneTexture(tint ?? "#5c5751", size), roughness: 0.7, metalness: 0.02 });
    case "concrete":
      return new THREE.MeshStandardMaterial({ map: concreteTexture(tint ?? "#a09b95", size), roughness: 0.35, metalness: 0.05 });
  }
}

export function Room({ room, brand, quality, floor, wallColor, bandColor, panels = { rows: 2, cols: 3 }, floorTint }: RoomProps) {
  const { width: W, depth: D, height: H } = room;
  const maxTex = useMaxTextureSize();
  const floorGeo = useMemo(() => tiledPlane(W, D, W / 2.6, D / 2.6), [W, D]);
  const floorMat = useMemo(() => floorMaterial(floor, floorTint, maxTex), [floor, floorTint, maxTex]);
  const wallMat = tinted(wallColor, { roughness: 0.95 });
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
  }, [W, D]);
  const bulbMat = tinted("#ffe9c4", { emissive: "#ffcf8a", emissiveIntensity: 3.2, roughness: 0.4 });
  const washMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffd9a8", emissive: new THREE.Color("#ffbf78"), emissiveIntensity: 0.55, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }),
    [],
  );

  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
      <mesh geometry={GEO.plane} material={tinted("#1d1a18", { roughness: 1 })} position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[W + WALL_T * 2, D + 4, 1]} />
      <StaticInstances geometry={GEO.box} material={wallMat} items={walls} receiveShadow castShadow={shadows} />
      <StaticInstances geometry={GEO.box} material={tinted(band, { roughness: 0.7 })} items={bands} />
      <StaticInstances geometry={GEO.box} material={accentGlow} items={doorFrame} />
      <StaticInstances geometry={GEO.plane} material={panelMat} items={lightPanels} />
      <StaticInstances geometry={GEO.sphere} material={bulbMat} items={sconces.bulbs} />
      <StaticInstances geometry={GEO.plane} material={washMat} items={sconces.washes} />
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

export function ProductDisplay({ product, brand, slot, variant }: { product: Product; brand: BrandPalette; slot: Slot; variant: DisplayVariant }) {
  const maxTex = useMaxTextureSize();
  const fallback = useMemo(
    () => makeInitialTexture({ label: product.title, brand, size: 256, caption: product.title, maxTextureSize: maxTex }),
    [product.title, brand, maxTex],
  );
  const image = useImageTexture(product.imageUrl, fallback);
  const cardMat = useTextureMaterial(image, 0.45, { roughness: 0.55 });
  const priceTexture = useMemo(
    () =>
      makeLabelTexture(formatCents(product.priceCents, product.currency), {
        bg: brand.primary,
        fg: brand.onPrimary,
        subtext: product.title,
        accent: brand.accent,
        width: 512,
        height: 160,
        maxTextureSize: maxTex,
      }),
    [product.priceCents, product.currency, product.title, brand, maxTex],
  );
  const priceMat = useTextureMaterial(priceTexture, 0.5, { roughness: 0.7 });

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

  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.yaw, 0]}>
      {variant === "plinth" && (
        <group>
          <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.75 })} position={[0, slot.y / 2, 0]} scale={[0.56, slot.y, 0.56]} castShadow receiveShadow />
          <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#ffffff", 0.2), { roughness: 0.5 })} position={[0, slot.y + 0.02, 0]} scale={[0.62, 0.04, 0.62]} />
        </group>
      )}
      {variant === "shelf" && (
        <group>
          <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[0, slot.y, -0.1]} scale={[1.05, 0.04, 0.36]} castShadow />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, slot.y - 0.12, -0.22]} scale={[0.06, 0.24, 0.1]} />
        </group>
      )}
      {variant === "hanger" && <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[0, slot.y - 0.11, 0]} scale={[0.02, 0.22, 0.02]} />}
      {variant === "table" && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, slot.y + 0.03, -0.08]} scale={[0.3, 0.06, 0.18]} />}
      <group position={[0, cardY, cardZ]} rotation={[lean, 0, 0]}>
        <mesh geometry={GEO.box} material={MAT.frame} position={[0, 0, -0.025]} scale={[CARD_W + 0.06, CARD_H + 0.06, 0.03]} />
        <mesh geometry={GEO.plane} material={cardMat} scale={[CARD_W, CARD_H, 1]} />
      </group>
      <mesh geometry={GEO.plane} material={priceMat} position={[0, labelY, cardZ + 0.06]} scale={[0.52, 0.16, 1]} />
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
    () => makeLabelTexture(employee.name, { bg: brand.primary, fg: brand.onPrimary, subtext: employee.role, accent: brand.accent, width: 512, height: 160, maxTextureSize: maxTex }),
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

/** Pendant lamps: cord, shade and a warm bulb, instanced (three draw calls for any count). */
export function PendantLamps({ positions, y, ceiling, shadeColor = "#23252b" }: { positions: Array<[number, number]>; y: number; ceiling: number; shadeColor?: string }) {
  const cords = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: (y + ceiling) / 2, z, sx: 0.012, sy: ceiling - y, sz: 0.012 })), [positions, y, ceiling]);
  const shades = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y, z, sx: 0.24, sy: 0.22, sz: 0.24 })), [positions, y]);
  const bulbs = useMemo<InstanceTransform[]>(() => positions.map(([x, z]) => ({ x, y: y - 0.12, z, sx: 0.07, sy: 0.07, sz: 0.07 })), [positions, y]);
  return (
    <group>
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={cords} />
      <StaticInstances geometry={GEO.cylinder} material={tinted(shadeColor, { roughness: 0.6, metalness: 0.3 })} items={shades} />
      <StaticInstances geometry={GEO.sphere} material={MAT.bulb} items={bulbs} />
    </group>
  );
}

/** A counter: front panel in a brand colour, a wood top and a dark kick. */
export function Counter({ position, width, depth = 0.7, height = 1.05, color, topColor = "#c9a27a", yaw = 0 }: {
  position: [number, number];
  width: number;
  depth?: number;
  height?: number;
  color: string;
  topColor?: string;
  yaw?: number;
}) {
  const [x, z] = position;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={GEO.box} material={tinted(color, { roughness: 0.7 })} position={[0, height / 2, 0]} scale={[width, height, depth]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={tinted(topColor, { roughness: 0.5 })} position={[0, height + 0.03, 0]} scale={[width + 0.15, 0.06, depth + 0.15]} />
      <mesh geometry={GEO.box} material={tinted("#111216", { roughness: 0.9 })} position={[0, 0.06, 0]} scale={[width + 0.02, 0.12, depth + 0.02]} />
    </group>
  );
}
