"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleGeometry, Group, MeshStandardMaterial, SphereGeometry } from "three";
import type { AvatarConfig } from "@/types/domain";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { playerRig } from "./playerRig";
import { WALK_SPEED } from "./PlayerController";

export const DEFAULT_AVATAR: AvatarConfig = {
  bodyColor: "#4F86F7",
  hairColor: "#2B2118",
  accessories: [],
};

// Proportions (metres). Legs 0.52 tall, torso 0.8, head top at ~1.67; eye line ≈ 1.5.
const LEG_RADIUS = 0.09;
const LEG_LENGTH = 0.34;
const LEG_HEIGHT = LEG_LENGTH + LEG_RADIUS * 2;
const TORSO_RADIUS = 0.25;
const TORSO_LENGTH = 0.3;
const TORSO_HEIGHT = TORSO_LENGTH + TORSO_RADIUS * 2;
const ARM_RADIUS = 0.06;
const ARM_LENGTH = 0.3;
const HEAD_RADIUS = 0.17;
const HIP_Y = LEG_HEIGHT;
const TORSO_Y = HIP_Y + TORSO_HEIGHT / 2;
const SHOULDER_Y = HIP_Y + TORSO_HEIGHT - TORSO_RADIUS;
const HEAD_Y = HIP_Y + TORSO_HEIGHT + HEAD_RADIUS - 0.02;

/** Radians of walk cycle per metre travelled. */
const STRIDE_RATE = 2.6;
const LEG_SWING = 0.7;
const ARM_SWING = 0.5;
const BOB = 0.05;
const LEAN_WALK = 0.06;
const LEAN_RUN = 0.18;
/** NPCs have no `running` flag; above this they lean like a runner. */
const NPC_RUN_SPEED = 5.5;

interface SharedGeometry {
  torso: CapsuleGeometry;
  leg: CapsuleGeometry;
  arm: CapsuleGeometry;
  head: SphereGeometry;
  hair: SphereGeometry;
}

let geometry: SharedGeometry | null = null;
const materials = new Map<string, MeshStandardMaterial>();

/** Built on first use so importing this module on the server allocates nothing. */
function getGeometry(): SharedGeometry {
  if (geometry) return geometry;
  const leg = new CapsuleGeometry(LEG_RADIUS, LEG_LENGTH, 3, 8);
  // Pivot limbs at their top so rotation.x swings them from the joint.
  leg.translate(0, -LEG_HEIGHT / 2, 0);
  const arm = new CapsuleGeometry(ARM_RADIUS, ARM_LENGTH, 3, 8);
  arm.translate(0, -(ARM_LENGTH / 2 + ARM_RADIUS), 0);
  geometry = {
    torso: new CapsuleGeometry(TORSO_RADIUS, TORSO_LENGTH, 4, 14),
    leg,
    arm,
    head: new SphereGeometry(HEAD_RADIUS, 18, 14),
    // A cap covering the top 55% of a slightly larger sphere reads as hair from any angle.
    hair: new SphereGeometry(HEAD_RADIUS + 0.015, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  };
  return geometry;
}

function materialFor(color: string, roughness = 0.75): MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let mat = materials.get(key);
  if (!mat) {
    mat = new MeshStandardMaterial({ color, roughness, metalness: 0 });
    materials.set(key, mat);
  }
  return mat;
}

const SKIN = "#d9a98c";
const TROUSERS = "#2a2d36";

interface SpeedSource {
  readonly current: number;
}

interface BodyProps {
  bodyColor: string;
  hairColor: string;
  castShadow: boolean;
  /** Where to read the horizontal speed each frame; undefined = the player rig. */
  speedRef?: SpeedSource;
  runningRef?: { readonly running: boolean };
  phase?: number;
}

