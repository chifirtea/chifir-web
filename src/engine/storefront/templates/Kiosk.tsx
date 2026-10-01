"use client";

import { useMemo } from "react";
import type { Parcel } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import type { StorefrontTemplateDef, StorefrontTemplateProps } from "../types";
import {
  AccentStrip,
  Canopy,
  GEO,
  Logo,
  MAT,
  MenuBoard,
  OpenSign,
  SignPlane,
  StringLights,
  WindowCard,
  buildingFrame,
  frameCollider,
  frameFootprint,
  localCollider,
  signText,
  tinted,
  useMaxTextureSize,
  type Frame,
} from "./parts";
import { getFacadeMaterial } from "../facade";

/**
 * Kiosk: an open pavilion. A counter in the brand's secondary colour under a wide canopy on four
 * posts, the back wall in the façade material carrying a menu board and logo, a fascia sign, the
 * real products standing on the counter and a run of bulbs under the canopy edge.
 */

const SPEC = { side: 1.0, front: 1.5, back: 0.5, floors: 1, floorHeight: 2.6, parapet: 0.1 };
const CANOPY_Y = 2.75;
const OVERHANG = 0.7;

function frameFor(parcel: Parcel): Frame {
  return buildingFrame(parcel, SPEC);
}

function postSpots(frame: Frame): Array<{ x: number; z: number }> {
  const hx = frame.w / 2 + OVERHANG - 0.2;
  const front = frame.cz + frame.d / 2 + OVERHANG - 0.2;
  const back = frame.cz - frame.d / 2 - OVERHANG + 0.2;
  return [
    { x: -hx, z: front },
    { x: hx, z: front },
    { x: -hx, z: back },
    { x: hx, z: back },
  ];
}

function KioskComponent({ merchant, parcel, quality, lod }: StorefrontTemplateProps) {
  const cfg = merchant.storefrontConfig;
  const brand = merchant.brand;
  const maxTex = useMaxTextureSize();
  const frame = useMemo(() => frameFor(parcel), [parcel]);
  const facade = getFacadeMaterial(cfg.facade, brand, maxTex);
  const posts = useMemo(() => postSpots(frame), [frame]);
  const products = useCityStore((s) => s.index?.productsByMerchant[merchant.id]);
  const goods = useMemo(() => {
    if (cfg.windowDisplay !== "products" || !products) return [];
    const list = [...products].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder);
    return list.slice(0, quality === "low" ? 1 : 3);
  }, [cfg.windowDisplay, products, quality]);
  const counterH = 1.05;
  const backZ = frame.cz - frame.d / 2 + 0.18;
  const frontZ = frame.cz + frame.d / 2;
  const canopyW = frame.w + OVERHANG * 2;
  const canopyD = frame.d + OVERHANG * 2;

  return (
    <group>
      <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.7 })} position={[0, counterH / 2, frame.cz]} scale={[frame.w, counterH, frame.d]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={tinted("#c9a27a", { roughness: 0.6 })} position={[0, counterH + 0.03, frame.cz]} scale={[frame.w + 0.12, 0.06, frame.d + 0.12]} />
      <mesh geometry={GEO.box} material={facade} position={[0, counterH + 0.85, backZ]} scale={[frame.w, 1.7, 0.36]} castShadow />
      {lod < 2 &&
        [-1, 1].map((s) => (
          <mesh key={s} geometry={GEO.box} material={facade} position={[s * (frame.w / 2 - 0.1), counterH + 0.85, frame.cz - frame.d * 0.2]} scale={[0.2, 1.7, frame.d * 0.6]} />
        ))}
      <Canopy position={[0, CANOPY_Y, frame.cz]} width={canopyW} depth={canopyD} color={brand.primary} lod={lod} posts={posts} underside={cfg.accentLights ? brand.accent : undefined} />
      <SignPlane text={signText(merchant)} style={cfg.signStyle} brand={brand} position={[0, CANOPY_Y - 0.05, frame.cz + canopyD / 2 + 0.08]} width={Math.min(frame.w * 0.85, 5.2)} aspect={6} />
      {lod < 2 && cfg.accentLights && (
        <AccentStrip brand={brand} quality={quality} lod={lod} position={[0, counterH - 0.12, frontZ + 0.05]} width={frame.w * 0.9} height={0.06} intensity={1.4} light />
      )}
      {lod === 0 && <StringLights from={-canopyW / 2 + 0.3} to={canopyW / 2 - 0.3} y={CANOPY_Y - 0.2} z={frame.cz + canopyD / 2 - 0.2} count={Math.round(canopyW / 0.55)} sag={0.08} />}
      {lod === 0 && cfg.windowDisplay === "menu" && <MenuBoard merchant={merchant} position={[frame.w * 0.22, counterH + 0.95, backZ + 0.19]} lod={lod} width={0.75} />}
      {lod <= 1 &&
        goods.map((product, i) => (
          <WindowCard key={product.id} product={product} brand={brand} position={[-frame.w * 0.3 + i * frame.w * 0.3, counterH + 0.06, frame.cz + 0.3]} size={0.5} />
        ))}
      {lod === 0 && <OpenSign merchant={merchant} position={[frame.w / 2 - 0.5, CANOPY_Y - 0.45, frame.cz + canopyD / 2 - 0.3]} width={0.45} />}
      {lod === 0 && <Logo merchant={merchant} position={[-frame.w * 0.24, counterH + 0.95, backZ + 0.19]} size={0.7} />}
      {lod < 2 && <mesh geometry={GEO.box} material={MAT.step} position={[0, 0.04, frontZ + 0.5]} scale={[frame.w, 0.08, 1.0]} receiveShadow />}
    </group>
  );
}

export const kioskTemplate: StorefrontTemplateDef = {
  id: "kiosk",
  label: "Kiosk",
  suitableFor: ["popup", "retail", "restaurant", "service"],
  suitableTiers: ["kiosk"],
  lodDistances: [35, 90],
  footprint: (parcel) => {
    const fp = frameFootprint(frameFor(parcel));
    return { ...fp, height: CANOPY_Y + 0.1 };
  },
  doorOffset: (parcel) => {
    const frame = frameFor(parcel);
    return { x: 0, z: frame.cz + frame.d / 2 };
  },
  colliders: (parcel) => {
    const frame = frameFor(parcel);
    return [frameCollider(parcel, frame), ...postSpots(frame).map((p, i) => localCollider(parcel, `post${i}`, p, 0.25, 0.25))];
  },
  Component: KioskComponent,
};
