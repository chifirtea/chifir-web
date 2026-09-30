"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Merchant, Parcel } from "@/types/domain";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { useQuality } from "@/engine/canvas/qualityStore";
import type { QualitySettings } from "@/engine/canvas/quality";
import { useSceneAtmosphere } from "@/engine/environment/atmosphere";
import type { Hotspot } from "@/engine/interaction/hotspots";
import { useHotspotStore } from "@/engine/interaction/hotspotStore";
import { useColliderStore } from "@/engine/physics/colliderStore";
import { getInteriorTemplate } from "./registry";
import { orderProducts } from "./templates/parts";
import { interiorOriginFor, type InteriorTemplateDef } from "./types";
import "./templates";

/**
 * Renders one merchant's interior at its isolated origin, with its own light rig and a dark
 * backdrop so nothing from the street shows. Owns the interior colliders and hotspots.
 */

const BACKDROP = "#06070b";

export function InteriorRenderer({ merchantId }: { merchantId: string }) {
  const index = useCityStore((s) => s.index);
  const merchant = index?.merchantsById[merchantId];
  const parcel = index?.parcelByMerchant[merchantId];
  if (!index || !merchant || !parcel) return null;
  return <InteriorContent index={index} merchant={merchant} parcel={parcel} />;
}

function InteriorContent({ index, merchant, parcel }: { index: CityIndex; merchant: Merchant; parcel: Parcel }) {
  const quality = useQuality();
  const setColliders = useColliderStore((s) => s.setColliders);
  const clearColliders = useColliderStore((s) => s.clearColliders);
  const setHotspots = useHotspotStore((s) => s.setHotspots);
  const clearHotspots = useHotspotStore((s) => s.clearHotspots);

  const def = getInteriorTemplate(merchant.interiorTemplate);
  const origin = useMemo(() => interiorOriginFor(parcel), [parcel]);
  const products = useMemo(() => orderProducts(index.productsByMerchant[merchant.id] ?? [], def.productSlots.length), [index, merchant.id, def]);
  const employee = index.employeesByMerchant[merchant.id] ?? null;

  useSceneAtmosphere(BACKDROP, { color: BACKDROP, near: 24, far: 70 });

  useEffect(() => {
    setColliders("interior", def.colliders(origin));
    return () => clearColliders("interior");
  }, [def, origin, setColliders, clearColliders]);

  useEffect(() => {
    const hotspots: Hotspot[] = [
      {
        id: `exit:${merchant.id}`,
        kind: "exit",
        label: "Back to the street",
        x: origin.x + def.exit.x,
        z: origin.z + def.exit.z,
        radius: 1.8,
        payload: { merchantId: merchant.id },
      },
    ];
    if (employee) {
      hotspots.push({
        id: `employee:${merchant.id}`,
        kind: "employee",
        label: `Talk to ${employee.name}`,
        x: origin.x + def.employee.x,
        z: origin.z + def.employee.z,
        radius: 2.4,
        payload: { merchantId: merchant.id },
      });
    }
    products.forEach((product, i) => {
      const slot = def.productSlots[i];
      if (!slot) return;
      hotspots.push({
        id: `product:${product.id}`,
        kind: "product",
        label: `Look at ${product.title}`,
        x: origin.x + slot.x,
        z: origin.z + slot.z,
        radius: 1.6,
        payload: { productId: product.id, merchantId: merchant.id },
      });
    });
    setHotspots("interior", hotspots);
    return () => clearHotspots("interior");
  }, [def, origin, merchant.id, employee, products, setHotspots, clearHotspots]);

  const Template = def.Component;
  return (
    <group position={[origin.x, 0, origin.z]}>
      <InteriorRig def={def} quality={quality} />
      <Backdrop />
      <Template merchant={merchant} products={products} employee={employee} quality={quality.tier} />
    </group>
  );
}

/** Ambient + hemisphere + two warm points; shadows only on high. */
function InteriorRig({ def, quality }: { def: InteriorTemplateDef; quality: QualitySettings }) {
  const H = def.room.height;
  const D = def.room.depth;
  return (
    <group>
      <ambientLight color="#ffe9d2" intensity={0.35} />
      <hemisphereLight args={["#ffe2c0", "#2a2420", 0.55]} />
      <pointLight position={[0, H - 0.4, D * 0.15]} color="#ffdcb4" intensity={38} distance={20} decay={2} castShadow={quality.tier === "high"} shadow-mapSize-width={Math.min(1024, quality.shadowMapSize)} shadow-mapSize-height={Math.min(1024, quality.shadowMapSize)} shadow-bias={-0.002} />
      <pointLight position={[0, H - 0.4, -D * 0.3]} color="#ffd2a1" intensity={24} distance={18} decay={2} />
    </group>
  );
}

const backdropMaterial = new THREE.MeshBasicMaterial({ color: BACKDROP, side: THREE.BackSide, fog: false });
const backdropGeometry = new THREE.SphereGeometry(80, 12, 8);

function Backdrop() {
  return <mesh geometry={backdropGeometry} material={backdropMaterial} position={[0, 10, 0]} />;
}
