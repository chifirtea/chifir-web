"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Parcel } from "@/types/domain";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import { productsAtParcel } from "@/city/cityIndex";
import { FACADE_SETBACK } from "@/city/layout";
import { now } from "@/lib/time/clock";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import { eventWhenLabel } from "../events";
import { getCorrugatedMaterial } from "../facade";
import { evenlySpaced, tiledBox } from "../geometry";
import { glowColor, mixHex } from "../signage";
import {
  Door,
  GEO,
  ImageBanner,
  LedStrip,
  Logo,
  MAT,
  SignPlane,
  WindowCard,
  frameCollider,
  localCollider,
  signText,
  tinted,
  useMaxTextureSize,
  type Frame,
} from "./parts";

/**
 * Pop-up: the temporary structure an event's brand rents for one night. A shipping container in
 * the brand colour (corrugated steel, corner castings, a cut-in glazed door) sits at the back of
 * the lot; a scaffold truss carries a fabric roof, LED strips and the event's hero banner over a
 * forecourt where the collection stands on crates. Reads the event from the city index.
 */

const TRUSS_D_MAX = 4;
const CONTAINER_D = 3.2;
const CONTAINER_H = 2.9;
const DOOR_W = 1.6;

interface PopupFrame extends Frame {
  /** Depth of the truss forecourt in front of the container. */
  trussD: number;
}

function popupFrame(parcel: Parcel): PopupFrame {
  const w = Math.max(5, Math.min(12.2, parcel.size.width - 5));
  const trussD = Math.max(0.8, Math.min(TRUSS_D_MAX, parcel.size.depth - FACADE_SETBACK - CONTAINER_D - 0.5));
  const faceZ = parcel.size.depth / 2 - FACADE_SETBACK - trussD;
  const cz = faceZ - CONTAINER_D / 2;
  return { w, d: CONTAINER_D, h: CONTAINER_H, cz, faceZ, floorH: CONTAINER_H, floors: 1, parapet: 0, trussD };
}

function postSpots(frame: PopupFrame): Array<{ x: number; z: number }> {
  const hx = frame.w / 2 + 0.3;
  return [
    { x: -hx, z: frame.faceZ + frame.trussD - 0.25 },
    { x: hx, z: frame.faceZ + frame.trussD - 0.25 },
    { x: -hx, z: frame.faceZ + 0.3 },
    { x: hx, z: frame.faceZ + 0.3 },
  ];
}

function crateSpots(frame: PopupFrame): Array<{ x: number; z: number }> {
  if (frame.trussD < 2.2) return [];
  const z = frame.faceZ + frame.trussD * 0.55;
  const n = frame.w > 9 ? 4 : 2;
  const xs = evenlySpaced(-frame.w / 2 + 1.4, frame.w / 2 - 1.4, n).filter((x) => Math.abs(x) > DOOR_W / 2 + 0.9);
  return xs.map((x) => ({ x, z }));
}

function PopupComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const maxTex = useMaxTextureSize();
  const frame = useMemo(() => popupFrame(parcel), [parcel]);
  const index = useCityStore((s) => s.index);
  const event = index?.eventByParcel[parcel.id];
  const builtAt = index?.builtAt ?? 0;
  const when = useMemo(() => (event ? eventWhenLabel(event, Math.max(now(), builtAt)) : ""), [event, builtAt]);
  const collection = useMemo(() => (index ? productsAtParcel(index, parcel) : []), [index, parcel]);
  const crates = useMemo(() => crateSpots(frame), [frame]);
  const shownCrates = quality === "low" ? crates.slice(0, 2) : crates;
  const steel = getCorrugatedMaterial(brand.primary, maxTex);
  const containerGeo = useMemo(() => tiledBox(frame.w, CONTAINER_H, CONTAINER_D, 2), [frame.w]);
  const glow = glowColor(brand);
  const posts = useMemo(() => postSpots(frame), [frame]);
  const truss = useMemo<InstanceTransform[]>(() => {
    const topY = CONTAINER_H + 0.9;
    const out: InstanceTransform[] = posts.map((p) => ({ x: p.x, y: topY / 2, z: p.z, sx: 0.12, sy: topY, sz: 0.12 }));
    const frontZ = frame.faceZ + frame.trussD - 0.25;
    const backZ = frame.faceZ + 0.3;
    // Top beams: front, back and two sides, plus diagonal braces on the side bays.
    out.push({ x: 0, y: topY, z: frontZ, sx: frame.w + 0.72, sy: 0.12, sz: 0.12 });
    out.push({ x: 0, y: topY, z: backZ, sx: frame.w + 0.72, sy: 0.12, sz: 0.12 });
    for (const s of [-1, 1]) {
      out.push({ x: s * (frame.w / 2 + 0.3), y: topY, z: (frontZ + backZ) / 2, sx: 0.12, sy: 0.12, sz: frontZ - backZ });
      const len = Math.hypot(frontZ - backZ, topY * 0.5);
      out.push({ x: s * (frame.w / 2 + 0.3), y: topY * 0.75, z: (frontZ + backZ) / 2, tiltX: Math.atan2(frontZ - backZ, topY * 0.5), sx: 0.06, sy: len, sz: 0.06 });
    }
    // Cross members under the roof.
    const n = Math.max(2, Math.round(frame.w / 2.4));
    for (const x of evenlySpaced(-frame.w / 2 + 0.6, frame.w / 2 - 0.6, n)) out.push({ x, y: topY - 0.08, z: (frontZ + backZ) / 2, sx: 0.06, sy: 0.06, sz: frontZ - backZ });
    return out;
  }, [posts, frame]);
  const castings = useMemo<InstanceTransform[]>(
    () =>
      [-1, 1].flatMap((sx) =>
        [-1, 1].flatMap((sz) =>
          [0.14, CONTAINER_H - 0.14].map((y) => ({ x: sx * (frame.w / 2 - 0.12), y, z: frame.cz + sz * (CONTAINER_D / 2 - 0.12), sx: 0.3, sy: 0.3, sz: 0.3 })),
        ),
      ),
    [frame],
  );
  const ribsTop = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: CONTAINER_H + 0.04, z: frame.cz, sx: frame.w + 0.04, sy: 0.08, sz: CONTAINER_D + 0.04 },
      { x: 0, y: 0.1, z: frame.cz, sx: frame.w + 0.06, sy: 0.2, sz: CONTAINER_D + 0.06 },
    ],
    [frame],
  );
  const roofY = CONTAINER_H + 0.98;
  const roofW = frame.w + 0.9;
  const roofD = frame.trussD - 0.4;
  const roofZ = frame.faceZ + frame.trussD / 2 + 0.03;
  const bannerW = Math.min(frame.w - 0.4, 10);
  const bannerH = Math.min(1.9, bannerW * 0.26);
  const fabric = useMemo(() => new THREE.MeshStandardMaterial({ color: mixHex(brand.primary, "#ffffff", 0.08), roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }), [brand.primary]);
  const floorStrips = useMemo<InstanceTransform[]>(
    () => [-1, 1].map((s) => ({ x: s * (frame.w / 2 + 0.1), y: 0.03, z: frame.faceZ + frame.trussD / 2, sx: 0.06, sy: 0.03, sz: frame.trussD - 0.4 })),
    [frame],
  );

  return (
    <group>
      {/* Container */}
      <mesh geometry={containerGeo} material={steel} position={[0, CONTAINER_H / 2, frame.cz]} scale={[frame.w, CONTAINER_H, CONTAINER_D]} castShadow receiveShadow />
      <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={ribsTop} />
      {lod < 2 && <StaticInstances geometry={GEO.box} material={MAT.darkMetal} items={castings} />}
      {/* Container end doors (hinged leaves on the left end) */}
      {lod < 2 && (
        <group position={[-frame.w / 2 - 0.02, CONTAINER_H / 2, frame.cz]}>
          <mesh geometry={GEO.box} material={MAT.darkMetal} scale={[0.04, CONTAINER_H - 0.3, CONTAINER_D - 0.3]} />
          <mesh geometry={GEO.box} material={MAT.brushed} position={[-0.03, 0, 0]} scale={[0.03, CONTAINER_H - 0.6, 0.08]} />
        </group>
      )}
      {/* Door cut into the front wall, and the sign over it */}
      {lod < 2 && <Door frame={frame} x={0} width={DOOR_W} height={2.3} brand={brand} lod={lod} frameColor={brand.secondary} matLabel={merchant.name} />}
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, CONTAINER_H - 0.42, frame.faceZ + 0.08]} width={Math.min(frame.w * 0.5, 4.2)} aspect={6} backing={false} />
      {lod < 2 && <Logo merchant={merchant} position={[frame.w / 2 - 1.1, CONTAINER_H * 0.55, frame.faceZ + 0.06]} size={1.1} />}
      {/* Hero banner across the container front, left of the door */}
      {lod < 2 && event && (
        <ImageBanner
          url={event.heroImageUrl}
          title={event.title}
          eyebrow={merchant.name}
          footer={when}
          brand={brand}
          position={[-(DOOR_W / 2 + 0.5) - Math.min(3.6, frame.w / 2 - DOOR_W / 2 - 1.2) / 2, CONTAINER_H * 0.5 + 0.1, frame.faceZ + 0.06]}
          width={Math.min(3.6, frame.w / 2 - DOOR_W / 2 - 1.2)}
          height={1.6}
          emissive={0.8}
          frameColor={null}
        />
      )}
      {/* Truss, fabric roof, LED strips and the big drop banner */}
      <StaticInstances geometry={GEO.box} material={MAT.brushed} items={truss} castShadow />
      <mesh geometry={GEO.box} material={fabric} position={[0, roofY, roofZ]} scale={[roofW, 0.04, roofD]} castShadow />
      {lod < 2 && (
        <ImageBanner
          url={event?.heroImageUrl}
          title={event?.title ?? `${merchant.name} pop-up`}
          eyebrow={merchant.name}
          footer={when || undefined}
          brand={brand}
          position={[0, roofY + bannerH / 2 + 0.15, frame.faceZ + frame.trussD - 0.2]}
          width={bannerW}
          height={bannerH}
          emissive={0.95}
          frameColor={brand.secondary}
          caption
        />
      )}
      {lod < 2 && (
        <group>
          <LedStrip from={-frame.w / 2 - 0.3} to={frame.w / 2 + 0.3} y={roofY - 0.1} z={frame.faceZ + frame.trussD - 0.25} color={glow} count={Math.round(frame.w * 1.8)} />
          <LedStrip from={-frame.w / 2 - 0.3} to={frame.w / 2 + 0.3} y={roofY - 0.1} z={frame.faceZ + 0.3} color={glow} count={Math.round(frame.w * 1.8)} />
          <LedStrip from={0.2} to={CONTAINER_H + 0.7} y={0} x={-frame.w / 2 - 0.3} z={frame.faceZ + frame.trussD - 0.25} color={glow} count={8} vertical />
          <LedStrip from={0.2} to={CONTAINER_H + 0.7} y={0} x={frame.w / 2 + 0.3} z={frame.faceZ + frame.trussD - 0.25} color={glow} count={8} vertical />
          <StaticInstances geometry={GEO.box} material={tinted(glow, { emissive: glow, emissiveIntensity: 1.6, roughness: 0.4 })} items={floorStrips} />
        </group>
      )}
      {quality === "high" && lod === 0 && <pointLight position={[0, roofY - 0.4, frame.faceZ + frame.trussD / 2]} color={glow} intensity={10} distance={9} decay={2} />}
      {/* The collection on crates in the forecourt */}
      {lod <= 1 &&
        shownCrates.map((spot, i) => {
          const product = collection[i];
          return (
            <group key={`${spot.x}|${spot.z}`} position={[spot.x, 0, spot.z]} rotation={[0, (i % 2 === 0 ? -1 : 1) * 0.18, 0]}>
              <mesh geometry={GEO.box} material={tinted(mixHex(brand.secondary, "#2b2b2f", 0.55), { roughness: 0.9 })} position={[0, 0.4, 0]} scale={[0.9, 0.8, 0.9]} castShadow receiveShadow />
              <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.75 })} position={[0, 0.82, 0]} scale={[0.96, 0.04, 0.96]} />
              {product && <WindowCard product={product} brand={brand} position={[0, 0.84, 0.05]} size={0.62} lean={-0.08} />}
            </group>
          );
        })}
    </group>
  );
}

export const popupTemplate: StorefrontTemplateDef = {
  id: "popup",
  label: "Pop-up",
  suitableFor: ["retail", "popup", "service", "venue"],
  suitableTiers: ["standard", "corner", "kiosk"],
  lodDistances: [45, 110],
  footprint: (parcel) => {
    const frame = popupFrame(parcel);
    return { width: frame.w + 0.9, depth: CONTAINER_D + frame.trussD, height: CONTAINER_H + 1.0 };
  },
  doorOffset: (parcel) => ({ x: 0, z: popupFrame(parcel).faceZ }),
  colliders: (parcel) => {
    const frame = popupFrame(parcel);
    return [
      frameCollider(parcel, frame),
      ...postSpots(frame).map((p, i) => localCollider(parcel, `post${i}`, p, 0.3, 0.3)),
      ...crateSpots(frame).map((p, i) => localCollider(parcel, `crate${i}`, p, 1.0, 1.0)),
    ];
  },
  Component: PopupComponent,
};
