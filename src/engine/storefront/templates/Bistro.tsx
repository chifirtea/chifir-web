"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import {
  AccentStrip,
  Awning,
  Door,
  Logo,
  MenuBoard,
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
  windowRow,
  type Frame,
} from "./parts";

/**
 * Bistro: a two-storey brick or plaster house with tall ground-floor windows, a scalloped awning,
 * warm string lights, planters by the door and the sign between the floors.
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
  const panes = useMemo(() => {
    const rows = [windowRow(frame, { y: 1.65, paneW: 1.5, paneH: 2.1, gap: 0.8, margin: 1.1, skip: [-3.2, 3.2] })];
    for (let f = 1; f < floors; f++) rows.push(windowRow(frame, { y: f * frame.floorH + 1.9, paneW: 1.3, paneH: 1.6, gap: 1.0, margin: 1.1 }));
    return rows.flat();
  }, [frame, floors]);
  const planters = useMemo(() => planterSpots(frame), [frame]);
  const awningW = frame.w * 0.86;
  const signW = Math.min(frame.w * 0.62, 8);
  const signY = floors > 1 ? frame.floorH + 0.55 : frame.h - frame.parapet - 0.85;
  const awningY = floors > 1 ? 2.85 : 2.55;
  const display = displayKind(merchant);

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, signY, frame.faceZ + 0.1]} width={signW} aspect={floors > 1 ? 5 : 6} />
      {lod < 2 && <Windows panes={panes} />}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={2.6} brand={brand} lod={lod} frameColor={brand.secondary} />}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={0} width={awningW} y={awningY} brand={brand} lod={lod} depth={1.5} kind="scalloped" />}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - frame.parapet - 0.22, frame.faceZ + 0.08]} width={frame.w * 0.92} light />
      )}
      {lod === 0 && cfg.accentLights && (
        <StringLights from={-awningW / 2} to={awningW / 2} y={awningY - 0.6} z={frame.faceZ + 1.3} count={Math.round(awningW / 0.55)} />
      )}
      {lod === 0 && <Sconces positions={[[-(DOOR_W / 2 + 0.55), 2.35], [DOOR_W / 2 + 0.55, 2.35]]} z={frame.faceZ} />}
      {lod === 0 && cfg.windowDisplay === "menu" && <MenuBoard merchant={merchant} position={[DOOR_W / 2 + 1.55, 1.45, frame.faceZ + 0.06]} lod={lod} width={0.8} />}
      {lod < 2 && display !== "none" && (
        <Vitrine frame={frame} x={DOOR_W / 2 + 1.75} y={1.5} width={2.2} height={2.2} depth={0.6} brand={brand} lod={lod} contents={display} frameColor={brand.secondary} />
      )}
      {lod === 0 && <Logo merchant={merchant} position={[-(DOOR_W / 2 + 1.55), 2.0, frame.faceZ + 0.06]} size={0.9} />}
      {lod < 2 && <Planters positions={planters} />}
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
