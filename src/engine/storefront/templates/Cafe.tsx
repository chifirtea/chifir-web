"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import { houseNumber } from "../hours";
import {
  AccentStrip,
  Awning,
  Door,
  GEO,
  HeroWindow,
  Logo,
  MAT,
  MenuBoard,
  OpenSign,
  Planters,
  Sconces,
  Shell,
  SignPlane,
  buildingFrame,
  frameCollider,
  frameFootprint,
  localCollider,
  planterColliders,
  signText,
  tinted,
  type Frame,
} from "./parts";

/**
 * Cafe: a narrow wooden house with a pitched roof and chimney, the door tucked to one side, one
 * big window with a mullion cross looking into the room, a hanging bracket sign at the corner,
 * lanterns by the door and an A-frame menu board on the pavement.
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

function boardSpot(frame: Frame): { x: number; z: number } {
  return { x: doorX(frame) - DOOR_W / 2 - 1.5, z: frame.faceZ + 1.7 };
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
  const mullions = useMemo<InstanceTransform[]>(
    () => [
      { x: winX, y: winY, z: frame.faceZ + 0.05, sx: 0.07, sy: winH, sz: 0.06 },
      { x: winX, y: winY + 0.35, z: frame.faceZ + 0.05, sx: winW, sy: 0.07, sz: 0.06 },
      { x: winX, y: winY - winH / 2 - 0.08, z: frame.faceZ + 0.12, sx: winW + 0.3, sy: 0.1, sz: 0.24 },
      { x: winX - winW / 2 - 0.08, y: winY, z: frame.faceZ + 0.04, sx: 0.16, sy: winH + 0.2, sz: 0.08 },
      { x: winX + winW / 2 + 0.08, y: winY, z: frame.faceZ + 0.04, sx: 0.16, sy: winH + 0.2, sz: 0.08 },
      { x: winX, y: winY + winH / 2 + 0.08, z: frame.faceZ + 0.04, sx: winW + 0.3, sy: 0.16, sz: 0.08 },
    ],
    [winX, winW, frame.faceZ],
  );
  const planters = useMemo(() => planterSpots(frame), [frame]);
  const board = useMemo(() => boardSpot(frame), [frame]);
  const bracketX = -frame.w / 2 + 0.9;
  const roofH = 1.7;
  const wood = tintedWood(brand.secondary);
  const number = houseNumber(merchant.address?.line1, parcel.position);

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} capColor={brand.secondary} />
      <mesh geometry={GEO.pyramid} material={MAT.slate} position={[0, frame.h + roofH / 2 - 0.02, frame.cz]} scale={[frame.w / 2 + 0.45, roofH, frame.d / 2 + 0.45]} castShadow />
      {lod < 2 && <mesh geometry={GEO.box} material={tinted("#4a3b33", { roughness: 0.95 })} position={[frame.w * 0.28, frame.h + roofH * 0.75, frame.cz - frame.d * 0.2]} scale={[0.6, roofH * 0.9, 0.6]} castShadow />}
      {lod < 2 && <mesh geometry={GEO.box} material={MAT.darkMetal} position={[frame.w * 0.28, frame.h + roofH * 1.2 + 0.03, frame.cz - frame.d * 0.2]} scale={[0.7, 0.06, 0.7]} />}
      <SignPlane
        text={signText(merchant)}
        style={cfg.signStyle}
        brand={brand}
        position={[dx + 0.3, 3.3, frame.faceZ + 0.12]}
        width={Math.min(frame.w * 0.5, 5.2)}
        aspect={5}
        subtext={cfg.signStyle === "painted" || cfg.signStyle === "backlit" ? merchant.tagline : undefined}
      />
      {lod < 2 && <HeroWindow merchant={merchant} x={winX} y={winY} width={winW} height={winH} z={frame.faceZ + 0.02} depth={0.8} />}
      {lod < 2 && <StaticInstances geometry={GEO.box} material={wood} items={mullions} castShadow />}
      {lod < 2 && <Door frame={frame} x={dx} width={DOOR_W} height={2.4} brand={brand} lod={lod} frameColor={brand.secondary} number={number} matLabel={merchant.name} />}
      {lod < 2 && (
        <group>
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[bracketX, 3.15, frame.faceZ + 0.6]} scale={[0.06, 0.06, 1.2]} />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[bracketX, 3.0, frame.faceZ + 1.1]} scale={[0.04, 0.3, 0.04]} />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[bracketX, 2.75, frame.faceZ + 0.2]} rotation={[0.6, 0, 0]} scale={[0.04, 0.04, 0.9]} />
          <SignPlane text={signText(merchant)} style={cfg.signStyle === "neon" ? "neon" : "painted"} brand={brand} position={[bracketX, 2.55, frame.faceZ + 1.1]} width={1.3} aspect={2} rotationY={Math.PI / 2} doubleSided glow={false} />
        </group>
      )}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={winX} width={winW + 0.8} y={2.75} brand={brand} lod={lod} depth={1.2} kind="scalloped" />}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - 0.12, frame.faceZ + 0.08]} width={frame.w * 0.95} height={0.1} intensity={1.3} />
      )}
      {lod === 0 && <Sconces positions={[[dx - DOOR_W / 2 - 0.5, 2.45], [dx + DOOR_W / 2 + 0.5, 2.45]]} z={frame.faceZ} quality={quality} />}
      {lod === 0 && <OpenSign merchant={merchant} position={[winX + winW / 2 - 0.5, winY + winH / 2 - 0.3, frame.faceZ + 0.1]} width={0.5} />}
      {lod === 0 && cfg.windowDisplay === "menu" && (
        <group position={[board.x, 0, board.z]} rotation={[0, 0.25, 0]}>
          {/* A-frame board on the pavement: two leaning panels in the brand's wood. */}
          <mesh geometry={GEO.box} material={wood} position={[0, 0.55, 0.22]} rotation={[-0.3, 0, 0]} scale={[0.76, 1.1, 0.04]} castShadow />
          <mesh geometry={GEO.box} material={wood} position={[0, 0.55, -0.22]} rotation={[0.3, 0, 0]} scale={[0.76, 1.1, 0.04]} castShadow />
          <MenuBoard merchant={merchant} position={[0, 0.6, 0.41]} rotationY={0} lod={lod} width={0.62} lines={3} />
        </group>
      )}
      {lod === 0 && <Logo merchant={merchant} position={[dx - DOOR_W / 2 - 1.35, 1.9, frame.faceZ + 0.06]} size={0.8} />}
      {lod < 2 && <Planters positions={planters} alt trimColor={brand.secondary} />}
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
    return [
      frameCollider(parcel, frame),
      ...planterColliders(parcel, planterSpots(frame)),
      localCollider(parcel, "aboard", boardSpot(frame), 0.9, 0.7),
    ];
  },
  Component: CafeComponent,
};
