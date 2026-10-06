"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from "three";
import { useCityStore } from "@/city/cityStore";
import { getStorefrontTemplate } from "@/engine/storefront/registry";
import { doorPose } from "@/engine/storefront/types";
import { useWorldStore } from "@/engine/store/worldStore";

/** How long a highlight stays up if the player neither enters nor asks for another. */
export const HIGHLIGHT_TTL_MS = 20_000;
const BEACON_HEIGHT = 18;
const BEACON_WIDTH = 1.6;

interface Shared {
  ring: RingGeometry;
  beacon: PlaneGeometry;
}

let shared: Shared | null = null;

/** Geometry is shared across mounts; only materials (colour, opacity) are per highlight. */
function getShared(): Shared {
  if (shared) return shared;
  const beacon = new PlaneGeometry(BEACON_WIDTH, BEACON_HEIGHT, 1, 1);
  beacon.translate(0, BEACON_HEIGHT / 2, 0);
  shared = { ring: new RingGeometry(1.1, 1.45, 48), beacon };
  return shared;
}

/**
 * In-world highlight for a storefront the AI (or a party member) points at: a pulsing ring on
 * the ground and a vertical additive beacon at the parcel's door, in the merchant's accent
 * colour. One ring mesh + one plane; the frame loop only mutates scale, opacity and yaw.
 * Clears itself after `HIGHLIGHT_TTL_MS` or the moment the player enters that parcel.
 */
export function HighlightLayer() {
  const parcelId = useWorldStore((s) => s.highlightedParcelId);
  const setHighlightedParcel = useWorldStore((s) => s.setHighlightedParcel);
  const location = useWorldStore((s) => s.location);
  const index = useCityStore((s) => s.index);
  const ring = useRef<Mesh>(null);
  const beacon = useRef<Mesh>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const beaconMat = useRef<MeshBasicMaterial>(null);

  const target = useMemo(() => {
    if (!parcelId || !index) return null;
    const parcel = index.parcelsById[parcelId];
    const merchant = parcel?.merchantId ? index.merchantsById[parcel.merchantId] : undefined;
    if (!parcel || !merchant) return null;
    const def = getStorefrontTemplate(parcel.storefrontTemplate ?? merchant.storefrontTemplate);
    const pose = doorPose(parcel, def);
    return { x: pose.x, z: pose.z, color: merchant.brand.accent };
  }, [parcelId, index]);

  // Auto-clear: a highlight is a hint, not a permanent marker.
  useEffect(() => {
    if (!parcelId) return;
    const t = setTimeout(() => setHighlightedParcel(null), HIGHLIGHT_TTL_MS);
    return () => clearTimeout(t);
  }, [parcelId, setHighlightedParcel]);

  // The player arrived: the door they were looking for is the one they walked through.
  useEffect(() => {
    if (parcelId && location.kind === "interior" && location.parcelId === parcelId) {
      setHighlightedParcel(null);
    }
  }, [parcelId, location, setHighlightedParcel]);

  useFrame((state) => {
    if (!target) return;
    const t = state.clock.elapsedTime;
    const pulse = Math.sin(t * 2.6);
    if (ring.current) {
      const k = 1 + 0.12 * pulse;
      ring.current.scale.set(k, k, 1);
    }
    if (ringMat.current) ringMat.current.opacity = 0.6 + 0.3 * pulse;
    if (beaconMat.current) beaconMat.current.opacity = 0.22 + 0.08 * Math.sin(t * 1.7);
    if (beacon.current) {
      // Face the camera around Y so the plane never shows its edge (no allocation).
      const cam = state.camera.position;
      beacon.current.rotation.y = Math.atan2(cam.x - target.x, cam.z - target.z);
    }
  });

  if (!target || location.kind !== "street") return null;
  const s = getShared();

  return (
    <group position={[target.x, 0, target.z]}>
      <mesh ref={ring} geometry={s.ring} rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}>
        <meshBasicMaterial
          ref={ringMat}
          color={target.color}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={beacon} geometry={s.beacon}>
        <meshBasicMaterial
          ref={beaconMat}
          color={target.color}
          transparent
          opacity={0.25}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
