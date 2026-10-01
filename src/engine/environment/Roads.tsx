"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import {
  SIDEWALK_HEIGHT,
  getStreetLayout,
  segmentCenter,
  segmentLength,
  segmentYaw,
  type StreetLayout,
} from "@/city/layout";
import { useQuality } from "@/engine/canvas/qualityStore";
import { crosswalkTexture, roadTexture } from "@/engine/storefront/facade";
import { GEO, tinted } from "@/engine/storefront/templates/parts";
import { getDuskEnvMap } from "./atmosphere";
import { mergedBoxes, mergedTops, tiledPlane, type BoxSpec, type TopSpec } from "./geometry";
import { StaticInstances, type InstanceTransform } from "./StaticInstances";
import { drainTexture, manholeTexture, pavementTexture, type PavementKind } from "./textures";

/**
 * Street surfaces derived from the layout: asphalt with lane markings (wet sheen on high), raised
 * curbs, pavement per district theme (one merged geometry per look), zebra crossings with stop
 * lines, manhole covers and gutter drains.
 */

interface PavementGroup {
  key: string;
  kind: PavementKind;
  accent: string;
  tops: TopSpec[];
}

function topSpec(s: StreetLayout["sidewalks"][number]): TopSpec {
  const c = segmentCenter(s);
  const len = segmentLength(s);
  const h = s.kind === "forecourt" ? SIDEWALK_HEIGHT + 0.006 : SIDEWALK_HEIGHT;
  return { x: c.x, y: h + 0.004, z: c.z, w: len, h: 0, d: s.width, yaw: segmentYaw(s) - Math.PI / 2, ru: len / 3, rv: s.width / 3 };
}

function groupPavements(layout: StreetLayout, index: CityIndex): PavementGroup[] {
  const groups = new Map<string, PavementGroup>();
  for (const s of layout.sidewalks) {
    const theme = index.districtsById[s.districtId]?.theme;
    const kind: PavementKind = theme?.pavement ?? "stone";
    const accent = theme?.accent ?? "#ffc46b";
    const key = `${kind}|${accent}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, kind, accent, tops: [] };
      groups.set(key, g);
    }
    g.tops.push(topSpec(s));
  }
  return [...groups.values()];
}

function Pavement({ group, texSize, geometry }: { group: PavementGroup; texSize: number; geometry: THREE.BufferGeometry }) {
  const material = useMemo(() => {
    const tex = pavementTexture(group.kind, group.accent, texSize);
    return new THREE.MeshStandardMaterial({
      color: tex ? "#ffffff" : "#4a4a50",
      map: tex,
      roughness: group.kind === "plaza" ? 0.72 : 0.88,
      metalness: 0,
    });
  }, [group.kind, group.accent, texSize]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

const STOP_LINE = tinted("#d9d6cc", { roughness: 0.9 });

export function Roads() {
  const quality = useQuality();
  const index = useCityStore((s) => s.index);
  const layout = useMemo(() => (index ? getStreetLayout(index) : null), [index]);
  const texSize = Math.min(512, quality.maxTextureSize);
  const wet = quality.tier === "high";

  const roadMat = useMemo(() => {
    const tex = roadTexture(texSize);
    const env = wet ? getDuskEnvMap() : null;
    return new THREE.MeshStandardMaterial({
      color: tex ? "#a9aab0" : "#1f2025",
      map: tex,
      roughness: wet ? 0.42 : 0.94,
      metalness: wet ? 0.22 : 0,
      envMap: env,
      envMapIntensity: 0.9,
    });
  }, [texSize, wet]);
  const crossMat = useMemo(() => {
    const tex = crosswalkTexture(Math.min(256, texSize));
    return new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }, [texSize]);
  const manholeMat = useMemo(() => {
    const tex = manholeTexture(128);
    return new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.55, metalness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }, []);
  const drainMat = useMemo(() => {
    const tex = drainTexture(128);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.45, polygonOffset: true, polygonOffsetFactor: -1 });
  }, []);
  useEffect(
    () => () => {
      roadMat.dispose();
      crossMat.dispose();
      manholeMat.dispose();
      drainMat.dispose();
    },
    [roadMat, crossMat, manholeMat, drainMat],
  );
  const curbMat = tinted("#4b4c53", { roughness: 0.9 });

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
  const pavements = useMemo(() => {
    if (!layout || !index) return [];
    return groupPavements(layout, index).map((group) => ({ group, geometry: mergedTops(group.tops) }));
  }, [layout, index]);
  useEffect(
    () => () => {
      walkBodies?.dispose();
      for (const p of pavements) p.geometry?.dispose();
    },
    [walkBodies, pavements],
  );

  const manholes = useMemo<InstanceTransform[]>(
    () => (layout ? layout.manholes.map((m) => ({ x: m.x, y: 0.012, z: m.z, tiltX: -Math.PI / 2, sx: 0.75, sy: 0.75, sz: 1 })) : []),
    [layout],
  );
  const drains = useMemo<InstanceTransform[]>(
    () => (layout ? layout.drains.map((d) => ({ x: d.x, y: 0.012, z: d.z, tiltX: -Math.PI / 2, tiltZ: Math.PI / 2 - d.yaw, sx: 0.9, sy: 0.45, sz: 1 })) : []),
    [layout],
  );
  // A stop line on each approach to every crossing.
  const stopLines = useMemo<InstanceTransform[]>(() => {
    if (!layout) return [];
    const out: InstanceTransform[] = [];
    for (const cw of layout.crosswalks) {
      const fx = Math.sin(cw.yaw);
      const fz = Math.cos(cw.yaw);
      const rx = fz;
      const rz = -fx;
      for (const s of [-1, 1] as const) {
        const along = s * (cw.length / 2 + 0.6);
        const across = -s * (cw.width / 4);
        out.push({ x: cw.x + fx * along + rx * across, y: 0.012, z: cw.z + fz * along + rz * across, yaw: cw.yaw, sx: cw.width / 2 - 0.3, sy: 0.006, sz: 0.3 });
      }
    }
    return out;
  }, [layout]);

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
      {pavements.map(({ group, geometry }) => geometry && <Pavement key={group.key} group={group} texSize={Math.min(256, texSize)} geometry={geometry} />)}
      {layout.crosswalks.map((cw, i) => (
        <group key={`cw-${i}`} position={[cw.x, 0.01, cw.z]} rotation={[0, cw.yaw - Math.PI / 2, 0]}>
          <mesh geometry={tiledPlane(cw.length, cw.width, 1, 1)} material={crossMat} rotation={[-Math.PI / 2, 0, 0]} />
        </group>
      ))}
      <StaticInstances geometry={GEO.box} material={STOP_LINE} items={stopLines} />
      <StaticInstances geometry={GEO.plane} material={manholeMat} items={manholes} />
      <StaticInstances geometry={GEO.plane} material={drainMat} items={drains} />
    </group>
  );
}
