"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import { houseNumber } from "../hours";
import {
  AccentStrip,
  Awning,
  Course,
  Door,
  GEO,
  Logo,
  MAT,
  MenuBoard,
  OpenSign,
  Planters,
  Sconces,
  Shell,
  SignPlane,
  StringLights,
  Vitrine,
  Windows,
  buildingFrame,
  clampFloors,
  displayKind,
  frameCollider,
  frameFootprint,
  planterColliders,
  signText,
  tinted,
  windowRow,
  type Frame,
} from "./parts";

/**
 * Bistro: a two-storey brick or plaster house with tall ground-floor windows, a scalloped awning,
 * warm string lights, planters by the door, flower boxes under the upper windows and the sign on
 * a string course between the floors.
 */

const SPEC = { side: 1.2, floors: 2, floorHeight: 3.6, parapet: 0.5 };
const DOOR_W = 1.7;

function frameFor(parcel: Parcel, floors = SPEC.floors): Frame {
  return buildingFrame(parcel, { ...SPEC, floors });
}

function planterSpots(frame: Frame): Array<{ x: number; z: number }> {
  return [
    { x: -(DOOR_W / 2 + 1.55), z: frame.faceZ + 0.6 },
    { x: DOOR_W / 2 + 1.55, z: frame.faceZ + 0.6 },
  ];
}

function BistroComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const floors = clampFloors(cfg.floors, 1, 3);
  const frame = useMemo(() => frameFor(parcel, floors), [parcel, floors]);
  const products = useCityStore((s) => s.index?.productsByMerchant[merchant.id]);
  const ground = useMemo(() => windowRow(frame, { y: 1.65, paneW: 1.5, paneH: 2.1, gap: 0.8, margin: 1.1, skip: [-3.2, 3.2] }), [frame]);
  const upper = useMemo(() => {
    const rows: InstanceTransform[][] = [];
    for (let f = 1; f < floors; f++) rows.push(windowRow(frame, { y: f * frame.floorH + 1.9, paneW: 1.3, paneH: 1.6, gap: 1.0, margin: 1.1 }));
    return rows.flat();
  }, [frame, floors]);
  const flowerBoxes = useMemo<InstanceTransform[]>(
    () => upper.map((p) => ({ x: p.x, y: p.y - (p.sy ?? 1) / 2 - 0.22, z: p.z + 0.18, sx: (p.sx ?? 1) * 0.9, sy: 0.26, sz: 0.3 })),
    [upper],
  );
  const flowers = useMemo<InstanceTransform[]>(
    () => upper.flatMap((p, i) => [-0.3, 0.05, 0.35].map((dx, k) => ({ x: p.x + dx, y: p.y - (p.sy ?? 1) / 2 - 0.02, z: p.z + 0.18, sx: 0.2, sy: 0.14 + ((i + k) % 2) * 0.05, sz: 0.2 }))),
    [upper],
  );
  const planters = useMemo(() => planterSpots(frame), [frame]);
  const awningW = frame.w * 0.86;
  const signW = Math.min(frame.w * 0.62, 8);
  const signY = floors > 1 ? frame.floorH + 0.62 : frame.h - frame.parapet - 0.85;
  const awningY = floors > 1 ? 2.85 : 2.55;
  const display = displayKind(merchant);
  const number = houseNumber(merchant.address?.line1, parcel.position);

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} roofUnits={1} seed={parcel.slug} />
      {lod < 2 && floors > 1 && <Course frame={frame} y={frame.floorH - 0.1} color={brand.secondary} />}
      <SignPlane
        text={signText(merchant)}
        style={cfg.signStyle}
        brand={brand}
        position={[0, signY, frame.faceZ + 0.12]}
        width={signW}
        aspect={floors > 1 ? 5 : 6}
        subtext={cfg.signStyle === "painted" || cfg.signStyle === "backlit" ? merchant.tagline : undefined}
      />
      {lod < 2 && <Windows panes={ground} sills border={0.16} />}
      {lod < 2 && upper.length > 0 && <Windows panes={upper} sills />}
      {lod === 0 && flowerBoxes.length > 0 && <StaticInstances geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.85 })} items={flowerBoxes} castShadow />}
      {lod === 0 && flowers.length > 0 && <StaticInstances geometry={GEO.sphere} material={MAT.foliageAlt} items={flowers} />}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={2.6} brand={brand} lod={lod} frameColor={brand.secondary} number={number} matLabel={merchant.name} />}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={0} width={awningW} y={awningY} brand={brand} lod={lod} depth={1.5} kind="scalloped" />}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - frame.parapet - 0.22, frame.faceZ + 0.08]} width={frame.w * 0.92} light />
      )}
      {lod === 0 && cfg.accentLights && (
        <StringLights from={-awningW / 2} to={awningW / 2} y={awningY - 0.6} z={frame.faceZ + 1.3} count={Math.round(awningW / 0.55)} />
      )}
      {lod === 0 && <Sconces positions={[[-(DOOR_W / 2 + 0.55), 2.35], [DOOR_W / 2 + 0.55, 2.35]]} z={frame.faceZ} quality={quality} />}
      {lod === 0 && cfg.windowDisplay === "menu" && <MenuBoard merchant={merchant} position={[DOOR_W / 2 + 1.55, 1.45, frame.faceZ + 0.06]} lod={lod} width={0.8} />}
      {lod === 0 && <OpenSign merchant={merchant} position={[-(DOOR_W / 2 + 1.0), 2.05, frame.faceZ + 0.06]} width={0.55} />}
      {lod < 2 && display !== "none" && (
        <Vitrine frame={frame} x={DOOR_W / 2 + 1.75} y={1.5} width={2.2} height={2.2} depth={0.6} brand={brand} lod={lod} contents={display} frameColor={brand.secondary} products={products} quality={quality} />
      )}
      {lod === 0 && <Logo merchant={merchant} position={[-(DOOR_W / 2 + 2.3), 2.0, frame.faceZ + 0.06]} size={0.9} />}
      {lod < 2 && <Planters positions={planters} trimColor={brand.secondary} />}
    </group>
  );
}

export const bistroTemplate: StorefrontTemplateDef = {
  id: "bistro",
  label: "Bistro",
  suitableFor: ["restaurant", "popup"],
  suitableTiers: ["standard", "corner"],
  lodDistances: [45, 110],
  footprint: (parcel) => frameFootprint(frameFor(parcel)),
  doorOffset: (parcel) => ({ x: 0, z: frameFor(parcel).faceZ }),
  colliders: (parcel) => {
    const frame = frameFor(parcel);
    return [frameCollider(parcel, frame), ...planterColliders(parcel, planterSpots(frame))];
  },
  Component: BistroComponent,
};
