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
  type InterpolationBuffer,
} from "@/lib/presence/interpolation";
import { seenAcrossRooms, usePresenceStore } from "@/lib/presence/presenceStore";
import type { RewardAppearance } from "@/types/domain";
import { acquireNameTag, PARTY_COLOR, releaseNameTag, TAG_HEIGHT_M, TAG_WIDTH_M } from "./nameTag";

/** Phones draw fewer strangers; the nearest ones win. */
const MAX_PEERS_MOBILE = 24;
const MAX_PEERS_DESKTOP = 48;
/** When over the cap, or with party members around, re-pick who is drawn this often. */
const RESORT_MS = 1000;
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

/** One figure to draw: a room peer, or a party member just across a district edge. */
interface Figure {
  id: string;
  name: string;
  bodyColor: string;
  hairColor: string;
  outfit: RewardAppearance | null;
  buffer: InterpolationBuffer;
  party: boolean;
}

function distanceSqToPlayer(peer: Figure): number {
  const s = latestSample(peer.buffer);
  if (!s) return Infinity;
  const dx = s.x - playerRig.x;
  const dz = s.z - playerRig.z;
  return dx * dx + dz * dz;
}

/**
 * Everyone else in the room, interpolated 120 ms behind the wire, plus party members standing
 * nearby in the next district (from the party channel, which then runs at full rate), so friends
 * never vanish while only one of them has crossed an edge. Re-renders on join, leave and look
 * changes, and on a slow tick while capped or partied; positions are written to the groups each
 * frame. Figures are keyed by peer id, so a friend moving between the two sources keeps one avatar.
 */
export function RemoteAvatars() {
  const peers = usePresenceStore((s) => s.peers);
  const partyPeers = usePresenceStore((s) => s.partyPeers);
  const room = usePresenceStore((s) => s.room);
  const myParty = usePresenceStore((s) => s.me.partyCode);
  const mobile = useQualityStore((s) => s.mobile);
  const cap = mobile ? MAX_PEERS_MOBILE : MAX_PEERS_DESKTOP;
  const count = Object.keys(peers).length;
  const partied = Object.keys(partyPeers).length > 0;
  const [resort, setResort] = useState(0);

  useEffect(() => {
    if (count <= cap && !partied) return;
    const t = setInterval(() => setResort((n) => n + 1), RESORT_MS);
    return () => clearInterval(t);
  }, [count, cap, partied]);

  // Renders are rare (see above), so building the list here is cheap.
  void resort;
  const list: Figure[] = Object.values(peers).map((p) => ({
    id: p.id,
    name: p.name,
    bodyColor: p.bodyColor,
    hairColor: p.hairColor,
    outfit: p.outfit,
    buffer: p.buffer,
    party: Boolean(myParty) && p.partyCode === myParty,
  }));
  for (const m of Object.values(partyPeers)) {
    if (peers[m.id] || !seenAcrossRooms(m, room, playerRig.x, playerRig.z)) continue;
    list.push({ id: m.id, name: m.name, bodyColor: m.bodyColor, hairColor: m.hairColor, outfit: m.outfit, buffer: m.buffer, party: true });
  }
  const shown =
    list.length <= cap
      ? list
      : list
          .map((figure) => ({ figure, d: distanceSqToPlayer(figure) - (figure.party ? 1e9 : 0) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, cap)
          .map((e) => e.figure);

  if (shown.length === 0) return null;
  return (
    <group>
      {shown.map((figure) => (
        <RemotePeer key={figure.id} peer={figure} />
      ))}
    </group>
  );
}

function RemotePeer({ peer }: { peer: Figure }) {
  const party = peer.party;
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
