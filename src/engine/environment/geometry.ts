import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Cached plane whose UVs repeat `ru` × `rv` times, so one shared material tiles any surface. */
const planeCache = new Map<string, THREE.PlaneGeometry>();

export function tiledPlane(width: number, height: number, ru: number, rv: number): THREE.PlaneGeometry {
  const key = `${width.toFixed(3)}|${height.toFixed(3)}|${ru.toFixed(3)}|${rv.toFixed(3)}`;
  let geo = planeCache.get(key);
  if (!geo) {
    geo = new THREE.PlaneGeometry(width, height);
    const uv = geo.attributes.uv;
    if (uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
      uv.needsUpdate = true;
    }
    planeCache.set(key, geo);
  }
  return geo;
}

/** Disc with radially tiled UVs (plaza pavement). */
export function tiledDisc(radius: number, segments: number, repeat: number): THREE.CircleGeometry {
  const geo = new THREE.CircleGeometry(radius, segments);
  const uv = geo.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat, uv.getY(i) * repeat);
    uv.needsUpdate = true;
  }
  return geo;
}

export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw?: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpObj = new THREE.Object3D();

/** One geometry for many static boxes (sidewalk strips, forecourts): one draw call. */
export function mergedBoxes(items: readonly BoxSpec[]): THREE.BufferGeometry | null {
  if (items.length === 0) return null;
  const parts = items.map((it) => {
    const g = new THREE.BoxGeometry(it.w, it.h, it.d);
    tmpObj.position.set(it.x, it.y, it.z);
    tmpObj.rotation.set(0, it.yaw ?? 0, 0);
    tmpObj.scale.set(1, 1, 1);
    tmpObj.updateMatrix();
    tmpMatrix.copy(tmpObj.matrix);
    g.applyMatrix4(tmpMatrix);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export interface TopSpec extends BoxSpec {
  /** UV repeats along w and d. */
  ru: number;
  rv: number;
}

/** One geometry for many flat, textured tops (pavement surfaces), lying in XZ at y. */
export function mergedTops(items: readonly TopSpec[]): THREE.BufferGeometry | null {
  if (items.length === 0) return null;
  const parts = items.map((it) => {
    const g = new THREE.PlaneGeometry(it.w, it.d);
    const uv = g.attributes.uv;
    if (uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * it.ru, uv.getY(i) * it.rv);
    }
    tmpObj.position.set(it.x, it.y, it.z);
    tmpObj.rotation.set(-Math.PI / 2, 0, 0);
    tmpObj.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), it.yaw ?? 0);
    tmpObj.scale.set(1, 1, 1);
    tmpObj.updateMatrix();
    g.applyMatrix4(tmpObj.matrix);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}
