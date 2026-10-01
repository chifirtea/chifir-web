"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import { useWorldStore } from "@/engine/store/worldStore";

const SODIUM = "#ffc46b";
const BEAM_HEIGHT = 40;
const BEAM_RADIUS = 0.14;
const GLOW_RADIUS = 0.5;

interface Shared {
  beam: CylinderGeometry;
  glow: CylinderGeometry;
  ring: RingGeometry;
}

let shared: Shared | null = null;

function getShared(): Shared {
  if (shared) return shared;
  shared = {
    beam: new CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true),
    glow: new CylinderGeometry(GLOW_RADIUS, GLOW_RADIUS * 0.6, BEAM_HEIGHT, 16, 1, true),
    ring: new RingGeometry(0.8, 1.0, 48),
  };
  return shared;
}

/**
 * Vertical light column plus a pulsing ground ring at the current waypoint. Hidden indoors (the
 * waypoint is a street position). No label: the HUD chevron carries the name and distance.
 */
export function WaypointBeacon() {
  const waypoint = useWorldStore((s) => s.waypoint);
  const interior = useWorldStore((s) => s.location.kind === "interior");
  const ring = useRef<Mesh>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const beamMat = useRef<MeshBasicMaterial>(null);
  const glowMat = useRef<MeshBasicMaterial>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pulse = Math.sin(t * 3);
    if (ring.current) {
      const k = 1 + 0.15 * pulse;
      ring.current.scale.set(k, k, k);
    }
    if (ringMat.current) ringMat.current.opacity = 0.55 + 0.3 * pulse;
    if (beamMat.current) beamMat.current.opacity = 0.32 + 0.08 * Math.sin(t * 2);
    if (glowMat.current) glowMat.current.opacity = 0.07 + 0.03 * Math.sin(t * 2 + 1);
  });

  if (!waypoint || interior) return null;
  const s = getShared();

  return (
    <group position={[waypoint.x, 0, waypoint.z]}>
      <mesh geometry={s.beam} position={[0, BEAM_HEIGHT / 2, 0]}>
        <meshBasicMaterial
          ref={beamMat}
          color={SODIUM}
          transparent
          opacity={0.32}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={s.glow} position={[0, BEAM_HEIGHT / 2, 0]}>
        <meshBasicMaterial
          ref={glowMat}
          color={SODIUM}
          transparent
          opacity={0.07}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ring} geometry={s.ring} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <meshBasicMaterial
          ref={ringMat}
          color={SODIUM}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
