"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Merchant, Parcel } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import { getStreetLayout } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import type { Hotspot } from "@/engine/interaction/hotspots";
import { useHotspotStore } from "@/engine/interaction/hotspotStore";
import { useColliderStore } from "@/engine/physics/colliderStore";
import { playerRig } from "@/engine/player/playerRig";
import { Billboard } from "@/engine/environment/Billboard";
import { AvailableLot, availableLotColliders, availableLotHotspot } from "./AvailableLot";
import { eventHotspotLabel, nextEventFor } from "./events";
import { getStorefrontTemplate } from "./registry";
import { doorPose, localToWorld, type StorefrontTemplateDef } from "./types";
import "./templates";

/**
 * Draws every occupied parcel with its merchant's template, every empty parcel as an available
 * lot and every billboard parcel as a billboard. Owns the street's colliders and hotspots.
 * LOD is re-evaluated four times a second from the player rig and stored per parcel.
 */

type Lod = 0 | 1 | 2;

interface Entry {
  merchant: Merchant;
  parcel: Parcel;
  def: StorefrontTemplateDef;
}

const LOD_INTERVAL = 0.25;

export function StorefrontRenderer() {
  const index = useCityStore((s) => s.index);
  const quality = useQuality();
  const setColliders = useColliderStore((s) => s.setColliders);
  const clearColliders = useColliderStore((s) => s.clearColliders);
  const setHotspots = useHotspotStore((s) => s.setHotspots);
  const clearHotspots = useHotspotStore((s) => s.clearHotspots);

  // One entry per parcel occupied right now: permanent storefronts and live pop-ups alike. A
  // parcel may request its own structure (a pop-up shell) instead of the tenant's default.
  const entries = useMemo<Entry[]>(() => {
    if (!index) return [];
    const out: Entry[] = [];
    for (const parcel of index.occupiedParcels) {
      const merchant = parcel.merchantId ? index.merchantsById[parcel.merchantId] : undefined;
      if (!merchant) continue;
      out.push({
        merchant,
        parcel,
        def: getStorefrontTemplate(parcel.storefrontTemplate ?? merchant.storefrontTemplate),
      });
    }
    return out.sort((a, b) => a.parcel.slug.localeCompare(b.parcel.slug));
  }, [index]);

  const lots = useMemo<Parcel[]>(() => {
    if (!index) return [];
    const used = new Set(entries.map((e) => e.parcel.id));
    return index.snapshot.parcels.filter((p) => p.tier !== "billboard" && !used.has(p.id));
  }, [index, entries]);

  const billboards = useMemo<Parcel[]>(
    () => (index ? index.snapshot.parcels.filter((p) => p.tier === "billboard") : []),
    [index],
  );
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);

  // Colliders: templates + lot signs + environment furniture.
  useEffect(() => {
    if (!layout) return;
    setColliders("street", [
      ...entries.flatMap((e) => e.def.colliders(e.parcel)),
      ...lots.flatMap((p) => availableLotColliders(p)),
      ...layout.environmentColliders,
    ]);
    return () => clearColliders("street");
  }, [entries, lots, layout, setColliders, clearColliders]);

  // Hotspots: a door per merchant, an info point per lot, an event point per venue with a show.
  useEffect(() => {
    if (!index) return;
    const hotspots: Hotspot[] = [];
    for (const { merchant, parcel, def } of entries) {
      const pose = doorPose(parcel, def);
      const event = index.eventByParcel[parcel.id];
      const isPopup = parcel.id !== index.parcelByMerchant[merchant.id]?.id;
      hotspots.push({
        id: `door:${parcel.id}`,
        kind: "door",
        label: isPopup && event ? `Enter the ${merchant.name} pop-up` : `Enter ${merchant.name}`,
        x: pose.x,
        z: pose.z,
        radius: 2.4,
        payload: {
          merchantId: merchant.id,
          parcelId: parcel.id,
          ...(isPopup && event ? { eventId: event.id } : {}),
        },
      });
      if (merchant.merchantType === "venue") {
        const event = nextEventFor(index.snapshot.events, merchant.id, parcel.id);
        if (event) {
          const door = def.doorOffset(parcel);
          const p = localToWorld(parcel, { x: door.x + 5, z: door.z + 3 });
          hotspots.push({
            id: `event:${event.id}`,
            kind: "event",
            label: eventHotspotLabel(event, merchant.name),
            x: p.x,
            z: p.z,
            radius: 3,
            payload: { eventId: event.id, merchantId: merchant.id },
          });
        }
      }
    }
    for (const parcel of lots) hotspots.push(availableLotHotspot(parcel));
    setHotspots("street", hotspots);
    return () => clearHotspots("street");
  }, [index, entries, lots, setHotspots, clearHotspots]);

  // LOD per parcel, recomputed every LOD_INTERVAL seconds; state only changes when a value changes.
  const [lods, setLods] = useState<Record<string, Lod>>({});
  const lodsRef = useRef(lods);
  const acc = useRef(LOD_INTERVAL);
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current < LOD_INTERVAL) return;
    acc.current = 0;
    let changed = false;
    const next: Record<string, Lod> = {};
    for (const { parcel, def } of entries) {
      const dist = Math.hypot(playerRig.x - parcel.position.x, playerRig.z - parcel.position.z);
      const [d1, d2] = def.lodDistances;
      const lod: Lod = dist < d1 * quality.lodScale ? 0 : dist < d2 * quality.lodScale ? 1 : 2;
      next[parcel.id] = lod;
      if (lodsRef.current[parcel.id] !== lod) changed = true;
    }
    if (changed || Object.keys(lodsRef.current).length !== entries.length) {
      lodsRef.current = next;
      setLods(next);
    }
  });

  if (!index) return null;
  return (
    <group>
      {entries.map(({ merchant, parcel, def }) => {
        const Template = def.Component;
        return (
          <group
            key={parcel.id}
            position={[parcel.position.x, 0, parcel.position.z]}
            rotation={[0, parcel.rotationY, 0]}
          >
            <Template
              merchant={merchant}
              parcel={parcel}
              quality={quality.tier}
              lod={lods[parcel.id] ?? 2}
            />
          </group>
        );
      })}
      {lots.map((parcel) => (
        <AvailableLot key={parcel.id} parcel={parcel} />
      ))}
      {billboards.map((parcel) => (
        <Billboard key={parcel.id} parcel={parcel} />
      ))}
    </group>
  );
}
