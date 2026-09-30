"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { makeLabelTexture, mixHex } from "@/engine/storefront/signage";
import { GEO, MAT, tinted, useMaxTextureSize, useTextureMaterial } from "@/engine/storefront/templates/parts";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { BackWallSign, Counter, EmployeeFigure, ProductDisplay, Room, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Retail racks: three clothing rails with hanging product cards, two "new in" plinths by the
 * entrance, a mirror, a curtained fitting room and a cash desk at the back.
 */

const ROOM = { width: 14, depth: 12, height: 3.6 };
const RAIL_Y = 1.65;
const RACKS = [
  { x: -3.4, z: 0.6, axis: "z" as const },
  { x: 3.4, z: 0.6, axis: "z" as const },
  { x: 0, z: -2.4, axis: "x" as const },
];
const DESK = { x: 4.0, z: -4.6 };
const FITTING = { x: -5.5, z: -5.0 };

const SLOTS: Slot[] = [
  ...[-1.2, 0, 1.2].map((dz) => ({ x: -3.4, y: RAIL_Y, z: 0.6 + dz, yaw: Math.PI / 2 })),
  ...[-1.2, 0, 1.2].map((dz) => ({ x: 3.4, y: RAIL_Y, z: 0.6 + dz, yaw: -Math.PI / 2 })),
  ...[-1.2, 0, 1.2].map((dx) => ({ x: dx, y: RAIL_Y, z: -2.4, yaw: 0 })),
  { x: -1.8, y: 0.95, z: 1.8, yaw: 0 },
  { x: 1.8, y: 0.95, z: 1.8, yaw: 0 },
];

function RetailRacksComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const maxTex = useMaxTextureSize();
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const uprights = useMemo<InstanceTransform[]>(
    () =>
      RACKS.flatMap((r) =>
        [-1, 1].map((s) => ({
          x: r.axis === "z" ? r.x : r.x + s * 1.9,
          y: RAIL_Y / 2,
          z: r.axis === "z" ? r.z + s * 1.9 : r.z,
          sx: 0.025,
          sy: RAIL_Y,
          sz: 0.025,
        })),
      ),
    [],
  );
  const rails = useMemo<InstanceTransform[]>(
    () => RACKS.map((r) => ({ x: r.x, y: RAIL_Y, z: r.z, sx: 0.02, sy: 3.8, sz: 0.02, tiltX: r.axis === "z" ? Math.PI / 2 : 0, tiltZ: r.axis === "x" ? Math.PI / 2 : 0 })),
    [],
  );
  const feet = useMemo<InstanceTransform[]>(
    () =>
      RACKS.flatMap((r) =>
        [-1, 1].map((s) => ({
          x: r.axis === "z" ? r.x : r.x + s * 1.9,
          y: 0.02,
          z: r.axis === "z" ? r.z + s * 1.9 : r.z,
          sx: r.axis === "z" ? 0.5 : 0.08,
          sy: 0.04,
          sz: r.axis === "z" ? 0.08 : 0.5,
        })),
      ),
    [],
  );
  const fittingLabel = useMemo(
    () => makeLabelTexture("Fitting room", { bg: brand.primary, fg: brand.onPrimary, accent: brand.accent, width: 512, height: 128, maxTextureSize: maxTex }),
    [brand, maxTex],
  );
  const fittingMat = useTextureMaterial(fittingLabel, 0.5, { roughness: 0.8 });
  const mirror = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c7d2dc", metalness: 1, roughness: 0.05, emissive: "#0e1218", emissiveIntensity: 0.6 }), []);
  const wall = mixHex(brand.primary, "#ece6dd", 0.82);

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="concrete" floorTint="#8f8a84" wallColor={wall} panels={{ rows: 2, cols: 3 }} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={uprights} />
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={rails} />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={feet} />
      {/* Mirror on the right wall. */}
      <group position={[ROOM.width / 2 - 0.08, 1.4, 2.6]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.6 })} position={[0, 0, -0.03]} scale={[1.0, 2.2, 0.05]} />
        <mesh geometry={GEO.plane} material={mirror} scale={[0.9, 2.1, 1]} />
      </group>
      {/* Fitting room: two panels, a rail and a curtain in the brand colour. */}
      <group position={[FITTING.x, 0, FITTING.z]}>
        <mesh geometry={GEO.box} material={tinted(wall, { roughness: 0.95 })} position={[-1.0, 1.3, 0]} scale={[0.06, 2.6, 1.8]} />
        <mesh geometry={GEO.box} material={tinted(wall, { roughness: 0.95 })} position={[1.0, 1.3, 0]} scale={[0.06, 2.6, 1.8]} />
        <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[0, 2.45, 0.85]} rotation={[0, 0, Math.PI / 2]} scale={[0.02, 2.0, 0.02]} />
        <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.95, side: THREE.DoubleSide })} position={[-0.25, 1.22, 0.86]} scale={[1.4, 2.4, 0.06]} />
        <mesh geometry={GEO.plane} material={fittingMat} position={[0, 2.75, 0.9]} scale={[1.0, 0.25, 1]} />
      </group>
      <Counter position={[DESK.x, DESK.z]} width={2.4} depth={0.8} color={brand.primary} topColor={mixHex(brand.secondary, "#ffffff", 0.1)} />
      <BackWallSign merchant={merchant} position={[2.6, 2.75, -ROOM.depth / 2 + 0.1]} width={4.4} />
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < 9 ? "hanger" : "plinth"} />
      ))}
      {employee && <EmployeeFigure employee={employee} brand={brand} pose={retailRacksTemplate.employee} />}
    </group>
  );
}

export const retailRacksTemplate: InteriorTemplateDef = {
  id: "retail-racks",
  label: "Racks",
  suitableFor: ["retail", "popup", "service"],
  room: ROOM,
  spawn: { x: 0, z: ROOM.depth / 2 - 2.8, yaw: Math.PI },
  exit: { x: 0, z: ROOM.depth / 2 - 0.5 },
  employee: { x: DESK.x, z: DESK.z - 0.85, yaw: 0 },
  productSlots: SLOTS,
  colliders: (origin) =>
    roomColliders(ROOM, origin, [
      ...RACKS.map((r, i) => ({ id: `rack:${i}`, x: r.x, z: r.z, w: r.axis === "z" ? 0.9 : 4.0, d: r.axis === "z" ? 4.0 : 0.9 })),
      { id: "plinth:0", x: -1.8, z: 1.8, w: 0.7, d: 0.7 },
      { id: "plinth:1", x: 1.8, z: 1.8, w: 0.7, d: 0.7 },
      { id: "desk", x: DESK.x, z: DESK.z, w: 2.6, d: 1.0 },
      { id: "fitting-room", x: FITTING.x, z: FITTING.z, w: 2.2, d: 1.9 },
    ]),
  Component: RetailRacksComponent,
};
