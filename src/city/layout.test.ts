/* eslint-disable no-restricted-imports -- test only: seed modules never reach the client bundle */
import { describe, expect, it } from "vitest";
import { districts, parcels } from "@/data/seed/districts";
import { employees, merchants } from "@/data/seed/merchants";
import { products } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import { buildEvents } from "@/data/seed/events";
import { buildOffers } from "@/data/seed/offers";
import type { CitySnapshot } from "@/lib/data/types";
import { buildCityIndex } from "./cityIndex";
import {
  CARRIAGEWAY_WIDTH,
  buildStreetLayout,
  getStreetLayout,
  parcelAabb,
  pointInAabb,
  segmentLength,
  segmentYaw,
  type RoadSegment,
} from "./layout";

const NOW = new Date("2026-09-30T20:00:00Z");

function snapshot(): CitySnapshot {
  return {
    districts,
    parcels,
    merchants,
    products,
    employees,
    events: buildEvents(NOW),
    offers: buildOffers(NOW),
    rewards,
    generatedAt: NOW.toISOString(),
  };
}

/** Point-in-rotated-rectangle test for a road segment of the given width. */
function onRoad(p: { x: number; z: number }, seg: RoadSegment): boolean {
  const len = segmentLength(seg);
  const yaw = segmentYaw(seg);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dx = p.x - seg.x1;
  const dz = p.z - seg.z1;
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  return along >= 0 && along <= len && Math.abs(across) <= seg.width / 2;
}

describe("buildStreetLayout", () => {
  const index = buildCityIndex(snapshot());
  const layout = buildStreetLayout(index);
  const footprints = parcels.map((p) => parcelAabb(p));
  const props = [
    ...layout.lampPositions.map((p) => ({ ...p, kind: "lamp" })),
    ...layout.treePositions.map((p) => ({ ...p, kind: "tree" })),
    ...layout.benchPoses.map((p) => ({ ...p, kind: "bench" })),
    ...layout.planterPositions.map((p) => ({ ...p, kind: "planter" })),
    ...layout.bollards.map((p) => ({ ...p, kind: "bollard" })),
  ];

  it("derives one road per street district plus the avenue to Event Square", () => {
    expect(layout.roads.length).toBe(3);
    for (const road of layout.roads) expect(road.width).toBe(CARRIAGEWAY_WIDTH);
    // Food Street runs east along +X at z = 0; Fashion Street west; the avenue north along -Z.
    const east = layout.roads.find((r) => r.x2 > 100);
    const west = layout.roads.find((r) => r.x2 < -100);
    const north = layout.roads.find((r) => r.z2 < -60);
    expect(east?.z1).toBe(0);
    expect(west?.z1).toBe(0);
    expect(north?.x1).toBe(0);
    // The avenue stops at the venue's front edge instead of running through it.
    expect(north?.z2).toBeCloseTo(-88, 5);
  });

  it("places the plaza at the origin with a sensible radius", () => {
    expect(layout.plaza).toEqual({ x: 0, z: 0, radius: 30 });
  });

  it("produces props of every kind", () => {
    expect(layout.lampPositions.length).toBeGreaterThan(20);
    expect(layout.treePositions.length).toBeGreaterThan(10);
    expect(layout.benchPoses.length).toBeGreaterThanOrEqual(8);
    expect(layout.planterPositions.length).toBeGreaterThanOrEqual(6);
    expect(layout.bollards.length).toBeGreaterThanOrEqual(12);
    expect(layout.crosswalks.length).toBeGreaterThanOrEqual(3);
  });

  it("never puts a prop inside a parcel footprint", () => {
    for (const prop of props) {
      const inside = footprints.find((box) => pointInAabb(prop, box));
      expect(inside, `${prop.kind} at (${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}) is inside ${inside?.id}`).toBeUndefined();
    }
  });

  it("never puts a prop on the asphalt", () => {
    for (const prop of props) {
      const hit = layout.roads.find((road) => onRoad(prop, road));
      expect(hit, `${prop.kind} at (${prop.x.toFixed(1)}, ${prop.z.toFixed(1)}) is on a road`).toBeUndefined();
    }
  });

  it("keeps sidewalks and forecourts off the asphalt centre line", () => {
    for (const walk of layout.sidewalks) {
      for (const road of layout.roads) {
        const c = { x: (walk.x1 + walk.x2) / 2, z: (walk.z1 + walk.z2) / 2 };
        if (walk.kind === "strip") expect(onRoad(c, road)).toBe(false);
      }
    }
    expect(layout.sidewalks.filter((s) => s.kind === "forecourt").length).toBe(
      parcels.filter((p) => p.tier !== "billboard").length,
    );
  });

  it("builds walkable NPC loops that stay off parcels", () => {
    expect(layout.npcPaths.length).toBeGreaterThanOrEqual(4);
    for (const path of layout.npcPaths) {
      expect(path.length).toBeGreaterThanOrEqual(3);
      for (const p of path) {
        expect(footprints.some((box) => pointInAabb(p, box)), `waypoint (${p.x}, ${p.z}) inside a parcel`).toBe(false);
      }
    }
  });

  it("emits colliders for the fountain, every prop and every billboard", () => {
    const ids = layout.environmentColliders.map((c) => c.id);
    expect(ids).toContain("fountain");
    expect(ids.filter((id) => id.startsWith("lamp:")).length).toBe(layout.lampPositions.length);
    expect(ids.filter((id) => id.startsWith("tree:")).length).toBe(layout.treePositions.length);
    expect(ids.filter((id) => id.startsWith("parcel:")).length).toBe(parcels.filter((p) => p.tier === "billboard").length);
    for (const c of layout.environmentColliders) {
      expect(c.maxX).toBeGreaterThan(c.minX);
      expect(c.maxZ).toBeGreaterThan(c.minZ);
    }
  });

  it("is deterministic and memoised per index", () => {
    expect(buildStreetLayout(index)).toEqual(layout);
    expect(getStreetLayout(index)).toBe(getStreetLayout(index));
    expect(getStreetLayout(buildCityIndex(snapshot()))).toEqual(layout);
  });
});
