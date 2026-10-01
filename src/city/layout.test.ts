/* eslint-disable no-restricted-imports -- test only: seed modules never reach the client bundle */
import { describe, expect, it } from "vitest";
import { districts, parcels } from "@/data/seed/districts";
import { employees, merchants } from "@/data/seed/merchants";
import { products } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import { buildEvents } from "@/data/seed/events";
import { buildOffers } from "@/data/seed/offers";
import type { CitySnapshot } from "@/lib/data/types";
import { PLAYER_RADIUS } from "@/engine/player/PlayerController";
import { buildCityIndex } from "./cityIndex";
import {
  CARRIAGEWAY_WIDTH,
  POPUP_FRONT_CLEARANCE,
  STAGE_DEPTH,
  STAGE_WIDTH,
  buildStreetLayout,
  eventCrowdSpots,
  getStreetLayout,
  parcelAabb,
  parcelFacing,
  parcelFrontCenter,
  pointInAabb,
  pointOnSegment,
  segmentLength,
  segmentYaw,
  stageAabb,
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
    ...layout.vents.map((p) => ({ ...p, kind: "vent" })),
    ...layout.idleGroups.map((p) => ({ ...p, kind: "idle-group" })),
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
    // Each road carries the district whose pavement and accent it takes.
    const byId = Object.fromEntries(districts.map((d) => [d.id, d.slug]));
    expect(byId[east?.districtId ?? ""]).toBe("food-street");
    expect(byId[west?.districtId ?? ""]).toBe("fashion-street");
    expect(byId[north?.districtId ?? ""]).toBe("event-square");
  });

  it("places the plaza at the origin with a sensible radius", () => {
    expect(layout.plaza).toEqual({ x: 0, z: 0, radius: 30 });
  });

  it("produces props of every kind", () => {
    expect(layout.lampPositions.length).toBeGreaterThan(20);
    expect(layout.lamps.length).toBe(layout.lampPositions.length);
    expect(layout.treePositions.length).toBeGreaterThan(10);
    expect(layout.benchPoses.length).toBeGreaterThanOrEqual(8);
    expect(layout.planterPositions.length).toBeGreaterThanOrEqual(6);
    expect(layout.bollards.length).toBeGreaterThanOrEqual(12);
    expect(layout.crosswalks.length).toBeGreaterThanOrEqual(3);
    expect(layout.manholes.length).toBeGreaterThanOrEqual(6);
    expect(layout.drains.length).toBeGreaterThanOrEqual(12);
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

  it("puts street ironwork on the asphalt and nothing else", () => {
    for (const m of layout.manholes) expect(layout.roads.some((r) => onRoad(m, r)), `manhole (${m.x}, ${m.z})`).toBe(true);
    for (const d of layout.drains) expect(layout.roads.some((r) => onRoad(d, r)), `drain (${d.x}, ${d.z})`).toBe(true);
    for (const m of layout.manholes) {
      expect(layout.crosswalks.some((c) => Math.hypot(c.x - m.x, c.z - m.z) < 4.5)).toBe(false);
    }
  });

  it("keeps sidewalks and forecourts off the asphalt centre line", () => {
    for (const walk of layout.sidewalks) {
      for (const road of layout.roads) {
        const c = { x: (walk.x1 + walk.x2) / 2, z: (walk.z1 + walk.z2) / 2 };
        if (walk.kind === "strip") expect(onRoad(c, road)).toBe(false);
      }
    }
    const forecourts = layout.sidewalks.filter((s) => s.kind === "forecourt");
    expect(forecourts.length).toBe(parcels.filter((p) => p.tier !== "billboard").length);
    for (const f of forecourts) expect(f.parcelId && parcels.some((p) => p.id === f.parcelId && p.districtId === f.districtId)).toBe(true);
  });

  it("puts steam grates outside restaurants only, on their district's pavement", () => {
    const restaurants = parcels.filter((p) => merchants.some((m) => m.id === p.merchantId && m.merchantType === "restaurant"));
    expect(layout.vents.length).toBe(restaurants.length);
    for (const v of layout.vents) {
      const near = restaurants.find((p) => Math.hypot(p.position.x - v.x, p.position.z - v.z) < 12);
      expect(near, `vent (${v.x.toFixed(1)}, ${v.z.toFixed(1)}) has no restaurant nearby`).toBeDefined();
    }
  });

  it("scatters idle groups on the plaza and along the streets, clear of furniture", () => {
    const plazaId = districts.find((d) => d.slug === "central-plaza")!.id;
    expect(layout.idleGroups.filter((g) => g.districtId === plazaId).length).toBeGreaterThanOrEqual(3);
    expect(layout.idleGroups.filter((g) => g.districtId !== plazaId).length).toBeGreaterThanOrEqual(3);
    const furniture = [...layout.lampPositions, ...layout.treePositions, ...layout.benchPoses, ...layout.planterPositions, ...layout.bollards];
    for (const g of layout.idleGroups) {
      expect(g.size).toBeGreaterThanOrEqual(2);
      expect(furniture.some((f) => Math.hypot(f.x - g.x, f.z - g.z) < 1.5), `group at (${g.x.toFixed(1)}, ${g.z.toFixed(1)}) overlaps furniture`).toBe(false);
    }
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

  it("emits colliders for the fountain, the stage, every prop and every billboard", () => {
    const ids = layout.environmentColliders.map((c) => c.id);
    expect(ids).toContain("fountain");
    expect(ids).toContain("stage");
    expect(ids.filter((id) => id.startsWith("lamp:")).length).toBe(layout.lampPositions.length);
    expect(ids.filter((id) => id.startsWith("tree:")).length).toBe(layout.treePositions.length);
    expect(ids.filter((id) => id.startsWith("parcel:")).length).toBe(parcels.filter((p) => p.tier === "billboard").length);
    for (const c of layout.environmentColliders) {
      expect(c.maxX).toBeGreaterThan(c.minX);
      expect(c.maxZ).toBeGreaterThan(c.minZ);
    }
  });

  it("keeps every district spawn point clear of colliders", () => {
    for (const d of districts) {
      const s = d.spawnPoint;
      if (!s) continue;
      const hit = layout.environmentColliders.find(
        (c) => s.x + PLAYER_RADIUS + 0.5 > c.minX && s.x - PLAYER_RADIUS - 0.5 < c.maxX && s.z + PLAYER_RADIUS + 0.5 > c.minZ && s.z - PLAYER_RADIUS - 0.5 < c.maxZ,
      );
      expect(hit, `${d.slug} spawn blocked by ${hit?.id}`).toBeUndefined();
    }
  });

  it("is deterministic and memoised per index", () => {
    expect(buildStreetLayout(index)).toEqual(layout);
    expect(getStreetLayout(index)).toBe(getStreetLayout(index));
    expect(getStreetLayout(buildCityIndex(snapshot()))).toEqual(layout);
  });
});

describe("event stage and crowd", () => {
  const index = buildCityIndex(snapshot());
  const layout = buildStreetLayout(index);
  const venue = parcels.find((p) => p.tier === "venue")!;
  const popup = parcels.find((p) => p.slug === "es-pop1")!;

  it("derives a stage beside the avenue in front of the venue, facing the square", () => {
    const stage = layout.stage!;
    expect(stage).toBeTruthy();
    expect(stage.venueParcelId).toBe(venue.id);
    expect(stage.width).toBe(STAGE_WIDTH);
    expect(stage.depth).toBe(STAGE_DEPTH);
    expect(stage.yaw).toBe(venue.rotationY);
    // In front of the venue (south of its front edge at z = -88), beside the avenue, inside the district.
    const box = stageAabb(stage);
    expect(box.minZ).toBeGreaterThan(-88);
    expect(box.minX).toBeGreaterThan(CARRIAGEWAY_WIDTH / 2 + 4.5);
    const district = districts.find((d) => d.id === venue.districtId)!;
    expect(box.minX).toBeGreaterThanOrEqual(district.bounds.minX);
    expect(box.maxX).toBeLessThanOrEqual(district.bounds.maxX);
    expect(box.minZ).toBeGreaterThanOrEqual(district.bounds.minZ);
    expect(box.maxZ).toBeLessThanOrEqual(district.bounds.maxZ);
    for (const p of parcels) {
      const pb = parcelAabb(p);
      const overlap = box.minX < pb.maxX && box.maxX > pb.minX && box.minZ < pb.maxZ && box.maxZ > pb.minZ;
      expect(overlap, `stage overlaps ${p.slug}`).toBe(false);
    }
    for (const road of layout.roads) {
      for (const corner of [
        { x: box.minX, z: box.minZ },
        { x: box.maxX, z: box.minZ },
        { x: box.minX, z: box.maxZ },
        { x: box.maxX, z: box.maxZ },
      ]) {
        expect(pointOnSegment(corner, road, 4.5), `stage corner on ${road.districtId}'s road`).toBe(false);
      }
    }
  });

  it("keeps the pop-up's front clear of props, crowds and the stage", () => {
    const f = parcelFacing(popup);
    const front = parcelFrontCenter(popup);
    const inApron = (p: { x: number; z: number }) => {
      const dx = p.x - front.x;
      const dz = p.z - front.z;
      const along = dx * f.x + dz * f.z;
      const across = Math.abs(dx * f.z - dz * f.x);
      return along >= -0.01 && along <= POPUP_FRONT_CLEARANCE && across <= popup.size.width / 2;
    };
    const everything = [
      ...layout.lampPositions,
      ...layout.treePositions,
      ...layout.benchPoses,
      ...layout.planterPositions,
      ...layout.bollards,
      ...layout.idleGroups,
      ...eventCrowdSpots(layout, index, popup, 30),
    ];
    for (const p of everything) expect(inApron(p), `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) blocks the pop-up front`).toBe(false);
    const box = stageAabb(layout.stage!);
    expect(inApron({ x: box.minX, z: box.minZ }) || inApron({ x: box.maxX, z: box.maxZ })).toBe(false);
  });

  it("gathers a crowd in front of the pop-up, facing it, off parcels, roads and the stage", () => {
    const spots = eventCrowdSpots(layout, index, popup, 20);
    expect(spots.length).toBeGreaterThanOrEqual(12);
    const f = parcelFacing(popup);
    const front = parcelFrontCenter(popup);
    const stageBox = stageAabb(layout.stage!);
    for (const s of spots) {
      expect(parcels.some((p) => pointInAabb(s, parcelAabb(p))), `spot (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) inside a parcel`).toBe(false);
      expect(layout.roads.some((r) => pointOnSegment(s, r)), `spot (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) on a road`).toBe(false);
      expect(pointInAabb(s, stageBox)).toBe(false);
      // In front of the pop-up (positive distance along its facing) and looking back at it.
      const along = (s.x - front.x) * f.x + (s.z - front.z) * f.z;
      expect(along).toBeGreaterThan(POPUP_FRONT_CLEARANCE);
      const look = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      expect(look.x * f.x + look.z * f.z).toBeLessThan(-0.5);
    }
    // No two people share a spot.
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThanOrEqual(0.9);
      }
    }
    expect(eventCrowdSpots(layout, index, popup, 20)).toEqual(spots);
    expect(eventCrowdSpots(layout, index, popup, 0)).toEqual([]);
  });

  it("gathers a venue crowd in front of the stage instead of inside the hall", () => {
    const spots = eventCrowdSpots(layout, index, venue, 16);
    expect(spots.length).toBeGreaterThanOrEqual(10);
    const stage = layout.stage!;
    const f = { x: Math.sin(stage.yaw), z: Math.cos(stage.yaw) };
    const frontZ = stage.z + f.z * (stage.depth / 2);
    for (const s of spots) {
      expect(pointInAabb(s, parcelAabb(venue))).toBe(false);
      expect((s.z - frontZ) * f.z).toBeGreaterThan(2);
      expect(Math.abs(s.x - stage.x)).toBeLessThan(stage.width / 2 + 3.5);
    }
  });
});
