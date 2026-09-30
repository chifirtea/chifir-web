"use client";

import { useMemo } from "react";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { makePosterTexture, mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, tinted, useMaxTextureSize, useTextureMaterial } from "@/engine/storefront/templates/parts";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { useImageTexture } from "../useImageTexture";
import { BackWallSign, Counter, EmployeeFigure, ProductDisplay, Room, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Retail gallery: pedestals in two rows under track spots, a wall of shelf slots, a large screen
 * on the back wall showing the merchant's hero image and a desk to the side.
 */

const ROOM = { width: 18, depth: 14, height: 4.5 };
const PLINTHS: Array<[number, number]> = [
  [-5.5, 1.0],
  [-2.0, 1.0],
  [2.0, 1.0],
  [5.5, 1.0],
  [-5.5, -3.0],
  [-2.0, -3.0],
  [2.0, -3.0],
  [5.5, -3.0],
];
const SHELF_X = -ROOM.width / 2 + 0.45;
const DESK = { x: 6.0, z: -4.8 };
const SCREEN_W = 9;
const SCREEN_H = 3.4;

const SLOTS: Slot[] = [
  ...PLINTHS.map(([x, z]) => ({ x, y: 1.0, z, yaw: 0 })),
  ...[4.5, 1.5, -1.5, -4.5].map((z) => ({ x: SHELF_X, y: 1.5, z, yaw: Math.PI / 2 })),
];

function RetailGalleryComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const maxTex = useMaxTextureSize();
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const heroFallback = useMemo(
    () => makePosterTexture({ title: merchant.name, subtitle: merchant.tagline, eyebrow: "Now showing", brand, width: 1024, height: 384, maxTextureSize: maxTex }),
    [merchant.name, merchant.tagline, brand, maxTex],
  );
  const hero = useImageTexture(merchant.heroImageUrl, heroFallback);
  const screenMat = useTextureMaterial(hero, 0.8, { roughness: 0.3 });
  const heads = useMemo<InstanceTransform[]>(() => PLINTHS.map(([x, z]) => ({ x, y: ROOM.height - 0.16, z: z + 0.5, sx: 0.07, sy: 0.22, sz: 0.07, tiltX: 0.35 })), []);
  const discs = useMemo<InstanceTransform[]>(() => PLINTHS.map(([x, z]) => ({ x, y: ROOM.height - 0.3, z: z + 0.56, sx: 0.06, sy: 0.02, sz: 0.06, tiltX: 0.35 })), []);
  const tracks = useMemo<InstanceTransform[]>(() => [1.5, -2.5].map((z) => ({ x: 0, y: ROOM.height - 0.04, z, sx: 15, sy: 0.05, sz: 0.06 })), []);
  const wall = mixHex(brand.primary, "#ebe6de", 0.9);

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="concrete" floorTint="#b3aea7" wallColor={wall} bandColor={brand.accent} panels={{ rows: 2, cols: 4 }} />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={tracks} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={heads} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.transom} items={discs} />
      {/* Back-wall screen. */}
      <mesh geometry={GEO.box} material={MAT.frame} position={[0, 2.35, -ROOM.depth / 2 + 0.04]} scale={[SCREEN_W + 0.2, SCREEN_H + 0.2, 0.08]} />
      <mesh geometry={GEO.plane} material={screenMat} position={[0, 2.35, -ROOM.depth / 2 + 0.09]} scale={[SCREEN_W, SCREEN_H, 1]} />
      <mesh geometry={GEO.box} material={tinted(brand.accent, { emissive: brand.accent, emissiveIntensity: 0.9, roughness: 0.5 })} position={[0, 2.35 - SCREEN_H / 2 - 0.16, -ROOM.depth / 2 + 0.06]} scale={[SCREEN_W, 0.04, 0.04]} />
      <Counter position={[DESK.x, DESK.z]} width={2.4} depth={0.8} color={brand.primary} topColor={mixHex(brand.secondary, "#ffffff", 0.1)} />
      <BackWallSign merchant={merchant} position={[ROOM.width / 2 - 0.12, 3.0, -2.0]} width={4} rotationY={-Math.PI / 2} />
      <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[SHELF_X - 0.2, 1.48, 0]} scale={[0.1, 0.06, 10.4]} />
      {quality !== "low" && <pointLight position={[-3.75, 3.9, -1.0]} color="#ffe2bf" intensity={14} distance={11} decay={2} castShadow={quality === "high"} />}
      {quality !== "low" && <pointLight position={[3.75, 3.9, -1.0]} color="#ffe2bf" intensity={14} distance={11} decay={2} />}
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < PLINTHS.length ? "plinth" : "shelf"} />
      ))}
      {employee && <EmployeeFigure employee={employee} brand={brand} pose={retailGalleryTemplate.employee} />}
    </group>
  );
}

export const retailGalleryTemplate: InteriorTemplateDef = {
  id: "retail-gallery",
  label: "Gallery",
  suitableFor: ["retail", "venue", "popup", "service"],
  room: ROOM,
  spawn: { x: 0, z: ROOM.depth / 2 - 2.8, yaw: Math.PI },
  exit: { x: 0, z: ROOM.depth / 2 - 0.5 },
  employee: { x: DESK.x, z: DESK.z - 0.85, yaw: 0 },
  productSlots: SLOTS,
  colliders: (origin) =>
    roomColliders(ROOM, origin, [
      ...PLINTHS.map(([x, z], i) => ({ id: `plinth:${i}`, x, z, w: 0.7, d: 0.7 })),
      { id: "desk", x: DESK.x, z: DESK.z, w: 2.6, d: 1.0 },
      { id: "display-shelf", x: SHELF_X - 0.1, z: 0, w: 0.9, d: 10.6 },
    ]),
  Component: RetailGalleryComponent,
};
