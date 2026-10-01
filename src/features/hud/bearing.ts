/**
 * Pure math for the waypoint chevron. Engine convention: forward = (sin yaw, 0, cos yaw), so
 * yaw 0 faces +Z and a positive yaw turns counter-clockwise seen from above (to the player's
 * left, since screen-right is (-cos yaw, 0, sin yaw) for a Y-up follow camera).
 */

export interface BearingPose {
  x: number;
  z: number;
  /** Radians, engine convention. */
  yaw: number;
}

/** Wraps any angle in degrees into (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Screen rotation for an arrow that points at `to` from the player's point of view: 0 is straight
 * ahead, 90 is to the right, -90 to the left, 180 behind. Feed it to CSS `rotate(...deg)`.
 */
export function bearingDegrees(from: BearingPose, to: { x: number; z: number }): number {
  const targetYaw = Math.atan2(to.x - from.x, to.z - from.z);
  const relative = targetYaw - from.yaw; // positive = counter-clockwise = the player's left
  return normalizeDegrees((-relative * 180) / Math.PI);
}

/** "12 m" under a kilometre, "1.2 km" above. */
export function formatDistance(meters: number): string {
  const m = Math.max(0, Math.round(meters));
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
