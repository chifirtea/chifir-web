import * as THREE from "three";

/**
 * Building volumes share one unit BoxGeometry per size so a façade texture tiles at a fixed
 * physical size (a brick is a brick on a 6 m café and a 24 m flagship alike). Scaling the mesh
 * would stretch the texture; scaling the UVs keeps it honest.
 */

const cache = new Map<string, THREE.BoxGeometry>();

/**
 * Rewrites a unit box's UVs so each face repeats its texture every `tile` metres for a box that
 * will be scaled to `w × h × d`. Face order in three's BoxGeometry is +x, -x, +y, -y, +z, -z with
 * four vertices each; side faces run u along their width and v up, caps run u along x, v along z.
 */
export function scaleBoxUvs(
  uv: { count: number; getX(i: number): number; getY(i: number): number; setXY(i: number, x: number, y: number): unknown },
  w: number,
  h: number,
  d: number,
  tile: number,
): void {
  const t = Math.max(0.01, tile);
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    let su: number;
    let sv: number;
    if (face < 2) {
      su = d / t;
      sv = h / t;
    } else if (face < 4) {
      su = w / t;
      sv = d / t;
    } else {
      su = w / t;
      sv = h / t;
    }
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
}

/** A unit box whose UVs tile every `tile` metres once scaled to `w × h × d`; cached per size. */
export function tiledBox(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}|${tile.toFixed(2)}`;
  let geo = cache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(1, 1, 1);
    const uv = geo.attributes.uv;
    if (uv) {
      scaleBoxUvs(uv, w, h, d, tile);
      uv.needsUpdate = true;
    }
    cache.set(key, geo);
  }
  return geo;
}

/** Transforms for a row of evenly spaced items between two local x values (LED bulbs, bolts). */
export function evenlySpaced(from: number, to: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(from + ((to - from) * i) / (count - 1));
  return out;
}
