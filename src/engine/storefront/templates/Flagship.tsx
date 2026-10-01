"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import { now } from "@/lib/time/clock";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import { eventWhenLabel } from "../events";
import { houseNumber } from "../hours";
import {
  AccentStrip,
  Canopy,
  Door,
  GEO,
  HeroWindow,
  ImageBanner,
  LedStrip,
  Logo,
  MAT,
  OpenSign,
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
import { glowColor } from "../signage";

/**
 * Flagship: a monolith of two or three floors. Double-height glass (or lit display bays with the
 * real products) at street level, cool ribbon windows above, a large sign near the roofline, a
 * campaign screen with the brand's hero imagery, LED edges and a rooftop mark. Venues swap the
 * campaign screen for the event's hero image and time.
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
  const products = useCityStore((s) => s.index?.productsByMerchant[merchant.id]);
  const event = useCityStore((s) => s.index?.eventByParcel[parcel.id]);
  const builtAt = useCityStore((s) => s.index?.builtAt ?? 0);
  const when = useMemo(() => (event ? eventWhenLabel(event, Math.max(now(), builtAt)) : ""), [event, builtAt]);

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
  // Ribbon windows start on the second upper floor when a campaign screen takes the first.
  const ribbons = useMemo<InstanceTransform[]>(() => {
    const out: InstanceTransform[] = [];
    for (let f = isVenue ? 2 : 1; f < floors; f++) out.push({ x: 0, y: f * frame.floorH + 1.2, z: frame.faceZ + 0.03, sx: frame.w * 0.86, sy: 1.3, sz: 1 });
    return out;
  }, [isVenue, floors, frame]);
  const fins = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ x: s * (DOOR_W / 2 + 0.55), y: 2.15, z: frame.faceZ + 0.35, sx: 0.22, sy: 4.3, sz: 0.7 })),
    [frame.faceZ],
  );
  const signW = Math.min(frame.w * 0.46, 11);
  const signY = frame.h - frame.parapet - 1.0;
  const finMat = tinted(brand.accent, { roughness: 0.5, metalness: 0.2, emissive: cfg.accentLights ? brand.accent : "#000000", emissiveIntensity: 0.35 });
  const number = houseNumber(merchant.address?.line1, parcel.position);
  const glow = glowColor(brand);
  // Campaign screen: the hero image on the first upper floor beside the sign (retail), or the
  // event banner across the façade (venue).
  const screenW = isVenue ? Math.min(frame.w * 0.6, 18) : Math.min(frame.w * 0.4, 9);
  const screenH = isVenue ? screenW * 0.42 : screenW * 0.5625;
  const screenY = isVenue ? glassY + glassH / 2 + 0.7 + screenH / 2 : frame.floorH + 1.35;
  const screenX = isVenue ? 0 : frame.w * 0.22;

  return (
    <group>
      <Shell frame={frame} merchant={merchant} lod={lod} roofUnits={2} seed={parcel.slug} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[isVenue ? 0 : -frame.w * 0.2, signY, frame.faceZ + 0.14]} width={signW} aspect={6} />
      {lod < 2 &&
        (display === "none" ? (
          <group>
            <HeroWindow merchant={merchant} x={-(DOOR_W / 2 + 0.6 + bayW / 2)} y={glassY} width={bayW} height={glassH} z={frame.faceZ + 0.02} depth={0.9} />
            <HeroWindow merchant={merchant} x={DOOR_W / 2 + 0.6 + bayW / 2} y={glassY} width={bayW} height={glassH} z={frame.faceZ + 0.02} depth={0.9} />
            <StaticInstances geometry={GEO.box} material={MAT.frame} items={mullions} />
          </group>
        ) : (
          [-1, 1].map((side) => (
            <Vitrine key={side} frame={frame} x={side * bayX} y={glassY} width={bayW} height={glassH} depth={0.9} brand={brand} lod={lod} contents={display} products={products} quality={quality} />
          ))
        ))}
      {lod < 2 && ribbons.length > 0 && <Windows panes={ribbons} cool border={0.22} />}
      {lod < 2 && isVenue && event && (
        <ImageBanner
          url={event.heroImageUrl}
          title={event.title}
          subtitle={when}
          eyebrow={merchant.name}
          footer={when}
          brand={brand}
          position={[0, screenY, frame.faceZ + 0.1]}
          width={screenW}
          height={screenH}
          emissive={0.9}
          caption
        />
      )}
      {lod < 2 && !isVenue && (
        <ImageBanner
          url={merchant.heroImageUrl}
          title={merchant.tagline ?? merchant.name}
          eyebrow={merchant.name}
          brand={brand}
          position={[screenX, screenY, frame.faceZ + 0.1]}
          width={screenW}
          height={screenH}
          emissive={0.7}
          frameColor={brand.secondary}
        />
      )}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={3.0} brand={brand} lod={lod} double frameColor={brand.secondary} number={number} matLabel={merchant.name} />}
      {lod < 2 && <StaticInstances geometry={GEO.box} material={finMat} items={fins} castShadow />}
      {lod < 2 && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, frame.h - frame.parapet - 0.14, frame.faceZ + 0.1]} width={frame.w * 0.96} height={0.12} light={cfg.accentLights} intensity={cfg.accentLights ? 1.7 : 0.3} />
      )}
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, glassY + glassH / 2 + 0.18, frame.faceZ + 0.1]} width={glassW} height={0.1} intensity={1.4} />
      )}
      {lod === 0 && cfg.accentLights && (
        <group>
          <LedStrip from={0.6} to={frame.h - frame.parapet - 0.4} y={0} x={-frame.w / 2 + 0.05} z={frame.faceZ + 0.06} color={glow} count={Math.round(frame.h * 1.6)} vertical />
          <LedStrip from={0.6} to={frame.h - frame.parapet - 0.4} y={0} x={frame.w / 2 - 0.05} z={frame.faceZ + 0.06} color={glow} count={Math.round(frame.h * 1.6)} vertical />
        </group>
      )}
      {lod < 2 && (isVenue || cfg.awning) && (
        <Canopy position={[0, 4.35, frame.faceZ + 1.5]} width={DOOR_W + (isVenue ? 6 : 3)} depth={3} color={brand.primary} lod={lod} underside={cfg.accentLights ? brand.accent : undefined} />
      )}
      {lod === 0 && <OpenSign merchant={merchant} position={[-(DOOR_W / 2 + 1.1), 3.4, frame.faceZ + (display === "none" ? 0.12 : 0.95)]} width={0.6} />}
      {lod === 0 && <Logo merchant={merchant} position={[isVenue ? -(signW / 2 + 1.5) : -frame.w * 0.2 - signW / 2 - 1.3, signY, frame.faceZ + 0.1]} size={1.5} />}
      {/* Rooftop mark: a lit cube with the logo on the street-facing side. */}
      {lod < 2 && (
        <group position={[frame.w / 2 - 1.6, frame.h + 1.0, frame.cz + frame.d / 2 - 1.4]}>
          <mesh geometry={GEO.box} material={tinted(brand.primary, { roughness: 0.6 })} scale={[1.9, 1.9, 1.0]} castShadow />
          <Logo merchant={merchant} position={[0, 0, 0.52]} size={1.5} />
          <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[0, -1.2, 0]} scale={[0.08, 0.6, 0.08]} />
        </group>
      )}
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
