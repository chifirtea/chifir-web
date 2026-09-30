"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import {
  AccentStrip,
  Awning,
  Door,
  GEO,
  Logo,
  MenuBoard,
  Planters,
  Sconces,
  Shell,
  SignPlane,
  Vitrine,
  buildingFrame,
  displayKind,
  frameCollider,
  frameFootprint,
  localCollider,
  planterColliders,
  signText,
  tinted,
  type Frame,
} from "./parts";

/**
 * Boutique: one tall, elegant floor. Two framed, lit display bays flank a centred door under a
 * narrow awning; a painted board sits below a cornice in the brand's secondary colour.
 */

const SPEC = { side: 1.5, floors: 1, floorHeight: 5.0, parapet: 0.6 };
const DOOR_W = 1.6;

function frameFor(parcel: Parcel): Frame {
  return buildingFrame(parcel, SPEC);
}

function bays(frame: Frame): { width: number; x: number } {
  const width = Math.max(1.6, (frame.w - DOOR_W - 2.6) / 2);
  return { width, x: DOOR_W / 2 + 1.0 + width / 2 };
}

function planterSpots(frame: Frame): Array<{ x: number; z: number }> {
  const { x } = bays(frame);
  return [
    { x: -x, z: frame.faceZ + 1.35 },
    { x, z: frame.faceZ + 1.35 },
  ];
}

function BoutiqueComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const frame = useMemo(() => frameFor(parcel), [parcel]);
  const { width: bayW, x: bayX } = useMemo(() => bays(frame), [frame]);
  const planters = useMemo(() => planterSpots(frame), [frame]);
  const display = displayKind(merchant);
  const corniceY = frame.h - frame.parapet - 0.3;
  const signW = Math.min(frame.w * 0.56, 7.2);

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} capColor={brand.secondary} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, 3.9, frame.faceZ + 0.1]} width={signW} aspect={6} />
      {lod < 2 && (
        <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.8 })} position={[0, corniceY, frame.faceZ + 0.12]} scale={[frame.w + 0.1, 0.18, 0.3]} castShadow />
      )}
      {lod < 2 &&
        [-1, 1].map((side) => (
          <Vitrine
            key={side}
            frame={frame}
            x={side * bayX}
            y={1.75}
            width={bayW}
            height={2.6}
            depth={0.7}
            brand={brand}
            lod={lod}
            contents={display}
            frameColor={brand.secondary}
          />
        ))}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={2.7} brand={brand} lod={lod} frameColor={brand.secondary} />}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={0} width={DOOR_W + 1.6} y={3.15} brand={brand} lod={lod} depth={1.1} kind="scalloped" />}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, corniceY - 0.16, frame.faceZ + 0.1]} width={frame.w * 0.9} height={0.08} intensity={1.2} />
      )}
      {lod === 0 && <Sconces positions={[[-(frame.w / 2 - 0.5), 3.4], [frame.w / 2 - 0.5, 3.4]]} z={frame.faceZ} />}
      {lod === 0 && cfg.windowDisplay === "menu" && <MenuBoard merchant={merchant} position={[DOOR_W / 2 + 0.6, 1.5, frame.faceZ + 0.06]} lod={lod} width={0.6} />}
      {lod === 0 && cfg.windowDisplay !== "menu" && <Logo merchant={merchant} position={[DOOR_W / 2 + 0.55, 1.65, frame.faceZ + 0.06]} size={0.55} />}
      {lod < 2 && <Planters positions={planters} />}
    </group>
  );
}

export const boutiqueTemplate: StorefrontTemplateDef = {
  id: "boutique",
  label: "Boutique",
  suitableFor: ["retail", "service", "popup"],
  suitableTiers: ["standard", "corner"],
  lodDistances: [45, 110],
  footprint: (parcel) => frameFootprint(frameFor(parcel)),
  doorOffset: (parcel) => ({ x: 0, z: frameFor(parcel).faceZ }),
  colliders: (parcel) => {
    const frame = frameFor(parcel);
    const { width, x } = bays(frame);
    return [
      frameCollider(parcel, frame),
      ...planterColliders(parcel, planterSpots(frame)),
      ...[-1, 1].map((side) => localCollider(parcel, `vitrine${side}`, { x: side * x, z: frame.faceZ + 0.35 }, width + 0.1, 0.72)),
    ];
  },
  Component: BoutiqueComponent,
};
