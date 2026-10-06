/**
 * The authoritative, mutable player transform. Updated every frame by the controller and read by
 * the camera, minimap and hotspot scanner without going through React state.
 */
export interface PlayerRig {
  x: number;
  y: number;
  z: number;
  /** Radians around +Y. 0 faces +Z. */
  yaw: number;
  /** Current horizontal speed in m/s. */
  speed: number;
  moving: boolean;
  running: boolean;
}

export const playerRig: PlayerRig = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  moving: false,
  running: false,
};

export function setRigPose(pose: { x: number; z: number; yaw: number; y?: number }): void {
  playerRig.x = pose.x;
  playerRig.z = pose.z;
  playerRig.y = pose.y ?? 0;
  playerRig.yaw = pose.yaw;
  playerRig.speed = 0;
  playerRig.moving = false;
}
