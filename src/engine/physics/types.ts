/** Axis-aligned box in world space, on the XZ ground plane. */
export interface AABB {
  id: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Builds an AABB from a centre, size and yaw. Rotated boxes are approximated by their
 * bounding box; storefront colliders are axis-aligned in practice (rotations are multiples of 90°).
 */
export function aabbFromCenter(
  id: string,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  yaw = 0,
): AABB {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hw = (width * c + depth * s) / 2;
  const hd = (width * s + depth * c) / 2;
  return { id, minX: cx - hw, minZ: cz - hd, maxX: cx + hw, maxZ: cz + hd };
}
