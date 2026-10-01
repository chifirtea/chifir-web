"use client";

import { useMemo } from "react";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, tinted } from "@/engine/storefront/templates/parts";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { BackWallSign, Counter, EmployeeFigure, HeroWall, Plants, ProductDisplay, Room, TrackSpots, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Retail gallery: pedestals in two rows under track spots, a wall of shelf slots, a large screen
 * on the back wall showing the merchant's hero image, a terrazzo floor, a central bench and a
 * desk to the side.
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
const BENCH = { x: 0, z: -1.0 };
const SCREEN_W = 9;
const SCREEN_H = 3.4;

const SLOTS: Slot[] = [
  ...PLINTHS.map(([x, z]) => ({ x, y: 1.0, z, yaw: 0 })),
  ...[4.5, 1.5, -1.5, -4.5].map((z) => ({ x: SHELF_X, y: 1.5, z, yaw: Math.PI / 2 })),
];

function RetailGalleryComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const wall = mixHex(brand.primary, "#ebe6de", 0.9);

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="terrazzo" wallColor={wall} bandColor={brand.accent} panels={{ rows: 2, cols: 4 }} />
      <TrackSpots positions={PLINTHS} ceiling={ROOM.height} length={15} />
      <HeroWall merchant={merchant} position={[0, 2.35, -ROOM.depth / 2 + 0.09]} width={SCREEN_W} height={SCREEN_H} screen />
      <Counter position={[DESK.x, DESK.z]} width={2.4} depth={0.8} color={brand.primary} topColor={mixHex(brand.secondary, "#ffffff", 0.1)} accent={brand.accent} till />
      <BackWallSign merchant={merchant} position={[ROOM.width / 2 - 0.12, 3.0, -2.0]} width={4} rotationY={-Math.PI / 2} />
      {/* Central leather bench. */}
      <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#2a201a", 0.4), { roughness: 0.85 })} position={[BENCH.x, 0.42, BENCH.z]} scale={[2.4, 0.16, 0.7]} castShadow />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[BENCH.x, 0.17, BENCH.z]} scale={[2.0, 0.34, 0.5]} />
      <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[SHELF_X - 0.2, 1.48, 0]} scale={[0.1, 0.06, 10.4]} />
      <Plants positions={[[ROOM.width / 2 - 0.8, ROOM.depth / 2 - 0.9], [-ROOM.width / 2 + 1.0, -ROOM.depth / 2 + 0.9]]} />
      {quality !== "low" && <pointLight position={[-3.75, 3.9, -1.0]} color="#ffe2bf" intensity={14} distance={11} decay={2} castShadow={quality === "high"} />}
      {quality !== "low" && <pointLight position={[3.75, 3.9, -1.0]} color="#ffe2bf" intensity={14} distance={11} decay={2} />}
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < PLINTHS.length ? "plinth" : "shelf"} quality={quality} ceiling={ROOM.height} />
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
      { id: "bench", x: BENCH.x, z: BENCH.z, w: 2.5, d: 0.8 },
      { id: "display-shelf", x: SHELF_X - 0.1, z: 0, w: 0.9, d: 10.6 },
      { id: "plant:0", x: ROOM.width / 2 - 0.8, z: ROOM.depth / 2 - 0.9, w: 0.6, d: 0.6 },
      { id: "plant:1", x: -ROOM.width / 2 + 1.0, z: -ROOM.depth / 2 + 0.9, w: 0.6, d: 0.6 },
    ]),
  Component: RetailGalleryComponent,
};
