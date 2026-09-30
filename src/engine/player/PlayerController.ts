import type { AABB } from "@/engine/physics/types";
import { resolveCircleAABB } from "@/engine/physics/collision";
import type { PlayerRig } from "./playerRig";

export interface PlayerInput {
  /** Strafe, -1 (left) .. 1 (right), relative to the camera. */
  moveX: number;
  /** Forward, -1 (back) .. 1 (forward), relative to the camera. */
  moveY: number;
  run: boolean;
}

/** Velocity carried between frames. Kept outside `PlayerRig` so that contract stays untouched. */
export interface PlayerMotion {
  vx: number;
  vz: number;
}

export const PLAYER_RADIUS = 0.4;
export const WALK_SPEED = 4;
export const RUN_SPEED = 7;
/** Longest simulated step. Also what makes the per-axis collision tunnelling-proof. */
export const MAX_DT = 0.05;
/** Yaw approach rate toward the movement direction (rad/s, exponential). */
export const TURN_RATE = 10;
/** Exponential velocity approach rates (1/s). Braking is snappier than starting. */
const ACCEL_RATE = 12;
const DECEL_RATE = 18;
/** Below this the player is considered stopped (m/s). */
const STOP_EPSILON = 0.02;

const defaultMotion: PlayerMotion = { vx: 0, vz: 0 };

export function createMotion(): PlayerMotion {
  return { vx: 0, vz: 0 };
}

/** Wraps an angle to [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Advances the player one frame. Mutates `rig` (and `motion`) in place; allocates nothing.
 *
 * Frame: forward = (sin yaw, 0, cos yaw), right = forward × up = (-cos yaw, 0, sin yaw). So with
 * the camera facing +Z (yaw 0), "strafe right" is world -X, exactly as three.js' right-handed
 * frame has it on screen.
 */
export function stepPlayer(
  rig: PlayerRig,
  input: PlayerInput,
  cameraYaw: number,
  dt: number,
  colliders: readonly AABB[],
  motion: PlayerMotion = defaultMotion,
): void {
  dt = dt > MAX_DT ? MAX_DT : dt < 0 ? 0 : dt;

  // Clamp the stick to the unit disc (keyboard diagonals come in at length √2).
  let ix = input.moveX;
  let iy = input.moveY;
  const mag = Math.hypot(ix, iy);
  if (mag > 1) {
    ix /= mag;
    iy /= mag;
  }
  const wants = mag > 0.001;

  const sinY = Math.sin(cameraYaw);
  const cosY = Math.cos(cameraYaw);
  // World-space move direction = moveY·forward + moveX·right.
  const dirX = iy * sinY + ix * -cosY;
  const dirZ = iy * cosY + ix * sinY;

  const targetSpeed = wants ? (input.run ? RUN_SPEED : WALK_SPEED) : 0;
  const tvx = dirX * targetSpeed;
  const tvz = dirZ * targetSpeed;

  // Exponential approach: frame-rate independent and free of overshoot.
  const rate = wants ? ACCEL_RATE : DECEL_RATE;
  const k = 1 - Math.exp(-rate * dt);
  motion.vx += (tvx - motion.vx) * k;
  motion.vz += (tvz - motion.vz) * k;
  if (!wants && Math.hypot(motion.vx, motion.vz) < STOP_EPSILON) {
    motion.vx = 0;
    motion.vz = 0;
  }

  const startX = rig.x;
  const startZ = rig.z;

  // If something was registered on top of us (or we spawned inside a wall), get out first along
  // the shortest way; otherwise the per-axis passes below would push us through the box.
  const settled = resolveCircleAABB(rig.x, rig.z, PLAYER_RADIUS, colliders);
  let x = settled.x;
  let z = settled.z;

  // Move and resolve one axis at a time so the blocked component is removed and the free one
  // is kept: that is what makes the player slide along walls and around corners.
  x += motion.vx * dt;
  x = resolveCircleAABB(x, z, PLAYER_RADIUS, colliders, "x").x;
  z += motion.vz * dt;
  z = resolveCircleAABB(x, z, PLAYER_RADIUS, colliders, "z").z;

  rig.x = x;
  rig.z = z;

  // Report the speed actually achieved so the walk cycle stops when we press against a wall.
  const actual = dt > 0 ? Math.hypot(x - startX, z - startZ) / dt : 0;
  rig.speed = actual;
  rig.moving = actual > STOP_EPSILON;
  rig.running = input.run && rig.moving;

  if (wants) {
    const targetYaw = Math.atan2(dirX, dirZ);
    const turn = 1 - Math.exp(-TURN_RATE * dt);
    rig.yaw = wrapAngle(rig.yaw + wrapAngle(targetYaw - rig.yaw) * turn);
  }
}
