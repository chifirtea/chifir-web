"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import {
  AccentStrip,
  Awning,
  Door,
  GEO,
  Logo,
  MAT,
  MenuBoard,
  Planters,
  Sconces,
  Shell,
  SignPlane,
  Windows,
  buildingFrame,
  frameCollider,
  frameFootprint,
  planterColliders,
  signText,
  type Frame,
} from "./parts";

/**
 * Cafe: a narrow wooden house with a pitched roof, the door tucked to one side, one big warm
 * window with a mullion cross, a hanging bracket sign at the corner and lanterns by the door.
 */

const SPEC = { side: 2.5, floors: 1, floorHeight: 3.8, parapet: 0.25 };
const DOOR_W = 1.4;

function frameFor(parcel: Parcel): Frame {
  return buildingFrame(parcel, SPEC);
}

function doorX(frame: Frame): number {
  return -frame.w / 4;
}

function planterSpots(frame: Frame): Array<{ x: number; z: number }> {
  const winX = frame.w * 0.17;
  return [
    { x: winX - frame.w * 0.2, z: frame.faceZ + 0.55 },
    { x: winX + frame.w * 0.2, z: frame.faceZ + 0.55 },
  ];
}

function CafeComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const frame = useMemo(() => frameFor(parcel), [parcel]);
  const dx = doorX(frame);
  const winX = frame.w * 0.17;
  const winW = frame.w * 0.5;
  const winY = 1.55;
  const winH = 2.1;
  const panes = useMemo<InstanceTransform[]>(() => [{ x: winX, y: winY, z: frame.faceZ + 0.03, sx: winW, sy: winH, sz: 1 }], [winX, winW, frame.faceZ]);
  const mullions = useMemo<InstanceTransform[]>(
    () => [
      { x: winX, y: winY, z: frame.faceZ + 0.05, sx: 0.07, sy: winH, sz: 0.06 },
      { x: winX, y: winY + 0.35, z: frame.faceZ + 0.05, sx: winW, sy: 0.07, sz: 0.06 },
      { x: winX, y: winY - winH / 2 - 0.08, z: frame.faceZ + 0.12, sx: winW + 0.3, sy: 0.1, sz: 0.24 },
    ],
    [winX, winW, frame.faceZ],
  );
  const planters = useMemo(() => planterSpots(frame), [frame]);
  const bracketX = -frame.w / 2 + 0.9;
  const roofH = 1.7;

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} capColor={brand.secondary} />
      <mesh geometry={GEO.pyramid} material={MAT.slate} position={[0, frame.h + roofH / 2 - 0.02, frame.cz]} scale={[frame.w / 2 + 0.45, roofH, frame.d / 2 + 0.45]} castShadow />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[dx + 0.3, 3.3, frame.faceZ + 0.1]} width={Math.min(frame.w * 0.5, 5.2)} aspect={5} />
      {lod < 2 && <Windows panes={panes} border={0.18} />}
      {lod < 2 && <StaticInstances geometry={GEO.box} material={tintedWood(brand.secondary)} items={mullions} />}
      {lod < 2 && <Door frame={frame} x={dx} width={DOOR_W} height={2.4} brand={brand} lod={lod} frameColor={brand.secondary} />}
      {lod < 2 && (
        <group>
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[bracketX, 3.15, frame.faceZ + 0.6]} scale={[0.06, 0.06, 1.2]} />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[bracketX, 3.0, frame.faceZ + 1.1]} scale={[0.04, 0.3, 0.04]} />
          <SignPlane text={signText(merchant)} style={cfg.signStyle === "neon" ? "neon" : "painted"} brand={brand} position={[bracketX, 2.55, frame.faceZ + 1.1]} width={1.3} aspect={2} rotationY={Math.PI / 2} doubleSided />
        </group>
      )}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={winX} width={winW + 0.8} y={2.75} brand={brand} lod={lod} depth={1.2} kind="scalloped" />}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - 0.12, frame.faceZ + 0.08]} width={frame.w * 0.95} height={0.1} intensity={1.3} />
      )}
      {lod === 0 && <Sconces positions={[[dx - DOOR_W / 2 - 0.5, 2.45], [dx + DOOR_W / 2 + 0.5, 2.45]]} z={frame.faceZ} />}
      {lod === 0 && cfg.windowDisplay === "menu" && (
        <MenuBoard merchant={merchant} position={[(dx + DOOR_W / 2 + 0.3 + (winX - winW / 2)) / 2, 1.45, frame.faceZ + 0.06]} lod={lod} width={0.7} />
      )}
      {lod === 0 && <Logo merchant={merchant} position={[dx - DOOR_W / 2 - 1.35, 1.9, frame.faceZ + 0.06]} size={0.8} />}
      {lod < 2 && <Planters positions={planters} alt />}
    </group>
  );
}

const woodCache = new Map<string, ReturnType<typeof MAT.frame.clone>>();
function tintedWood(color: string) {
  let m = woodCache.get(color);
  if (!m) {
    m = MAT.frame.clone();
    m.color.set(color);
    m.roughness = 0.75;
    m.metalness = 0;
    woodCache.set(color, m);
  }
  return m;
}

export const cafeTemplate: StorefrontTemplateDef = {
  id: "cafe",
  label: "Cafe",
  suitableFor: ["restaurant", "service", "popup"],
  suitableTiers: ["standard", "corner"],
  lodDistances: [40, 100],
  footprint: (parcel) => frameFootprint(frameFor(parcel)),
  doorOffset: (parcel) => {
    const frame = frameFor(parcel);
    return { x: doorX(frame), z: frame.faceZ };
  },
  colliders: (parcel) => {
    const frame = frameFor(parcel);
    return [frameCollider(parcel, frame), ...planterColliders(parcel, planterSpots(frame))];
  },
  Component: CafeComponent,
};
