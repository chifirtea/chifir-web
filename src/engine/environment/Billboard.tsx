"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BrandPalette, Parcel } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { StaticInstances, type InstanceTransform } from "@/engine/environment/StaticInstances";
import { hashString } from "@/engine/environment/prng";
import { GEO, MAT, PosterPlane, tinted } from "@/engine/storefront/templates/parts";
import { eventWhenLabel } from "@/engine/storefront/events";
import { now as clockNow } from "@/lib/time/clock";
import { upcomingEventsAt } from "./eventStage";
import { radialGlowTexture } from "./textures";

/**
 * A billboard parcel: two posts, a dark frame and a lit poster that rotates through the city's
 * live and upcoming events (phase from the clock, never the stored status), each billboard
 * starting at a different one so the skyline never repeats itself. A light sweep crosses the
 * poster now and then. Without events it offers the space.
 */

const CITY_BRAND: BrandPalette = { primary: "#14121a", secondary: "#8B5CF6", accent: "#F0ABFC", onPrimary: "#F5F3FF" };
const CITY_NEUTRAL: BrandPalette = { primary: "#1a1d24", secondary: "#2c313c", accent: "#ffc46b", onPrimary: "#e9e6df" };
const ROTATE_MS = 9000;

export function Billboard({ parcel }: { parcel: Parcel }) {
  const index = useCityStore((s) => s.index);
  const [step, setStep] = useState(0);
  const events = useMemo(() => (index ? upcomingEventsAt(index.snapshot.events, index.builtAt) : []), [index]);
  useEffect(() => {
    if (events.length < 2) return;
    const timer = setInterval(() => setStep((s) => s + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [events.length]);
  const poster = useMemo(() => {
    if (events.length === 0 || !index) {
      return { title: "Your brand here", subtitle: "Billboard campaigns across the city", eyebrow: "Available", brand: CITY_NEUTRAL };
    }
    const event = events[(hashString(parcel.slug) + step) % events.length]!;
    const merchant = event.merchantId ? index.merchantsById[event.merchantId] : undefined;
    const district = event.districtId ? index.districtsById[event.districtId] : undefined;
    const when = eventWhenLabel(event, clockNow());
    return {
      title: event.title,
      subtitle: merchant ? `${when} · ${merchant.name}` : when,
      eyebrow: district?.name ?? "Event Square",
      brand: merchant?.brand ?? CITY_BRAND,
    };
  }, [events, index, parcel.slug, step]);

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
  const sweepMat = useMemo(() => {
    const tex = radialGlowTexture(64);
    return new THREE.MeshBasicMaterial({ map: tex, color: "#ffffff", transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  }, []);
  useEffect(() => () => sweepMat.dispose(), [sweepMat]);
  const sweep = useRef<THREE.Mesh>(null);
  const phase = (hashString(parcel.id) % 1000) / 1000;
  useFrame((state) => {
    const m = sweep.current;
    if (!m) return;
    // A soft highlight drifts across the poster once every ~12 s.
    const t = ((state.clock.elapsedTime / 12 + phase) % 1) * 1.6 - 0.8;
    m.position.x = t * posterW;
    m.visible = Math.abs(t) < 0.7;
  });
  return (
    <group position={[parcel.position.x, 0, parcel.position.z]} rotation={[0, parcel.rotationY, 0]}>
      <StaticInstances geometry={GEO.cylinder} material={MAT.darkMetal} items={posts} castShadow />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, centreY, -0.05]} scale={[posterW + 0.4, posterH + 0.4, 0.3]} castShadow />
      <PosterPlane title={poster.title} subtitle={poster.subtitle} eyebrow={poster.eyebrow} brand={poster.brand} position={[0, centreY, 0.11]} width={posterW} height={posterH} emissive={0.95} />
      <mesh ref={sweep} geometry={GEO.plane} material={sweepMat} position={[0, centreY, 0.13]} scale={[posterH * 1.6, posterH * 1.6, 1]} />
      <mesh geometry={GEO.box} material={MAT.darkMetal} position={[0, centreY + posterH / 2 + 0.35, 0.3]} scale={[posterW, 0.06, 0.7]} />
      <StaticInstances geometry={GEO.box} material={tinted("#fff1d6", { emissive: "#ffd9a0", emissiveIntensity: 1.4, roughness: 0.4 })} items={spots} />
    </group>
  );
}
