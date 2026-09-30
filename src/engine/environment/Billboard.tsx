"use client";

import { useMemo } from "react";
import type { BrandPalette, Parcel } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { hashString } from "@/engine/environment/prng";
import { GEO, MAT, PosterPlane, tinted } from "@/engine/storefront/templates/parts";
import { eventTimeLabel, upcomingEvents } from "@/engine/storefront/events";

/**
 * A billboard parcel: two posts, a dark frame and a lit poster for the next upcoming event
 * (several billboards rotate through the schedule). Without events it offers the space.
 */

const CITY_BRAND: BrandPalette = { primary: "#14121a", secondary: "#8B5CF6", accent: "#F0ABFC", onPrimary: "#F5F3FF" };
const CITY_NEUTRAL: BrandPalette = { primary: "#1a1d24", secondary: "#2c313c", accent: "#ffc46b", onPrimary: "#e9e6df" };

export function Billboard({ parcel }: { parcel: Parcel }) {
  const index = useCityStore((s) => s.index);
  const poster = useMemo(() => {
    const events = index ? upcomingEvents(index.snapshot.events) : [];
    if (events.length === 0) {
      return { title: "Your brand here", subtitle: "Billboard campaigns across the city", eyebrow: "Available", brand: CITY_NEUTRAL };
    }
    const event = events[hashString(parcel.slug) % events.length]!;
    const merchant = event.merchantId && index ? index.merchantsById[event.merchantId] : undefined;
    const district = event.districtId && index ? index.districtsById[event.districtId] : undefined;
    return {
      title: event.title,
      subtitle: merchant ? `${eventTimeLabel(event)} · ${merchant.name}` : eventTimeLabel(event),
      eyebrow: district?.name ?? "Event Square",
      brand: merchant?.brand ?? CITY_BRAND,
    };
  }, [index, parcel.slug]);

  const w = parcel.size.width;
  const posterW = w - 2;
  const posterH = posterW * 0.4;
  const baseY = 3.4;
  const centreY = baseY + posterH / 2;
  const posts = useMemo<InstanceTransform[]>(
    () => [
      { x: -w * 0.36, y: baseY / 2, z: 0, sx: 0.16, sy: baseY, sz: 0.16 },
      { x: w * 0.36, y: baseY / 2, z: 0, sx: 0.16, sy: baseY, sz: 0.16 },
    ],
    [w],
  );
  const spots = useMemo<InstanceTransform[]>(
    () => [-1, 0, 1].map((i) => ({ x: i * posterW * 0.32, y: centreY + posterH / 2 + 0.35, z: 0.55, sx: 0.22, sy: 0.16, sz: 0.3 })),
    [posterW, centreY, posterH],
  );
  return (
    <group position={[parcel.position.x, 0, parcel.position.z]} rotation={[0, parcel.rotationY, 0]}>
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={posts} castShadow />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, centreY, -0.05]} scale={[posterW + 0.4, posterH + 0.4, 0.3]} castShadow />
      <PosterPlane title={poster.title} subtitle={poster.subtitle} eyebrow={poster.eyebrow} brand={poster.brand} position={[0, centreY, 0.11]} width={posterW} height={posterH} emissive={0.95} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, centreY + posterH / 2 + 0.35, 0.3]} scale={[posterW, 0.06, 0.7]} />
      <StaticInstances geometry={GEO.box} material={tinted("#fff1d6", { emissive: "#ffd9a0", emissiveIntensity: 1.4, roughness: 0.4 })} items={spots} />
    </group>
  );
}
