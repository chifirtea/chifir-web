"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * One draw call for N copies of a geometry with static transforms. Unlike drei's `<Instances>`
 * (which rewrites every instance matrix each frame), this writes the matrices once per `items`
 * change, which is what lamps, trees, windows and other props need.
 */
export interface InstanceTransform {
  x: number;
  y: number;
  z: number;
  /** Rotation around +Y. */
  yaw?: number;
  /** Rotation around +X (e.g. a tilted awning or bench back). */
  tiltX?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Per-instance tint (requires a material with `vertexColors` off; three multiplies it in). */
  color?: string;
}

export interface StaticInstancesProps {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: readonly InstanceTransform[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function StaticInstances({ geometry, material, items, castShadow = false, receiveShadow = false }: StaticInstancesProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = items.length;
  const hasColors = useMemo(() => items.some((it) => it.color), [items]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      tmp.position.set(it.x, it.y, it.z);
      tmp.rotation.set(it.tiltX ?? 0, it.yaw ?? 0, 0);
      tmp.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      if (hasColors) mesh.setColorAt(i, tmpColor.set(it.color ?? "#ffffff"));
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, hasColors]);

  if (count === 0) return null;
  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}
