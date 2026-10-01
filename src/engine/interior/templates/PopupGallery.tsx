"use client";

import { useMemo } from "react";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { eventWhenLabel } from "@/engine/storefront/events";
import { glowColor, mixHex } from "@/engine/storefront/signage";
import { GEO, ImageBanner, LedStrip, MAT, tinted } from "@/engine/storefront/templates/parts";
import { now } from "@/lib/time/clock";
import type { InteriorTemplateDef, InteriorTemplateProps } from "../types";
import { Counter, EmployeeFigure, ProductDisplay, Room, SpotCone, orderProducts, roomColliders, type Slot } from "./parts";

/**
 * Pop-up gallery: the inside of an event pop-up. A dark room in the brand colour with a huge drop
 * banner hanging at the back (the event's hero image and title), the collection on a diamond of
 * lit plinths under spot cones, LED floor strips, a merch counter and a small DJ table. Shows only
 * the event's collection (the renderer filters products per parcel) and reads the event through
 * the world location so the template contract stays unchanged.
 */

const ROOM = { width: 14, depth: 12, height: 4.2 };
const PLINTHS: Array<[number, number]> = [
  [0, 1.4],
  [-3.2, -0.6],
  [3.2, -0.6],
  [0, -2.6],
];
const COUNTER = { x: 4.6, z: -4.4 };
const DJ = { x: -4.6, z: -4.4 };
const BANNER_W = 7.5;
const BANNER_H = 3.0;

const SLOTS: Slot[] = [
  ...PLINTHS.map(([x, z]) => ({ x, y: 1.0, z, yaw: 0 })),
  { x: -ROOM.width / 2 + 0.45, y: 1.4, z: 2.6, yaw: Math.PI / 2 },
  { x: ROOM.width / 2 - 0.45, y: 1.4, z: 2.6, yaw: -Math.PI / 2 },
];

