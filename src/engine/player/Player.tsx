"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { AvatarConfig } from "@/types/domain";
import { inputRig } from "@/engine/input/inputStore";
import { useKeyboard } from "@/engine/input/useKeyboard";
import { getColliders } from "@/engine/physics/colliderStore";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { Avatar } from "./Avatar";
import { FollowCamera, getCameraYaw } from "./FollowCamera";
import { playerRig } from "./playerRig";
import { stepPlayer, type PlayerInput } from "./PlayerController";

/** Runs before the camera (-10) so the camera follows this frame's pose. */
export const PLAYER_PRIORITY = -20;

const frameInput: PlayerInput = { moveX: 0, moveY: 0, run: false };

/**
 * Owns the player each frame: input → controller → `playerRig` → group transform. Mount it after
 * `setRigPose(spawn)` has been called; it never picks a spawn itself.
 */
export function Player({ avatar }: { avatar?: AvatarConfig }) {
  useKeyboard();
  const group = useRef<Group>(null);

  useFrame((_, dt) => {
    const world = useWorldStore.getState();
    const locked = selectInputLocked(world);
    frameInput.moveX = locked ? 0 : inputRig.move.x;
    frameInput.moveY = locked ? 0 : inputRig.move.y;
    frameInput.run = !locked && inputRig.run;

    const scope = world.location.kind === "interior" ? "interior" : "street";
    stepPlayer(playerRig, frameInput, getCameraYaw(), dt, getColliders(scope));

    const g = group.current;
    if (g) {
      g.position.set(playerRig.x, playerRig.y, playerRig.z);
      g.rotation.y = playerRig.yaw;
    }
  }, PLAYER_PRIORITY);

  return (
    <>
      <group ref={group} position={[playerRig.x, playerRig.y, playerRig.z]} rotation-y={playerRig.yaw}>
        <Avatar avatar={avatar} />
      </group>
      <FollowCamera />
    </>
  );
}
