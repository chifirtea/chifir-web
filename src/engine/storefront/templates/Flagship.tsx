"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import { eventTimeLabel, nextEventFor } from "../events";
import {
  AccentStrip,
  Canopy,
  Door,
  GEO,
  Logo,
  MAT,
  PosterPlane,
  Shell,
  SignPlane,
  Vitrine,
  Windows,
  buildingFrame,
  clampFloors,
  displayKind,
  frameCollider,
  frameFootprint,
  localCollider,
  signText,
  tinted,
  type Frame,
} from "./parts";

/**
 * Flagship: a monolith of two or three floors. Double-height glass (or lit display bays) at
 * street level, cool ribbon windows above, a large backlit sign near the roofline and LED strips
 * along the glass head and the parapet. Venues swap the ribbon windows for an event screen.
 */

const SPEC = { side: 1.0, floors: 2, floorHeight: 4.2, parapet: 0.7 };
const DOOR_W = 2.6;

function frameFor(parcel: Parcel, floors = SPEC.floors): Frame {
  return buildingFrame(parcel, { ...SPEC, floors });
}

function FlagshipComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const floors = clampFloors(cfg.floors, 2, 3);
  const frame = useMemo(() => frameFor(parcel, floors), [parcel, floors]);
  const isVenue = merchant.merchantType === "venue";
  const display = displayKind(merchant);
  const events = useCityStore((s) => s.index?.snapshot.events);
  const event = useMemo(() => (isVenue && events ? nextEventFor(events, merchant.id, parcel.id) : null), [isVenue, events, merchant.id, parcel.id]);

  const glassW = frame.w * 0.9;
  const glassY = 2.15;
  const glassH = 3.7;
  const bayW = (glassW - DOOR_W - 1.2) / 2;
  const bayX = DOOR_W / 2 + 0.6 + bayW / 2;
  const mullions = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    const n = Math.max(2, Math.round(glassW / 2.4));
    for (let i = 0; i <= n; i++) {
      const x = -glassW / 2 + (glassW / n) * i;
      if (Math.abs(x) < DOOR_W / 2 + 0.4) continue;
      out.push({ x, y: glassY, z: frame.faceZ + 0.05, sx: 0.08, sy: glassH, sz: 0.1 });
    }
    out.push({ x: 0, y: glassY + glassH / 2, z: frame.faceZ + 0.05, sx: glassW + 0.1, sy: 0.1, sz: 0.1 });
    return out;
  }, [glassW, glassY, glassH, frame.faceZ]);
  const ribbons = useMemo<InstanceTransform[]>(() => {
    if (isVenue) return [];
    const out: InstanceTransform[] = [];
    for (let f = 1; f < floors; f++) out.push({ x: 0, y: f * frame.floorH + 1.2, z: frame.faceZ + 0.03, sx: frame.w * 0.86, sy: 1.3, sz: 1 });
    return out;
  }, [isVenue, floors, frame]);
  const fins = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ x: s * (DOOR_W / 2 + 0.55), y: 2.15, z: frame.faceZ + 0.35, sx: 0.22, sy: 4.3, sz: 0.7 })),
    [frame.faceZ],
  );
  const signW = Math.min(frame.w * 0.5, 12);
  const signY = frame.h - frame.parapet - 1.0 - (isVenue ? 0 : 0.25);
  const finMat = tinted(brand.accent, { roughness: 0.5, metalness: 0.2, emissive: cfg.accentLights ? brand.accent : "#000000", emissiveIntensity: 0.35 });

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, signY, frame.faceZ + 0.12]} width={signW} aspect={6} />
      {lod < 2 &&
        (display === "none" ? (
          <group>
            <mesh geometry={GEO.plane} material={MAT.glassDark} position={[0, glassY, frame.faceZ + 0.02]} scale={[glassW, glassH, 1]} />
            <StaticInstances geometry={GEO.box} material={MAT.frame} items={mullions} />
          </group>
        ) : (
          [-1, 1].map((side) => (
            <Vitrine key={side} frame={frame} x={side * bayX} y={glassY} width={bayW} height={glassH} depth={0.9} brand={brand} lod={lod} contents={display} />
          ))
        ))}
      {lod < 2 && ribbons.length > 0 && <Windows panes={ribbons} cool border={0.22} />}
      {lod < 2 && isVenue && event && (
        <PosterPlane
          title={event.title}
          subtitle={eventTimeLabel(event)}
          eyebrow={merchant.name}
          brand={brand}
          position={[0, glassY + glassH / 2 + 0.6 + Math.min(frame.w * 0.45, 16) * 0.19, frame.faceZ + 0.08]}
          width={Math.min(frame.w * 0.45, 16)}
          height={Math.min(frame.w * 0.45, 16) * 0.38}
        />
      )}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={3.0} brand={brand} lod={lod} double frameColor={brand.secondary} />}
      {lod < 2 && <StaticInstances geometry={GEO.box} material={finMat} items={fins} castShadow />}
      {lod < 2 && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - frame.parapet - 0.14, frame.faceZ + 0.1]} width={frame.w * 0.96} height={0.12} light={cfg.accentLights} intensity={cfg.accentLights ? 1.7 : 0.3} />
      )}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, glassY + glassH / 2 + 0.18, frame.faceZ + 0.1]} width={glassW} height={0.1} intensity={1.4} />
      )}
      {lod < 2 && (isVenue || cfg.awning) && (
        <Canopy position={[0, 4.35, frame.faceZ + 1.5]} width={DOOR_W + (isVenue ? 6 : 3)} depth={3} color={brand.primary} lod={lod} underside={cfg.accentLights ? brand.accent : undefined} />
      )}
      {lod === 0 && <Logo merchant={merchant} position={[-(signW / 2 + 1.5), signY, frame.faceZ + 0.08]} size={1.6} />}
    </group>
  );
}

export const flagshipTemplate: StorefrontTemplateDef = {
  id: "flagship",
  label: "Flagship",
  suitableFor: ["retail", "venue", "popup", "service"],
  suitableTiers: ["flagship", "venue", "corner"],
  lodDistances: [60, 140],
  footprint: (parcel) => frameFootprint(frameFor(parcel)),
  doorOffset: (parcel) => ({ x: 0, z: frameFor(parcel).faceZ }),
  colliders: (parcel) => {
    const frame = frameFor(parcel);
    return [
      frameCollider(parcel, frame),
      ...[-1, 1].map((s) => localCollider(parcel, `fin${s}`, { x: s * (DOOR_W / 2 + 0.55), z: frame.faceZ + 0.35 }, 0.3, 0.75)),
    ];
  },
  Component: FlagshipComponent,
};