function AvatarBody({
  bodyColor,
  hairColor,
  castShadow,
  speedRef,
  runningRef,
  phase = 0,
}: BodyProps) {
  const geo = getGeometry();
  const body = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const cycle = useRef(phase);

  useFrame((_, dt) => {
    const speed = speedRef ? speedRef.current : playerRig.speed;
    const running = runningRef ? runningRef.running : speed > NPC_RUN_SPEED;
    // Amplitude scales with speed so the stride fades out instead of freezing mid-step.
    const f = Math.min(1, speed / WALK_SPEED);
    cycle.current += speed * dt * STRIDE_RATE;
    const s = Math.sin(cycle.current);

    if (legL.current) legL.current.rotation.x = s * LEG_SWING * f;
    if (legR.current) legR.current.rotation.x = -s * LEG_SWING * f;
    if (armL.current) armL.current.rotation.x = -s * ARM_SWING * f;
    if (armR.current) armR.current.rotation.x = s * ARM_SWING * f;
    if (body.current) body.current.position.y = Math.abs(s) * BOB * f;
    if (torso.current) torso.current.rotation.x = (running ? LEAN_RUN : LEAN_WALK) * f;
  });

  const bodyMat = materialFor(bodyColor);
  const hairMat = materialFor(hairColor, 0.9);
  const skinMat = materialFor(SKIN, 0.8);
  const trouserMat = materialFor(TROUSERS, 0.85);

  return (
    <group ref={body}>
      <group ref={legL} position={[-0.11, HIP_Y, 0]}>
        <mesh geometry={geo.leg} material={trouserMat} castShadow={castShadow} />
      </group>
      <group ref={legR} position={[0.11, HIP_Y, 0]}>
        <mesh geometry={geo.leg} material={trouserMat} castShadow={castShadow} />
      </group>
      <group ref={torso} position={[0, HIP_Y, 0]}>
        <mesh
          geometry={geo.torso}
          material={bodyMat}
          position={[0, TORSO_Y - HIP_Y, 0]}
          castShadow={castShadow}
        />
        <group ref={armL} position={[-(TORSO_RADIUS + ARM_RADIUS), SHOULDER_Y - HIP_Y, 0]}>
          <mesh geometry={geo.arm} material={bodyMat} castShadow={castShadow} />
        </group>
        <group ref={armR} position={[TORSO_RADIUS + ARM_RADIUS, SHOULDER_Y - HIP_Y, 0]}>
          <mesh geometry={geo.arm} material={bodyMat} castShadow={castShadow} />
        </group>
        <mesh
          geometry={geo.head}
          material={skinMat}
          position={[0, HEAD_Y - HIP_Y, 0]}
          castShadow={castShadow}
        />
        <mesh geometry={geo.hair} material={hairMat} position={[0, HEAD_Y - HIP_Y, 0]} />
      </group>
    </group>
  );
}

/** The player's avatar. Animates from `playerRig`; always casts a shadow. */
export function Avatar({ avatar }: { avatar?: AvatarConfig }) {
  const cfg = avatar ?? DEFAULT_AVATAR;
  return (
    <AvatarBody
      bodyColor={cfg.bodyColor}
      hairColor={cfg.hairColor}
      castShadow
      runningRef={playerRig}
    />
  );
}

export interface NpcAvatarProps {
  bodyColor: string;
  hairColor: string;
  /** Ref-like holder the walker system updates each frame (m/s). Omit for a standing NPC. */
  speedRef?: SpeedSource;
  /** Initial walk-cycle phase so a crowd does not march in lockstep. */
  phase?: number;
}

const STILL: SpeedSource = { current: 0 };

/** Ambient walker. Same body as the player; skips shadows on the low tier. */
export function NpcAvatar({ bodyColor, hairColor, speedRef, phase }: NpcAvatarProps) {
  const tier = useQualityStore((s) => s.settings.tier);
  return (
    <AvatarBody
      bodyColor={bodyColor}
      hairColor={hairColor}
      castShadow={tier !== "low"}
      speedRef={speedRef ?? STILL}
      phase={phase}
    />
  );
}
