"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, MeshBasicMaterial, RingGeometry, Sprite, SpriteMaterial } from "three";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { NpcAvatar } from "@/engine/player/Avatar";
import { playerRig } from "@/engine/player/playerRig";
import { hashString } from "@/lib/presence/identity";
import {
  INTERP_DELAY_MS,
  latestSample,
  sampleAt,
  type InterpolatedPose,
} from "@/lib/presence/interpolation";
import { usePresenceStore, type Peer } from "@/lib/presence/presenceStore";
import { acquireNameTag, PARTY_COLOR, releaseNameTag, TAG_HEIGHT_M, TAG_WIDTH_M } from "./nameTag";

/** Phones draw fewer strangers; the nearest ones win. */
const MAX_PEERS_MOBILE = 24;
const MAX_PEERS_DESKTOP = 48;
/** When over the cap, re-pick the nearest peers this often. */
const RESORT_MS = 2000;
const TAG_Y = 2.05;

const scratch: InterpolatedPose = { x: 0, z: 0, yaw: 0, speed: 0 };

let ringGeometry: RingGeometry | null = null;
let ringMaterial: MeshBasicMaterial | null = null;
function ringAssets(): { geometry: RingGeometry; material: MeshBasicMaterial } {
  ringGeometry ??= new RingGeometry(0.42, 0.56, 40);
  ringMaterial ??= new MeshBasicMaterial({
    color: PARTY_COLOR,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
  });
  return { geometry: ringGeometry, material: ringMaterial };
}

function distanceSqToPlayer(peer: Peer): number {
  const s = latestSample(peer.buffer);
  if (!s) return Infinity;
  const dx = s.x - playerRig.x;
  const dz = s.z - playerRig.z;
  return dx * dx + dz * dz;
}

/**
 * Everyone else in the room, interpolated 120 ms behind the wire. Re-renders only when peers
 * join, leave or change their look; positions are written straight to the groups each frame.
 */
export function RemoteAvatars() {
  const peers = usePresenceStore((s) => s.peers);
  const myParty = usePresenceStore((s) => s.me.partyCode);
  const mobile = useQualityStore((s) => s.mobile);
  const cap = mobile ? MAX_PEERS_MOBILE : MAX_PEERS_DESKTOP;
  const count = Object.keys(peers).length;
  const [resort, setResort] = useState(0);

  useEffect(() => {
    if (count <= cap) return;
    const t = setInterval(() => setResort((n) => n + 1), RESORT_MS);
    return () => clearInterval(t);
  }, [count, cap]);

  // Renders happen on join/leave (and on `resort` ticks while over the cap), so sorting here is cheap.
  void resort;
  const list = Object.values(peers);
  const shown =
    list.length <= cap
      ? list
      : list
          .map((peer) => ({ peer, d: distanceSqToPlayer(peer) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, cap)
          .map((e) => e.peer);

  if (shown.length === 0) return null;
  return (
    <group>
      {shown.map((peer) => (
        <RemotePeer key={peer.id} peer={peer} party={Boolean(myParty) && peer.partyCode === myParty} />
      ))}
    </group>
  );
}

function RemotePeer({ peer, party }: { peer: Peer; party: boolean }) {
  const group = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  // `NpcAvatar` reads this holder each frame for the walk cycle; a plain object, not a ref.
  const speed = useMemo(() => ({ current: 0 }), []);
  const phase = useMemo(() => (hashString(peer.id) % 628) / 100, [peer.id]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (!sampleAt(peer.buffer, Date.now() - INTERP_DELAY_MS, scratch)) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(scratch.x, 0, scratch.z);
    g.rotation.y = scratch.yaw;
    speed.current = scratch.speed;
    const r = ring.current;
    if (r) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.06;
      r.scale.set(pulse, pulse, 1);
    }
  });

  return (
    <group ref={group} visible={false}>
      <NpcAvatar bodyColor={peer.bodyColor} hairColor={peer.hairColor} outfit={peer.outfit} speedRef={speed} phase={phase} />
      <NameTag name={peer.name} party={party} />
      {party ? <PartyRing ref={ring} /> : null}
    </group>
  );
}

let placeholder: SpriteMaterial | null = null;
/** Invisible until the tag texture is acquired; shared by every sprite. */
function placeholderMaterial(): SpriteMaterial {
  placeholder ??= new SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false });
  return placeholder;
}

function NameTag({ name, party }: { name: string; party: boolean }) {
  const sprite = useRef<Sprite>(null);
  useEffect(() => {
    const material = acquireNameTag(name, party);
    const s = sprite.current;
    if (s && material) s.material = material;
    return () => {
      if (s && material && s.material === material) s.material = placeholderMaterial();
      releaseNameTag(name, party);
    };
  }, [name, party]);
  return <sprite ref={sprite} material={placeholderMaterial()} position={[0, TAG_Y, 0]} scale={[TAG_WIDTH_M, TAG_HEIGHT_M, 1]} />;
}

function PartyRing({ ref }: { ref: React.RefObject<Mesh | null> }) {
  const { geometry, material } = ringAssets();
  return <mesh ref={ref} geometry={geometry} material={material} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} />;
}
