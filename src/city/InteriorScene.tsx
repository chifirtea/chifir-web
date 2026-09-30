"use client";

import { Suspense } from "react";
import { HotspotMarkers } from "@/engine/interaction/HotspotMarker";
import { InteriorRenderer } from "@/engine/interior/InteriorRenderer";
import "@/engine/interior/templates";

/** One merchant's interior; rendered by CityApp in place of the street while inside. */
export function InteriorScene({ merchantId }: { merchantId: string }) {
  return (
    <group>
      <Suspense fallback={null}>
        <InteriorRenderer merchantId={merchantId} />
      </Suspense>
      <HotspotMarkers scope="interior" />
    </group>
  );
}
