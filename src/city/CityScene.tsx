"use client";

import { Suspense } from "react";
import { useCityStore } from "@/city/cityStore";
import { Ground } from "@/engine/environment/Ground";
import { Lighting } from "@/engine/environment/Lighting";
import { Npcs } from "@/engine/environment/Npcs";
import { Props } from "@/engine/environment/Props";
import { Roads } from "@/engine/environment/Roads";
import { Sky } from "@/engine/environment/Sky";
import { HotspotMarkers } from "@/engine/interaction/HotspotMarker";
import { StorefrontRenderer } from "@/engine/storefront/StorefrontRenderer";
import "@/engine/storefront/templates";
import "@/engine/interior/templates";

/**
 * The street: everything visible while the player is outside. Rendered inside the Canvas by
 * CityApp; unmounted while the player is in an interior.
 */
export function CityScene() {
  const ready = useCityStore((s) => s.index !== null);
  if (!ready) return null;
  return (
    <group>
      <Sky />
      <Lighting />
      <Ground />
      <Roads />
      <Props />
      <Suspense fallback={null}>
        <StorefrontRenderer />
      </Suspense>
      <Npcs />
      <HotspotMarkers scope="street" />
    </group>
  );
}
