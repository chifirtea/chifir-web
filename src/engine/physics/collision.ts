import type { AABB } from "./types";

export type CollisionAxis = "x" | "z";

export interface CollisionResult {
  x: number;
  z: number;
  /** Ids of the boxes the circle was pushed out of, in resolution order. */
  hits: string[];
}

/**
 * Extra passes after the first push-out. A push out of box A can land the circle inside a
 * neighbouring box B (inner corners, adjacent buildings); a couple of passes settles that.
 */
const MAX_PASSES = 3;

/**
 * Resolves a circle of `radius` at (x, z) against axis-aligned boxes on the ground plane.
 *
 * Minkowski trick: expanding each box by the radius turns the circle into a point, so the test is
 * "is the centre strictly inside the expanded box". Touching is not a hit.
 *
 * - With `axis`, the centre is pushed out along that axis only, toward the nearer face. The
 *   controller moves X and Z separately and calls this after each one, which yields sliding
 *   along walls for free. The nearer face is always the one just crossed as long as a single
 *   step is shorter than the radius (expanded width ≥ 2·radius), which `stepPlayer` guarantees by
 *   clamping dt.
 * - Without `axis`, the push follows the smallest penetration, which is what you want for a
 *   circle that spawned inside a box or had a box registered on top of it.
 */
export function resolveCircleAABB(
  x: number,
  z: number,
  radius: number,
  boxes: readonly AABB[],
  axis?: CollisionAxis,
): CollisionResult {
  const hits: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let pushed = false;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const minX = b.minX - radius;
      const maxX = b.maxX + radius;
      const minZ = b.minZ - radius;
      const maxZ = b.maxZ + radius;
      if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;

      // Distances to escape through each face (all positive while inside).
      const toMinX = x - minX;
      const toMaxX = maxX - x;
      const toMinZ = z - minZ;
      const toMaxZ = maxZ - z;

      if (axis === "x") {
        x = toMinX < toMaxX ? minX : maxX;
      } else if (axis === "z") {
        z = toMinZ < toMaxZ ? minZ : maxZ;
      } else {
        const minPenX = Math.min(toMinX, toMaxX);
        const minPenZ = Math.min(toMinZ, toMaxZ);
        if (minPenX <= minPenZ) x = toMinX < toMaxX ? minX : maxX;
        else z = toMinZ < toMaxZ ? minZ : maxZ;
      }
      hits.push(b.id);
      pushed = true;
    }
    if (!pushed) break;
  }
  return { x, z, hits };
}

/**
 * Parametric distance along the segment a→b (0..1) at which it first enters any box, or 1 when
 * it reaches `b` unobstructed. 2D slab test on the XZ plane; boxes are treated as infinitely tall
 * prisms (buildings), which is the right call for a camera that sits ~4 m up.
 */
export function segmentAABBEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  boxes: readonly AABB[],
  minBoxSize = 0,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  let nearest = 1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (b.maxX - b.minX < minBoxSize && b.maxZ - b.minZ < minBoxSize) continue;

    // Slab intersection: the segment is inside the box where the X-slab and Z-slab intervals
    // overlap. A zero direction component means the slab either always or never contains us.
    let tMin = 0;
    let tMax = nearest;
    if (dx !== 0) {
      const inv = 1 / dx;
      let t1 = (b.minX - ax) * inv;
      let t2 = (b.maxX - ax) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    } else if (ax <= b.minX || ax >= b.maxX) {
      continue;
    }
    if (dz !== 0) {
      const inv = 1 / dz;
      let t1 = (b.minZ - az) * inv;
      let t2 = (b.maxZ - az) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
    } else if (az <= b.minZ || az >= b.maxZ) {
      continue;
    }
    if (tMin <= tMax && tMin < nearest) nearest = Math.max(0, tMin);
  }
  return nearest;
}
