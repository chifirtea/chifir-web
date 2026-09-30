"use client";

import { useMemo } from "react";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, tinted } from "@/engine/storefront/templates/parts";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { BackWallSign, Counter, EmployeeFigure, PendantLamps, ProductDisplay, Room, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Restaurant dining room: candle-lit tables with chairs under pendant lamps, a host stand by the
 * entrance, a dessert counter at the back and a display wall of the menu along one side.
 */

const ROOM = { width: 16, depth: 14, height: 4.0 };
const TABLES: Array<[number, number]> = [
  [-4, 1.5],
  [0, 1.5],
  [4, 1.5],
  [-4, -2.5],
  [0, -2.5],
  [4, -2.5],
];
const DESSERT_Z = -ROOM.depth / 2 + 1.2;
const SHELF_X = -ROOM.width / 2 + 0.45;
const HOST = { x: 3.0, z: 3.9 };

const SLOTS: Slot[] = [
  { x: -1.5, y: 1.06, z: DESSERT_Z, yaw: 0 },
  { x: 1.5, y: 1.06, z: DESSERT_Z, yaw: 0 },
  ...[4.9, 3.5, 2.1, 0.7, -0.7, -2.1, -3.5, -4.9].map((z) => ({ x: SHELF_X, y: 1.5, z, yaw: Math.PI / 2 })),
];

function RestaurantDiningComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const tops = useMemo<InstanceTransform[]>(() => TABLES.map(([x, z]) => ({ x, y: 0.75, z, sx: 0.55, sy: 0.05, sz: 0.55 })), []);
  const pedestals = useMemo<InstanceTransform[]>(() => TABLES.map(([x, z]) => ({ x, y: 0.37, z, sx: 0.06, sy: 0.72, sz: 0.06 })), []);
  const feet = useMemo<InstanceTransform[]>(() => TABLES.map(([x, z]) => ({ x, y: 0.015, z, sx: 0.3, sy: 0.03, sz: 0.3 })), []);
  const chairs = useMemo(() => {
    const seats: InstanceTransform[] = [];
    const backs: InstanceTransform[] = [];
    for (const [x, z] of TABLES) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const cx = x + Math.sin(a) * 0.9;
        const cz = z + Math.cos(a) * 0.9;
        seats.push({ x: cx, y: 0.45, z: cz, yaw: a, sx: 0.42, sy: 0.06, sz: 0.42 });
        backs.push({ x: cx + Math.sin(a) * 0.19, y: 0.72, z: cz + Math.cos(a) * 0.19, yaw: a, sx: 0.42, sy: 0.48, sz: 0.05 });
      }
    }
    return { seats, backs };
  }, []);
  const candles = useMemo<InstanceTransform[]>(() => TABLES.map(([x, z]) => ({ x, y: 0.83, z, sx: 0.03, sy: 0.12, sz: 0.03 })), []);
  const flames = useMemo<InstanceTransform[]>(() => TABLES.map(([x, z]) => ({ x, y: 0.92, z, sx: 0.045, sy: 0.06, sz: 0.045 })), []);
  const wall = mixHex(brand.primary, "#cdbfae", 0.5);
  const chairMat = tinted(mixHex(brand.secondary, "#2a201a", 0.55), { roughness: 0.8 });

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="wood" wallColor={wall} panels={{ rows: 2, cols: 3 }} />
      <StaticInstances geometry={GEO.cylinder} material={tinted("#3b2b21", { roughness: 0.45 })} items={tops} castShadow={quality === "high"} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={pedestals} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={feet} />
      <StaticInstances geometry={GEO.box} material={chairMat} items={chairs.seats} />
      <StaticInstances geometry={GEO.box} material={chairMat} items={chairs.backs} />
      <StaticInstances geometry={GEO.cylinder} material={tinted("#f3e6cf", { roughness: 0.6 })} items={candles} />
      <StaticInstances geometry={GEO.sphere} material={tinted("#ffe3a8", { emissive: "#ffb457", emissiveIntensity: 3, roughness: 0.3 })} items={flames} />
      <PendantLamps positions={TABLES} y={2.2} ceiling={ROOM.height} shadeColor={brand.primary} />
      <Counter position={[0, DESSERT_Z]} width={5} depth={0.8} color={brand.secondary} />
      <mesh geometry={GEO.box} material={tinted(brand.accent, { emissive: brand.accent, emissiveIntensity: 0.6, roughness: 0.5 })} position={[0, 1.12, DESSERT_Z + 0.42]} scale={[5, 0.03, 0.02]} />
      <BackWallSign merchant={merchant} position={[0, 3.0, -ROOM.depth / 2 + 0.1]} width={5} />
      {/* Host stand near the entrance. */}
      <mesh geometry={GEO.box} material={tinted(brand.primary, { roughness: 0.6 })} position={[HOST.x, 0.55, HOST.z]} scale={[0.8, 1.1, 0.5]} castShadow />
      <mesh geometry={GEO.box} material={tinted("#c9a27a", { roughness: 0.5 })} position={[HOST.x, 1.12, HOST.z]} scale={[0.9, 0.04, 0.6]} />
      <mesh geometry={GEO.box} material={tinted("#3a2d24", { roughness: 0.7 })} position={[SHELF_X - 0.2, 1.48, 0]} scale={[0.1, 0.06, 11.2]} />
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < 2 ? "table" : "shelf"} />
      ))}
      {employee && <EmployeeFigure employee={employee} brand={brand} pose={restaurantDiningTemplate.employee} />}
    </group>
  );
}

export const restaurantDiningTemplate: InteriorTemplateDef = {
  id: "restaurant-dining",
  label: "Dining room",
  suitableFor: ["restaurant", "venue"],
  room: ROOM,
  spawn: { x: 0, z: ROOM.depth / 2 - 2.8, yaw: Math.PI },
  exit: { x: 0, z: ROOM.depth / 2 - 0.5 },
  employee: { x: HOST.x, z: HOST.z - 0.9, yaw: 0 },
  productSlots: SLOTS,
  colliders: (origin) =>
    roomColliders(ROOM, origin, [
      ...TABLES.map(([x, z], i) => ({ id: `table:${i}`, x, z, w: 2.3, d: 2.3 })),
      { id: "dessert-counter", x: 0, z: DESSERT_Z, w: 5.3, d: 1.0 },
      { id: "host-stand", x: HOST.x, z: HOST.z, w: 0.95, d: 0.65 },
      { id: "display-shelf", x: SHELF_X - 0.1, z: 0, w: 0.9, d: 11.4 },
    ]),
  Component: RestaurantDiningComponent,
};
