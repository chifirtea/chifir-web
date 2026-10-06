"use client";

import { Suspense } from "react";
import { HotspotMarkers } from "@/engine/interaction/HotspotMarker";
import { InteriorRenderer } from "@/engine/interior/InteriorRenderer";
import "@/engine/interior/templates";

/** One room (a merchant's store or its pop-up); rendered by CityApp in place of the street while inside. */
export function InteriorScene({ merchantId, parcelId }: { merchantId: string; parcelId: string }) {
  return (
    <group>
      <Suspense fallback={null}>
        <InteriorRenderer merchantId={merchantId} parcelId={parcelId} />
      </Suspense>
      <HotspotMarkers scope="interior" />
    </group>
  );
}
