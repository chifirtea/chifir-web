"use client";

import { useMemo } from "react";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, MenuBoard, tinted } from "@/engine/storefront/templates/parts";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { BackWallSign, BarShelf, Counter, EmployeeFigure, HeroWall, PendantLamps, Plants, ProductDisplay, Room, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Restaurant counter: a long bar with stools facing the kitchen pass, pendant lamps overhead,
 * a priced menu board and a backlit back-bar on the back wall, a side shelf of specials and the
 * brand's hero image as a big print over the pass.
 */

const ROOM = { width: 14, depth: 12, height: 3.6 };
const COUNTER_Z = -2.0;
const COUNTER_W = 10;
const STOOL_XS = [-3.75, -2.25, -0.75, 0.75, 2.25, 3.75];
const SHELF_X = -ROOM.width / 2 + 0.45;

const SLOTS: Slot[] = [
  ...[-4.2, -2.52, -0.84, 0.84, 2.52, 4.2].map((x) => ({ x, y: 1.1, z: COUNTER_Z, yaw: 0 })),
  ...[2.8, 1.1, -0.6, -2.3].map((z) => ({ x: SHELF_X, y: 1.45, z, yaw: Math.PI / 2 })),
];

function RestaurantCounterComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const seats = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x, y: 0.75, z: COUNTER_Z + 1.0, sx: 0.19, sy: 0.06, sz: 0.19 })), []);
  const posts = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x, y: 0.37, z: COUNTER_Z + 1.0, sx: 0.03, sy: 0.72, sz: 0.03 })), []);
  const bases = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x, y: 0.015, z: COUNTER_Z + 1.0, sx: 0.17, sy: 0.03, sz: 0.17 })), []);
  const rests = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x, y: 0.28, z: COUNTER_Z + 1.0, sx: 0.2, sy: 0.015, sz: 0.2 })), []);
  const lamps = useMemo<Array<[number, number]>>(() => [-3.6, -1.2, 1.2, 3.6].map((x) => [x, COUNTER_Z + 0.3]), []);
  // Place settings along the bar: a plate and a glass at each stool.
  const plates = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x, y: 1.1, z: COUNTER_Z + 0.22, sx: 0.13, sy: 0.012, sz: 0.13 })), []);
  const glasses = useMemo<InstanceTransform[]>(() => STOOL_XS.map((x) => ({ x: x + 0.18, y: 1.15, z: COUNTER_Z + 0.3, sx: 0.03, sy: 0.1, sz: 0.03 })), []);
  // Hanging pots over the pass and the heat lamps.
  const pots = useMemo<InstanceTransform[]>(() => [2.0, 2.7, 3.4, 4.1].map((x, i) => ({ x, y: 2.75 - (i % 2) * 0.08, z: -ROOM.depth / 2 + 0.6, sx: 0.12 + (i % 2) * 0.03, sy: 0.14, sz: 0.12 + (i % 2) * 0.03 })), []);
  const heatLamps = useMemo<InstanceTransform[]>(() => [1.6, 3.2, 4.8].map((x) => ({ x, y: 2.5, z: -ROOM.depth / 2 + 0.45, sx: 0.16, sy: 0.08, sz: 0.16 })), []);
  const wall = mixHex(brand.primary, "#d8cfc4", 0.62);

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="tile" wallColor={wall} panels={{ rows: 2, cols: 3 }} />
      <Counter position={[0, COUNTER_Z]} width={COUNTER_W} color={brand.secondary} accent={brand.accent} till />
      <StaticInstances geometry={GEO.cylinder} material={tinted(brand.primary, { roughness: 0.6 })} items={seats} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={posts} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={bases} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.brushed} items={rests} />
      <StaticInstances geometry={GEO.cylinder} material={tinted("#f4f1ea", { roughness: 0.35 })} items={plates} />
      <StaticInstances geometry={GEO.cylinder} material={tinted("#dfe6ea", { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 })} items={glasses} />
      {/* Kitchen pass: a warm lit opening in the back wall with a steel shelf, pots and heat lamps. */}
      <mesh geometry={GEO.box} material={MAT.frame} position={[3.2, 1.9, -ROOM.depth / 2 + 0.03]} scale={[5.2, 1.5, 0.06]} />
      <mesh geometry={GEO.plane} material={tinted("#ffd6a3", { emissive: "#ffc98a", emissiveIntensity: 1.1, roughness: 0.6 })} position={[3.2, 1.9, -ROOM.depth / 2 + 0.07]} scale={[5.0, 1.3, 1]} />
      <mesh geometry={GEO.box} material={MAT.brushed} position={[3.2, 1.2, -ROOM.depth / 2 + 0.15]} scale={[5.2, 0.06, 0.3]} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[3.2, 2.85, -ROOM.depth / 2 + 0.6]} scale={[3.0, 0.03, 0.03]} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.brushed} items={pots} />
      <StaticInstances geometry={GEO.cylinder} material={tinted("#ff9d4a", { emissive: "#ff8a2a", emissiveIntensity: 2.2, roughness: 0.4 })} items={heatLamps} />
      <PendantLamps positions={lamps} y={2.45} ceiling={ROOM.height} shadeColor={brand.primary} quality={quality} />
      <MenuBoard merchant={merchant} position={[-3.6, 2.05, -ROOM.depth / 2 + 0.05]} width={1.7} lod={0} prices lines={6} />
      <BarShelf position={[-0.4, 1.45, -ROOM.depth / 2 + 0.2]} width={1.4} brand={brand} seed={merchant.id} />
      <HeroWall merchant={merchant} position={[3.2, 3.05, -ROOM.depth / 2 + 0.08]} width={3.4} height={0.9} />
      <BackWallSign merchant={merchant} position={[ROOM.width / 2 - 0.12, 2.6, 0.5]} width={3.2} rotationY={-Math.PI / 2} />
      {/* Side shelf rail behind the wall slots. */}
      <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[SHELF_X - 0.2, 1.43, 0.25]} scale={[0.1, 0.06, 7.2]} />
      <Plants positions={[[ROOM.width / 2 - 0.7, ROOM.depth / 2 - 0.9], [-ROOM.width / 2 + 0.8, ROOM.depth / 2 - 0.9]]} />
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < 6 ? "table" : "shelf"} quality={quality} />
      ))}
      {employee && <EmployeeFigure employee={employee} brand={brand} pose={restaurantCounterTemplate.employee} />}
    </group>
  );
}

