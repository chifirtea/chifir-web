"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import { SIDEWALK_HEIGHT, getStreetLayout, segmentCenter, segmentLength, segmentYaw } from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { crosswalkTexture, pavementTexture, roadTexture } from "@/engine/storefront/facade";
import { tinted } from "@/engine/storefront/templates/parts";
import { mergedBoxes, mergedTops, tiledPlane, type BoxSpec, type TopSpec } from "./geometry";

/**
 * Street surfaces derived from the layout: asphalt with lane markings, raised sidewalks and
 * forecourts (all strips merged into one geometry each), and zebra crosswalks.
 */

export function Roads() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const texSize = Math.min(512, quality.maxTextureSize);

  const roadMat = useMemo(() => {
    const tex = roadTexture(texSize);
    return new THREE.MeshStandardMaterial({ color: tex ? "#a9aab0" : "#1f2025", map: tex, roughness: 0.94, metalness: 0 });
  }, [texSize]);
  const walkTopMat = useMemo(() => {
    const tex = pavementTexture(Math.min(256, texSize));
    return new THREE.MeshStandardMaterial({ color: tex ? "#ffffff" : "#4a4a50", map: tex, roughness: 0.88, metalness: 0 });
  }, [texSize]);
  const crossMat = useMemo(() => {
    const tex = crosswalkTexture(Math.min(256, texSize));
    return new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }, [texSize]);
  const curbMat = tinted("#3d3e45", { roughness: 0.9 });

  const walkBodies = useMemo(() => {
    if (!layout) return null;
    const items: BoxSpec[] = layout.sidewalks.map((s) => {
      const c = segmentCenter(s);
      const len = segmentLength(s);
      const h = s.kind === "forecourt" ? SIDEWALK_HEIGHT + 0.006 : SIDEWALK_HEIGHT;
      return { x: c.x, y: h / 2, z: c.z, w: len, h, d: s.width, yaw: segmentYaw(s) - Math.PI / 2 };
    });
    return mergedBoxes(items);
  }, [layout]);
  const walkTops = useMemo(() => {
    if (!layout) return null;
    const items: TopSpec[] = layout.sidewalks.map((s) => {
      const c = segmentCenter(s);
      const len = segmentLength(s);
      const h = s.kind === "forecourt" ? SIDEWALK_HEIGHT + 0.006 : SIDEWALK_HEIGHT;
      return { x: c.x, y: h + 0.004, z: c.z, w: len, h: 0, d: s.width, yaw: segmentYaw(s) - Math.PI / 2, ru: len / 3, rv: s.width / 3 };
    });
    return mergedTops(items);
  }, [layout]);
  useEffect(
    () => () => {
      walkBodies?.dispose();
      walkTops?.dispose();
    },
    [walkBodies, walkTops],
  );

  if (!layout) return null;
  return (
    <group>
      {layout.roads.map((road, i) => {
        const c = segmentCenter(road);
        const len = segmentLength(road);
        return (
          <group key={`road-${i}`} position={[c.x, 0.004, c.z]} rotation={[0, segmentYaw(road) - Math.PI / 2, 0]}>
            <mesh geometry={tiledPlane(len, road.width, len / 8, 1)} material={roadMat} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
          </group>
        );
      })}
      {walkBodies && <mesh geometry={walkBodies} material={curbMat} receiveShadow />}
      {walkTops && <mesh geometry={walkTops} material={walkTopMat} receiveShadow />}
      {layout.crosswalks.map((cw, i) => (
        <group key={`cw-${i}`} position={[cw.x, 0.01, cw.z]} rotation={[0, cw.yaw - Math.PI / 2, 0]}>
          <mesh geometry={tiledPlane(cw.length, cw.width, 1, 1)} material={crossMat} rotation={[-Math.PI / 2, 0, 0]} />
        </group>
      ))}
    </group>
  );
}
