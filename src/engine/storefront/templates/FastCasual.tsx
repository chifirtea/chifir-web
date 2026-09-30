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
  Shell,
  SignPlane,
  Vitrine,
  buildingFrame,
  displayKind,
  frameCollider,
  frameFootprint,
  signText,
  type Frame,
} from "./parts";

/**
 * Fast casual: one wide, tall floor of glass with a neon band along the top, a big sign over the
 * entrance, a flat canopy and a menu board mounted on the window.
 */

const SPEC = { side: 0.8, front: 1.5, back: 1.5, floors: 1, floorHeight: 4.4, parapet: 0.6 };
const DOOR_W = 1.8;

function frameFor(parcel: Parcel): Frame {
  return buildingFrame(parcel, SPEC);
}

function FastCasualComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const frame = useMemo(() => frameFor(parcel), [parcel]);
  const glassW = (frame.w * 0.92 - DOOR_W - 1.0) / 2;
  const glassX = DOOR_W / 2 + 0.5 + glassW / 2;
  const glassY = 1.75;
  const glassH = 2.5;
  const display = displayKind(merchant);
  const mullions = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (const side of [-1, 1]) {
      const n = Math.max(1, Math.floor(glassW / 1.7));
      for (let i = 1; i < n; i++) {
        out.push({ x: side * (glassX - glassW / 2 + (glassW / n) * i), y: glassY, z: frame.faceZ + 0.05, sx: 0.06, sy: glassH, sz: 0.08 });
      }
      out.push({ x: side * glassX, y: glassY + glassH / 2, z: frame.faceZ + 0.05, sx: glassW + 0.1, sy: 0.08, sz: 0.08 });
      out.push({ x: side * glassX, y: glassY - glassH / 2, z: frame.faceZ + 0.05, sx: glassW + 0.1, sy: 0.08, sz: 0.08 });
    }
    return out;
  }, [glassW, glassX, glassY, glassH, frame.faceZ]);
  const signW = Math.min(frame.w * 0.7, 8.4);

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, 3.55, frame.faceZ + 0.1]} width={signW} aspect={7} />
      {lod < 2 &&
        (display === "none"
          ? [-1, 1].map((side) => (
              <mesh key={side} geometry={GEO.plane} material={MAT.glassDark} position={[side * glassX, glassY, frame.faceZ + 0.02]} scale={[glassW, glassH, 1]} />
            ))
          : [-1, 1].map((side) => (
              <Vitrine key={side} frame={frame} x={side * glassX} y={glassY} width={glassW} height={glassH} depth={0.7} brand={brand} lod={lod} contents={display} />
            )))}
      {lod < 2 && display === "none" && <StaticInstances geometry={GEO.box} material={MAT.frame} items={mullions} />}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={2.7} brand={brand} lod={lod} />}
      {lod < 2 && (
        <AccentStrip
          brand={brand}
          quality={quality}
          lod={lod}
          position={[0, 4.3, frame.faceZ + 0.08]}
          width={frame.w * 0.98}
          height={0.14}
          light={cfg.accentLights}
          intensity={cfg.accentLights ? 1.8 : 0.35}
        />
      )}
      {lod < 2 && cfg.awning && <Awning frame={frame} x={0} width={DOOR_W + 3.2} y={3.0} brand={brand} lod={lod} depth={1.4} kind="flat" />}
      {lod === 0 && cfg.windowDisplay === "menu" && (
        <MenuBoard merchant={merchant} position={[DOOR_W / 2 + 1.35, 1.6, frame.faceZ + (display === "none" ? 0.1 : 0.82)]} lod={lod} width={0.85} />
      )}
      {lod === 0 && <Logo merchant={merchant} position={[-(DOOR_W / 2 + 1.4), 2.3, frame.faceZ + (display === "none" ? 0.1 : 0.82)]} size={0.95} />}
      {lod <= 1 && <mesh geometry={GEO.box} material={MAT.roof} position={[frame.w * 0.28, frame.h + 0.4, frame.cz - 1]} scale={[1.8, 0.8, 1.3]} castShadow />}
    </group>
  );
}

export const fastCasualTemplate: StorefrontTemplateDef = {
  id: "fast-casual",
  label: "Fast casual",
  suitableFor: ["restaurant", "popup"],
  suitableTiers: ["standard", "corner"],
  lodDistances: [45, 110],
  footprint: (parcel) => frameFootprint(frameFor(parcel)),
  doorOffset: (parcel) => ({ x: 0, z: frameFor(parcel).faceZ }),
  colliders: (parcel) => [frameCollider(parcel, frameFor(parcel))],
  Component: FastCasualComponent,
};