export const restaurantCounterTemplate: InteriorTemplateDef = {
  id: "restaurant-counter",
  label: "Counter service",
  suitableFor: ["restaurant", "popup"],
  room: ROOM,
  spawn: { x: 0, z: ROOM.depth / 2 - 2.8, yaw: Math.PI },
  exit: { x: 0, z: ROOM.depth / 2 - 0.5 },
  employee: { x: 0, z: COUNTER_Z - 1.1, yaw: 0 },
  productSlots: SLOTS,
  colliders: (origin) =>
    roomColliders(ROOM, origin, [
      { id: "counter", x: 0, z: COUNTER_Z, w: COUNTER_W + 0.3, d: 0.95 },
      { id: "shelf", x: SHELF_X - 0.1, z: 0.25, w: 0.9, d: 7.4 },
      ...STOOL_XS.map((x, i) => ({ id: `stool:${i}`, x, z: COUNTER_Z + 1.0, w: 0.4, d: 0.4 })),
      { id: "plant:0", x: ROOM.width / 2 - 0.7, z: ROOM.depth / 2 - 0.9, w: 0.6, d: 0.6 },
      { id: "plant:1", x: -ROOM.width / 2 + 0.8, z: ROOM.depth / 2 - 0.9, w: 0.6, d: 0.6 },
    ]),
  Component: RestaurantCounterComponent,
};
