"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CircleGeometry, Group, MeshBasicMaterial, RingGeometry } from "three";
import { useWorldStore } from "@/engine/store/worldStore";
import { useHotspotStore, type HotspotScope } from "./hotspotStore";
import type { Hotspot, HotspotKind } from "./hotspots";

const RING_INNER = 0.5;
const RING_OUTER = 0.62;
/** Just above the pavement to avoid z-fighting. */
const RING_Y = 0.02;
const ACTIVE_SCALE = 1.25;

/** Design tokens, mirrored from globals.css (three materials cannot read CSS variables). */
const TINT: Record<HotspotKind, string> = {
  door: "#ffc46b", // sodium
  product: "#7fe0c1", // mint
  employee: "#7da7ff", // sky
  exit: "#e9e6df", // fog
  event: "#ff5a36", // signal
  info: "#e9e6df", // fog
};

interface Shared {
  ring: RingGeometry;
  disc: CircleGeometry;
  idle: Record<HotspotKind, MeshBasicMaterial>;
  active: Record<HotspotKind, MeshBasicMaterial>;
  discs: Record<HotspotKind, MeshBasicMaterial>;
}

let shared: Shared | null = null;

function unlit(color: string, opacity: number): MeshBasicMaterial {
  // Unlit + not tone mapped so the tint reads as emissive under the night lighting.
  return new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
}

function perKind(build: (kind: HotspotKind) => MeshBasicMaterial): Record<HotspotKind, MeshBasicMaterial> {
  return {
    door: build("door"),
    product: build("product"),
    employee: build("employee"),
    exit: build("exit"),
    event: build("event"),
    info: build("info"),
  };
}

/** Lazily built so importing on the server allocates nothing. */
function getShared(): Shared {
  if (shared) return shared;
  shared = {
    ring: new RingGeometry(RING_INNER, RING_OUTER, 48),
    disc: new CircleGeometry(RING_INNER, 32),
    idle: perKind((k) => unlit(TINT[k], 0.45)),
    active: perKind((k) => unlit(TINT[k], 0.95)),
    discs: perKind((k) => unlit(TINT[k], 0.12)),
  };
  return shared;
}

/** Cheap string hash → phase offset so neighbouring rings do not pulse in lockstep. */
function phaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 0xffff) / 0xffff * Math.PI * 2;
}

/** Ground ring under an interactable. No label: the HUD names it. */
export function HotspotMarker({ hotspot, active }: { hotspot: Hotspot; active: boolean }) {
  const s = getShared();
  const group = useRef<Group>(null);
  const phase = useRef(phaseFor(hotspot.id));

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const pulse = active
      ? 1 + 0.08 * Math.sin(t * 5 + phase.current)
      : 1 + 0.05 * Math.sin(t * 2.5 + phase.current);
    const k = (active ? ACTIVE_SCALE : 1) * pulse;
    g.scale.set(k, k, k);
  });

  return (
    <group ref={group} position={[hotspot.x, RING_Y, hotspot.z]} rotation-x={-Math.PI / 2}>
      <mesh geometry={s.ring} material={active ? s.active[hotspot.kind] : s.idle[hotspot.kind]} />
      {active ? <mesh geometry={s.disc} material={s.discs[hotspot.kind]} /> : null}
    </group>
  );
}

/** Every hotspot registered for a scope, with the world store's active one highlighted. */
export function HotspotMarkers({ scope }: { scope: HotspotScope }) {
  const hotspots = useHotspotStore((s) => s.scopes[scope]);
  const activeId = useWorldStore((s) => s.activeHotspot?.id ?? null);
  return (
    <>
      {hotspots.map((h) => (
        <HotspotMarker key={h.id} hotspot={h} active={h.id === activeId} />
      ))}
    </>
  );
}