function PopupGalleryComponent({ merchant, products, employee, quality }: InteriorTemplateProps) {
  const brand = merchant.brand;
  const shown = useMemo(() => orderProducts(products, SLOTS.length), [products]);
  const index = useCityStore((s) => s.index);
  const location = useWorldStore((s) => s.location);
  const parcelId = location.kind === "interior" ? location.parcelId : undefined;
  const event = parcelId ? index?.eventByParcel[parcelId] : undefined;
  const builtAt = index?.builtAt ?? 0;
  const when = useMemo(() => (event ? eventWhenLabel(event, Math.max(now(), builtAt)) : ""), [event, builtAt]);
  const glow = glowColor(brand);
  const wall = mixHex(brand.primary, "#0b0a0c", 0.6);
  const floorStrips = useMemo<InstanceTransform[]>(
    () => [
      { x: -ROOM.width / 2 + 0.6, y: 0.02, z: 0, sx: 0.05, sy: 0.02, sz: ROOM.depth - 2 },
      { x: ROOM.width / 2 - 0.6, y: 0.02, z: 0, sx: 0.05, sy: 0.02, sz: ROOM.depth - 2 },
      { x: 0, y: 0.02, z: -ROOM.depth / 2 + 0.6, sx: ROOM.width - 2, sy: 0.02, sz: 0.05 },
    ],
    [],
  );
  const speakers = useMemo<InstanceTransform[]>(
    () => [
      { x: DJ.x - 1.4, y: 0.6, z: DJ.z + 0.2, sx: 0.6, sy: 1.2, sz: 0.6 },
      { x: DJ.x + 1.4, y: 0.6, z: DJ.z + 0.2, sx: 0.6, sy: 1.2, sz: 0.6 },
    ],
    [],
  );
  const stripMat = tinted(glow, { emissive: glow, emissiveIntensity: 1.8, roughness: 0.4 });

  return (
    <group>
      <Room room={ROOM} brand={brand} quality={quality} floor="concrete" floorTint="#44424a" wallColor={wall} bandColor={glow} panels={{ rows: 1, cols: 2 }} cove ceilingColor="#0a090c" sconces={false} />
      {/* The drop banner: hangs from two cables, lit from below by a strip. */}
      <ImageBanner
        url={event?.heroImageUrl ?? merchant.heroImageUrl}
        title={event?.title ?? `${merchant.name} pop-up`}
        eyebrow={merchant.name}
        footer={when || undefined}
        brand={brand}
        position={[0, 2.35, -ROOM.depth / 2 + 0.5]}
        width={BANNER_W}
        height={BANNER_H}
        emissive={0.95}
        frameColor={null}
        caption
      />
      <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[-BANNER_W / 2 + 0.2, ROOM.height - 0.17, -ROOM.depth / 2 + 0.5]} scale={[0.01, 0.35, 0.01]} />
      <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[BANNER_W / 2 - 0.2, ROOM.height - 0.17, -ROOM.depth / 2 + 0.5]} scale={[0.01, 0.35, 0.01]} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, ROOM.height - 0.35, -ROOM.depth / 2 + 0.5]} scale={[BANNER_W + 0.3, 0.05, 0.05]} />
      <LedStrip from={-BANNER_W / 2} to={BANNER_W / 2} y={0.25} z={-ROOM.depth / 2 + 1.0} color={glow} count={14} intensity={1.6} />
      <StaticInstances geometry={GEO.box} material={stripMat} items={floorStrips} />
      {/* Merch counter and a DJ table with speakers. */}
      <Counter position={[COUNTER.x, COUNTER.z]} width={2.6} depth={0.8} color={mixHex(brand.primary, "#1a1a1e", 0.3)} topColor={brand.secondary} accent={glow} till />
      <Counter position={[DJ.x, DJ.z]} width={1.8} depth={0.7} color="#15161a" topColor="#23252b" accent={glow} />
      <mesh geometry={GEO.box} material={tinted("#0e0f12", { roughness: 0.6 })} position={[DJ.x, 1.14, DJ.z]} scale={[1.2, 0.08, 0.5]} />
      <mesh geometry={GEO.plane} material={tinted(glow, { emissive: glow, emissiveIntensity: 1.0, roughness: 0.5 })} position={[DJ.x, 1.19, DJ.z]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.0, 0.3, 1]} />
      <StaticInstances geometry={GEO.box} material={tinted("#111216", { roughness: 0.8 })} items={speakers} castShadow />
      {quality !== "low" && <SpotCone x={DJ.x} z={DJ.z} top={ROOM.height - 0.1} bottom={1.2} radius={1.0} color={glow} opacity={0.1} />}
      {quality !== "low" && <pointLight position={[0, ROOM.height - 0.6, -1]} color={glow} intensity={12} distance={12} decay={2} />}
      {quality !== "low" && <pointLight position={[0, 2.6, -ROOM.depth / 2 + 1.6]} color="#ffffff" intensity={10} distance={7} decay={2} />}
      {shown.map((product, i) => (
        <ProductDisplay key={product.id} product={product} brand={brand} slot={SLOTS[i]!} variant={i < PLINTHS.length ? "plinth" : "shelf"} quality={quality} ceiling={ROOM.height} />
      ))}
      {employee && <EmployeeFigure employee={employee} brand={brand} pose={popupGalleryTemplate.employee} />}
    </group>
  );
}

export const popupGalleryTemplate: InteriorTemplateDef = {
  id: "popup-gallery",
  label: "Pop-up gallery",
  suitableFor: ["retail", "popup", "venue"],
  room: ROOM,
  spawn: { x: 0, z: ROOM.depth / 2 - 2.8, yaw: Math.PI },
  exit: { x: 0, z: ROOM.depth / 2 - 0.5 },
  employee: { x: COUNTER.x, z: COUNTER.z - 0.9, yaw: 0 },
  productSlots: SLOTS,
  colliders: (origin) =>
    roomColliders(ROOM, origin, [
      ...PLINTHS.map(([x, z], i) => ({ id: `plinth:${i}`, x, z, w: 0.75, d: 0.75 })),
      { id: "counter", x: COUNTER.x, z: COUNTER.z, w: 2.8, d: 1.0 },
      { id: "dj", x: DJ.x, z: DJ.z, w: 4.0, d: 1.0 },
      { id: "shelf:0", x: -ROOM.width / 2 + 0.35, z: 2.6, w: 0.7, d: 1.2 },
      { id: "shelf:1", x: ROOM.width / 2 - 0.35, z: 2.6, w: 0.7, d: 1.2 },
    ]),
  Component: PopupGalleryComponent,
};
