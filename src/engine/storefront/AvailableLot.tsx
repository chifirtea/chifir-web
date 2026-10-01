"use client";

import { useMemo } from "react";
import type { CityEvent, Merchant, Parcel } from "@/types/domain";
import type { AABB } from "@/engine/physics/types";
import type { Hotspot } from "@/engine/interaction/hotspots";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { useCityStore } from "@/city/cityStore";
import { eventPhase, formatLaunchTime } from "@/lib/events/status";
import { now } from "@/lib/time/clock";
import { GEO, ImageBanner, LedStrip, MAT, PosterPlane, localCollider, tinted, useMaxTextureSize, useQualityTier, useTextureMaterial } from "./templates/parts";
import { localToWorld } from "./types";
import { glowColor, makeLabelTexture } from "./signage";

/**
 * An unoccupied parcel: a low stone platform with a soft sodium edge glow and a small standing
 * sign. Quiet on purpose; it reads as real estate waiting for a tenant, not an error. When an
 * event is booked on the lot (a pop-up before its window opens) the lot wears the brand's
 * hoarding instead: hero image, title, "opens at 8:00 PM", LED-lit.
 */

const SODIUM = "#ffc46b";
const INK = "#1a1d24";
const FOG = "#e9e6df";

function signLocal(parcel: Parcel): { x: number; z: number } {
  return { x: 0, z: parcel.size.depth / 2 - 1.3 };
}

/** Where the hoarding stands: a little behind the sign line, spanning most of the frontage. */
function hoardingLocal(parcel: Parcel): { x: number; z: number; width: number } {
  return { x: 0, z: parcel.size.depth / 2 - 2.6, width: Math.max(6, parcel.size.width * 0.72) };
}

export function availableLotColliders(parcel: Parcel, event?: CityEvent): AABB[] {
  const out = [localCollider(parcel, "lotsign", signLocal(parcel), 0.4, 0.4)];
  if (event) {
    const h = hoardingLocal(parcel);
    out.push(localCollider(parcel, "hoarding", { x: h.x, z: h.z }, h.width + 0.4, 0.5));
  }
  return out;
}

/** "Northline Supply pop-up opens at 8:00 PM" when a brand has booked the lot. */
export function availableLotLabel(parcel: Parcel, event?: CityEvent, merchant?: Merchant, at: number = now()): string {
  if (event) {
    const who = merchant ? `${merchant.name} pop-up` : event.title;
    const phase = eventPhase(event, at);
    if (phase === "live") return `${who} is open now`;
    if (phase === "scheduled") return `${who} opens at ${formatLaunchTime(event.startsAt, at)}`;
  }
  return parcel.status === "reserved" ? "This lot is reserved" : "This lot is available";
}

export function availableLotHotspot(parcel: Parcel, event?: CityEvent, merchant?: Merchant): Hotspot {
  const s = signLocal(parcel);
  const p = localToWorld(parcel, { x: s.x, z: s.z + 1.6 });
  return {
    id: `lot:${parcel.id}`,
    kind: event ? "event" : "info",
    label: availableLotLabel(parcel, event, merchant),
    x: p.x,
    z: p.z,
    radius: event ? 3 : 2.2,
    payload: event ? { eventId: event.id, ...(merchant ? { merchantId: merchant.id } : {}) } : {},
  };
}

export function AvailableLot({ parcel }: { parcel: Parcel }) {
  const maxTex = useMaxTextureSize();
  const quality = useQualityTier();
  const index = useCityStore((s) => s.index);
  const event = index?.eventByParcel[parcel.id];
  const merchant = event?.merchantId ? index?.merchantsById[event.merchantId] : undefined;
  const builtAt = index?.builtAt ?? 0;
  const w = parcel.size.width - 1.6;
  const d = parcel.size.depth - 1.6;
  const reserved = parcel.status === "reserved";
  const opensAt = useMemo(() => (event ? formatLaunchTime(event.startsAt, Math.max(now(), builtAt)) : ""), [event, builtAt]);
  const brand = merchant?.brand ?? { primary: INK, secondary: "#2c313c", accent: SODIUM, onPrimary: FOG };
  const texture = useMemo(
    () =>
      makeLabelTexture(event ? "Coming tonight" : reserved ? "Reserved" : "Available", {
        bg: event ? brand.primary : INK,
        fg: event ? glowColor(brand) : reserved ? FOG : SODIUM,
        subtext: event ? `Opens ${opensAt}` : reserved ? "Opening soon" : "Your storefront here",
        accent: event ? brand.accent : SODIUM,
        width: 512,
        height: 256,
        maxTextureSize: maxTex,
      }),
    [event, reserved, maxTex, brand, opensAt],
  );
  const material = useTextureMaterial(texture, 0.7, { roughness: 0.8, side: 2 });
  const edgeColor = event ? glowColor(brand) : SODIUM;
  const edges = useMemo<InstanceTransform[]>(
    () => [
      { x: 0, y: 0.09, z: d / 2 - 0.05, sx: w, sy: 0.02, sz: 0.06 },
      { x: 0, y: 0.09, z: -d / 2 + 0.05, sx: w, sy: 0.02, sz: 0.06 },
      { x: w / 2 - 0.05, y: 0.09, z: 0, sx: 0.06, sy: 0.02, sz: d },
      { x: -w / 2 + 0.05, y: 0.09, z: 0, sx: 0.06, sy: 0.02, sz: d },
    ],
    [w, d],
  );
  const sign = signLocal(parcel);
  const hoarding = hoardingLocal(parcel);
  const panelH = 2.7;
  const panelY = 0.2 + panelH / 2;
  const posts = useMemo<InstanceTransform[]>(() => {
    const n = 4;
    const out: InstanceTransform[] = [];
    for (let i = 0; i < n; i++) {
      const x = hoarding.x - hoarding.width / 2 + (hoarding.width / (n - 1)) * i;
      out.push({ x, y: panelY, z: hoarding.z - 0.08, sx: 0.12, sy: panelH + 0.3, sz: 0.12 });
      // Rear braces.
      out.push({ x, y: panelY * 0.75, z: hoarding.z - 0.7, tiltX: -0.5, sx: 0.06, sy: panelH * 0.9, sz: 0.06 });
    }
    return out;
  }, [hoarding.x, hoarding.width, hoarding.z, panelY]);
  const third = hoarding.width / 3;
  const when = event ? `Opens tonight · ${opensAt}` : "";

  return (
    <group position={[parcel.position.x, 0, parcel.position.z]} rotation={[0, parcel.rotationY, 0]}>
      <mesh geometry={GEO.box} material={tinted("#2b2c33", { roughness: 0.95 })} position={[0, 0.04, 0]} scale={[w, 0.08, d]} receiveShadow />
      <StaticInstances geometry={GEO.box} material={tinted(edgeColor, { emissive: edgeColor, emissiveIntensity: 0.45, roughness: 0.5 })} items={edges} />
      <mesh geometry={GEO.cylinder} material={MAT.darkMetal} position={[sign.x, 1.1, sign.z]} scale={[0.05, 2.2, 0.05]} castShadow />
      <mesh geometry={GEO.plane} material={material} position={[sign.x, 2.05, sign.z + 0.03]} scale={[1.4, 0.7, 1]} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[sign.x, 2.05, sign.z - 0.02]} scale={[1.48, 0.78, 0.04]} />
      {event && merchant && (
        <group>
          <StaticInstances geometry={GEO.box} material={MAT.brushed} items={posts} castShadow />
          {/* Three hoarding panels: brand, hero image, the when. */}
          <PosterPlane
            title={merchant.name}
            subtitle={merchant.tagline}
            eyebrow="Pop-up"
            brand={brand}
            position={[hoarding.x - third, panelY, hoarding.z]}
            width={third - 0.1}
            height={panelH}
            emissive={0.8}
          />
          <ImageBanner
            url={event.heroImageUrl}
            title={event.title}
            eyebrow={merchant.name}
            footer={when}
            brand={brand}
            position={[hoarding.x, panelY, hoarding.z]}
            width={third - 0.1}
            height={panelH}
            emissive={0.85}
            frameColor={null}
          />
          <PosterPlane
            title={event.title}
            eyebrow="Coming tonight"
            footer={when}
            brand={brand}
            position={[hoarding.x + third, panelY, hoarding.z]}
            width={third - 0.1}
            height={panelH}
            emissive={0.8}
          />
          <mesh geometry={GEO.box} material={tinted(brand.secondary, { roughness: 0.6, metalness: 0.3 })} position={[hoarding.x, panelY + panelH / 2 + 0.08, hoarding.z - 0.02]} scale={[hoarding.width + 0.3, 0.14, 0.2]} castShadow />
          <mesh geometry={GEO.box} material={MAT.darkMetal} position={[hoarding.x, 0.1, hoarding.z - 0.02]} scale={[hoarding.width + 0.3, 0.2, 0.2]} />
          <LedStrip from={hoarding.x - hoarding.width / 2} to={hoarding.x + hoarding.width / 2} y={panelY + panelH / 2 + 0.2} z={hoarding.z + 0.08} color={glowColor(brand)} count={Math.round(hoarding.width * 1.6)} />
          {quality === "high" && <pointLight position={[hoarding.x, panelY + panelH / 2 + 0.6, hoarding.z + 1.6]} color={glowColor(brand)} intensity={9} distance={9} decay={2} />}
        </group>
      )}
    </group>
  );
}
