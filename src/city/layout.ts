import type { Parcel, Pose2, Vec2 } from "@/types/domain";
import { aabbFromCenter, type AABB } from "@/engine/physics/types";
import { mulberry32 } from "@/engine/environment/prng";
import type { CityIndex } from "./cityIndex";

/**
 * Pure, deterministic street layout derived from the city data: where the roads, sidewalks,
 * crosswalks, lamps, trees, benches, planters, bollards and ambient walking loops are. Nothing
 * here is hand-placed; move a district or a parcel in the seed and the street follows.
 *
 * Conventions: 1 unit = 1 m, XZ ground plane, yaw 0 faces +Z, forward = (sin yaw, cos yaw).
 */

/** Total street width between opposite parcel fronts (the seed places fronts at ±7 m). */
export const STREET_WIDTH = 14;
/** Asphalt part of the street. */
export const CARRIAGEWAY_WIDTH = 8;
/** Raised pavement each side; overlaps the parcel front by `FACADE_SETBACK` so façades sit on it. */
export const SIDEWALK_WIDTH = 4.5;
export const SIDEWALK_HEIGHT = 0.12;
/** Distance from the parcel's front edge to the building façade (templates honour this). */
export const FACADE_SETBACK = 1.5;
export const LAMP_SPACING = 12;
export const FOUNTAIN_RADIUS = 5.5;

export interface RoadSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export interface SidewalkStrip extends RoadSegment {
  /** `strip` runs along a road; `forecourt` is the paved apron in front of one parcel. */
  kind: "strip" | "forecourt";
}

export interface Crosswalk {
  x: number;
  z: number;
  /** Direction of travel along the road the crosswalk crosses. */
  yaw: number;
  /** Extent across the road (the carriageway width). */
  width: number;
  /** Extent along the road. */
  length: number;
}

export interface StreetLayout {
  roads: RoadSegment[];
  sidewalks: SidewalkStrip[];
  crosswalks: Crosswalk[];
  lampPositions: Vec2[];
  treePositions: Vec2[];
  benchPoses: Pose2[];
  planterPositions: Vec2[];
  bollards: Vec2[];
  npcPaths: Vec2[][];
  plaza: { x: number; z: number; radius: number };
  environmentColliders: AABB[];
}

interface RoadSpec {
  axis: "x" | "z";
  /** Constant coordinate of the centre line (z for an x-road, x for a z-road). */
  perp: number;
  /** Start (plaza end) and end (far end) along the axis; `dir` is the sign of travel. */
  a: number;
  b: number;
  dir: 1 | -1;
}

export function segmentLength(seg: RoadSegment): number {
  return Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1);
}

/** Yaw of travel from (x1,z1) to (x2,z2) under forward = (sin yaw, cos yaw). */
export function segmentYaw(seg: RoadSegment): number {
  return Math.atan2(seg.x2 - seg.x1, seg.z2 - seg.z1);
}

export function segmentCenter(seg: RoadSegment): Vec2 {
  return { x: (seg.x1 + seg.x2) / 2, z: (seg.z1 + seg.z2) / 2 };
}

export function parcelAabb(parcel: Parcel, margin = 0): AABB {
  return aabbFromCenter(
    `parcel:${parcel.id}`,
    parcel.position.x,
    parcel.position.z,
    parcel.size.width + margin * 2,
    parcel.size.depth + margin * 2,
    parcel.rotationY,
  );
}

export function pointInAabb(p: Vec2, box: AABB): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
}

function pointOn(road: RoadSpec, along: number, perpOffset: number): Vec2 {
  return road.axis === "x" ? { x: along, z: road.perp + perpOffset } : { x: road.perp + perpOffset, z: along };
}

function alongOf(road: RoadSpec, p: Vec2): number {
  return road.axis === "x" ? p.x : p.z;
}

function perpOf(road: RoadSpec, p: Vec2): number {
  return road.axis === "x" ? p.z : p.x;
}

function toSegment(road: RoadSpec, width: number, perpOffset = 0, inset = 0): RoadSegment {
  const p1 = pointOn(road, road.a + road.dir * inset, perpOffset);
  const p2 = pointOn(road, road.b - road.dir * inset, perpOffset);
  return { x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z, width };
}

function roadYaw(road: RoadSpec): number {
  const seg = toSegment(road, 1);
  return segmentYaw(seg);
}

function inRoadCorridor(road: RoadSpec, p: Vec2, halfWidth: number, alongMargin = 0): boolean {
  const along = alongOf(road, p);
  const lo = Math.min(road.a, road.b) - alongMargin;
  const hi = Math.max(road.a, road.b) + alongMargin;
  return along >= lo && along <= hi && Math.abs(perpOf(road, p) - road.perp) <= halfWidth;
}

/** The facing direction of a parcel's front in world space. */
function parcelFacing(parcel: Parcel): Vec2 {
  return { x: Math.sin(parcel.rotationY), z: Math.cos(parcel.rotationY) };
}

function deriveRoads(index: CityIndex, plaza: StreetLayout["plaza"]): RoadSpec[] {
  const roads: RoadSpec[] = [];
  const parcelsByDistrict: Record<string, Parcel[]> = {};
  for (const p of index.snapshot.parcels) (parcelsByDistrict[p.districtId] ??= []).push(p);

  for (const district of [...index.snapshot.districts].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const b = district.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const dx = cx - plaza.x;
    const dz = cz - plaza.z;
    if (Math.hypot(dx, dz) < plaza.radius) continue; // the plaza district itself
    const parcels = parcelsByDistrict[district.id] ?? [];
    const axis: "x" | "z" = Math.abs(dx) >= Math.abs(dz) ? "x" : "z";
    const dir: 1 | -1 = (axis === "x" ? dx : dz) >= 0 ? 1 : -1;

    // Centre line: mean of the front lines of parcels that face across the axis; else the plaza axis.
    const fronts: number[] = [];
    for (const p of parcels) {
      const f = parcelFacing(p);
      const facesAcross = axis === "x" ? Math.abs(f.z) > 0.5 : Math.abs(f.x) > 0.5;
      if (!facesAcross) continue;
      const front = axis === "x" ? p.position.z + f.z * (p.size.depth / 2) : p.position.x + f.x * (p.size.depth / 2);
      fronts.push(front);
    }
    const perp = fronts.length ? fronts.reduce((s, v) => s + v, 0) / fronts.length : axis === "x" ? plaza.z : plaza.x;

    const a = (axis === "x" ? plaza.x : plaza.z) + dir * plaza.radius;
    let end = axis === "x" ? (dir > 0 ? b.maxX : b.minX) : dir > 0 ? b.maxZ : b.minZ;
    // Stop at the first parcel that sits across the corridor (e.g. the venue at the end of an avenue).
    for (const p of parcels) {
      const box = parcelAabb(p);
      const perpMin = axis === "x" ? box.minZ : box.minX;
      const perpMax = axis === "x" ? box.maxZ : box.maxX;
      if (perpMax <= perp - STREET_WIDTH / 2 + 0.01 || perpMin >= perp + STREET_WIDTH / 2 - 0.01) continue;
      const near = axis === "x" ? (dir > 0 ? box.minX : box.maxX) : dir > 0 ? box.minZ : box.maxZ;
      if (dir > 0 ? near < end : near > end) end = near;
    }
    roads.push({ axis, perp, a, b: end, dir });
  }
  return roads;
}

const layoutCache = new WeakMap<CityIndex, StreetLayout>();

/** Memoised per CityIndex so the renderer, props and colliders share one derivation. */
export function getStreetLayout(index: CityIndex): StreetLayout {
  let layout = layoutCache.get(index);
  if (!layout) {
    layout = buildStreetLayout(index);
    layoutCache.set(index, layout);
  }
  return layout;
}

export function buildStreetLayout(index: CityIndex): StreetLayout {
  const parcels = index.snapshot.parcels;
  const plazaDistrict =
    index.snapshot.districts.find((d) => d.bounds.minX <= 0 && d.bounds.maxX >= 0 && d.bounds.minZ <= 0 && d.bounds.maxZ >= 0) ??
    null;
  const plaza = plazaDistrict
    ? {
        x: (plazaDistrict.bounds.minX + plazaDistrict.bounds.maxX) / 2,
        z: (plazaDistrict.bounds.minZ + plazaDistrict.bounds.maxZ) / 2,
        radius:
          Math.min(
            plazaDistrict.bounds.maxX - plazaDistrict.bounds.minX,
            plazaDistrict.bounds.maxZ - plazaDistrict.bounds.minZ,
          ) * 0.375,
      }
    : { x: 0, z: 0, radius: 30 };

  const roadSpecs = deriveRoads(index, plaza);
  const parcelBoxes = parcels.map((p) => parcelAabb(p, 0.3));
  const occupiedParcels = parcels.filter((p) => p.merchantId && p.tier !== "billboard");
  const rand = mulberry32(0x5eed);

  const blocked = (p: Vec2): boolean =>
    parcelBoxes.some((box) => pointInAabb(p, box)) ||
    roadSpecs.some((r) => inRoadCorridor(r, p, CARRIAGEWAY_WIDTH / 2 + 0.25, 0.5));

  const roads: RoadSegment[] = roadSpecs.map((r) => toSegment(r, CARRIAGEWAY_WIDTH));
  const sidewalks: SidewalkStrip[] = [];
  const crosswalks: Crosswalk[] = [];
  const lampPositions: Vec2[] = [];
  const treePositions: Vec2[] = [];
  const benchPoses: Pose2[] = [];
  const planterPositions: Vec2[] = [];
  const bollards: Vec2[] = [];
  const npcPaths: Vec2[][] = [];

  const sidewalkPerp = CARRIAGEWAY_WIDTH / 2 + SIDEWALK_WIDTH / 2;
  const lampPerp = CARRIAGEWAY_WIDTH / 2 + 0.7;
  const treePerp = CARRIAGEWAY_WIDTH / 2 + 1.25;
  const planterPerp = CARRIAGEWAY_WIDTH / 2 + SIDEWALK_WIDTH - 0.8;

  for (const road of roadSpecs) {
    const length = Math.abs(road.b - road.a);
    const yaw = roadYaw(road);
    for (const side of [-1, 1] as const) {
      sidewalks.push({ ...toSegment(road, SIDEWALK_WIDTH, side * sidewalkPerp), kind: "strip" });
    }

    // Crosswalk at the plaza end.
    const first = pointOn(road, road.a + road.dir * 2.5, 0);
    crosswalks.push({ x: first.x, z: first.z, yaw, width: CARRIAGEWAY_WIDTH, length: 3 });

    // Mid-block crosswalk in the widest gap between parcel fronts along this road.
    const spans = parcels
      .filter((p) => inRoadCorridor(road, p.position, STREET_WIDTH / 2 + p.size.depth, 0))
      .map((p) => {
        const box = parcelAabb(p);
        return road.axis === "x" ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
      })
      .sort((s, t) => (s[0] ?? 0) - (t[0] ?? 0));
    let bestGap: { center: number; size: number } | null = null;
    let reach = -Infinity;
    for (const span of spans) {
      const [lo, hi] = [span[0] ?? 0, span[1] ?? 0];
      if (reach > -Infinity && lo - reach >= 6) {
        const size = lo - reach;
        if (!bestGap || size > bestGap.size) bestGap = { center: (lo + reach) / 2, size };
      }
      reach = Math.max(reach, hi);
    }
    if (bestGap && Math.abs(bestGap.center - road.a) > 12 && Math.abs(bestGap.center - road.b) > 8) {
      const mid = pointOn(road, bestGap.center, 0);
      crosswalks.push({ x: mid.x, z: mid.z, yaw, width: CARRIAGEWAY_WIDTH, length: 3 });
    }

    // Lamps every LAMP_SPACING on both curbs, trees halfway between them.
    for (let d = 6; d < length - 2; d += LAMP_SPACING) {
      const along = road.a + road.dir * d;
      for (const side of [-1, 1] as const) {
        lampPositions.push(pointOn(road, along, side * lampPerp));
        const treeAlong = along + road.dir * (LAMP_SPACING / 2) + (rand() - 0.5) * 0.8;
        if (Math.abs(treeAlong - road.a) < length - 3) {
          const tree = pointOn(road, treeAlong, side * treePerp);
          // Keep doors clear: no tree within 3.5 m of a storefront's centre line on that side.
          const nearDoor = occupiedParcels.some(
            (p) =>
              Math.sign(perpOf(road, p.position) - road.perp) === side &&
              inRoadCorridor(road, p.position, STREET_WIDTH / 2 + p.size.depth, 0) &&
              Math.abs(alongOf(road, p.position) - treeAlong) < 3.5,
          );
          if (!nearDoor) treePositions.push(tree);
        }
      }
    }

    // Planters flanking the plaza-end crosswalk, at the back of the sidewalk.
    for (const side of [-1, 1] as const) {
      planterPositions.push(pointOn(road, road.a + road.dir * 5.5, side * planterPerp));
    }

    // Ambient walking loop: up one sidewalk, cross at the end, back down the other.
    npcPaths.push([
      pointOn(road, road.a + road.dir * 4, sidewalkPerp),
      pointOn(road, road.b - road.dir * 4, sidewalkPerp),
      pointOn(road, road.b - road.dir * 4, -sidewalkPerp),
      pointOn(road, road.a + road.dir * 4, -sidewalkPerp),
    ]);
  }

  // Bollards guard every crosswalk's four corners.
  for (const cw of crosswalks) {
    const fx = Math.sin(cw.yaw);
    const fz = Math.cos(cw.yaw);
    const rx = fz;
    const rz = -fx;
    for (const s of [-1, 1] as const) {
      for (const t of [-1, 1] as const) {
        const along = s * (cw.length / 2 + 0.5);
        const across = t * (cw.width / 2 + 0.6);
        bollards.push({ x: cw.x + fx * along + rx * across, z: cw.z + fz * along + rz * across });
      }
    }
  }

  // Forecourt aprons in front of every non-billboard parcel (pavement up to the façade).
  for (const p of parcels) {
    if (p.tier === "billboard") continue;
    const f = parcelFacing(p);
    const frontCenter = { x: p.position.x + f.x * (p.size.depth / 2), z: p.position.z + f.z * (p.size.depth / 2) };
    const halfW = p.size.width / 2;
    const rx = f.z;
    const rz = -f.x;
    const apron = FACADE_SETBACK;
    const centre = { x: frontCenter.x - f.x * (apron / 2 - 0.75), z: frontCenter.z - f.z * (apron / 2 - 0.75) };
    sidewalks.push({
      kind: "forecourt",
      x1: centre.x - rx * halfW,
      z1: centre.z - rz * halfW,
      x2: centre.x + rx * halfW,
      z2: centre.z + rz * halfW,
      width: apron + 1.5,
    });
  }

  // Plaza furniture: lamps on the outer ring, benches facing the fountain, planters between.
  const ring = (count: number, radius: number, offset: number, fn: (p: Vec2, angle: number) => void) => {
    for (let i = 0; i < count; i++) {
      const angle = offset + (i / count) * Math.PI * 2;
      fn({ x: plaza.x + Math.sin(angle) * radius, z: plaza.z + Math.cos(angle) * radius }, angle);
    }
  };
  ring(12, plaza.radius - 3, 0, (p) => {
    if (!blocked(p) && !roadSpecs.some((r) => inRoadCorridor(r, p, STREET_WIDTH / 2 + 2, 6))) lampPositions.push(p);
  });
  ring(8, 13, Math.PI / 8, (p) => {
    if (!blocked(p)) benchPoses.push({ x: p.x, z: p.z, yaw: Math.atan2(plaza.x - p.x, plaza.z - p.z) });
  });
  ring(4, plaza.radius - 7, Math.PI / 4, (p) => {
    if (!blocked(p)) benchPoses.push({ x: p.x, z: p.z, yaw: Math.atan2(plaza.x - p.x, plaza.z - p.z) });
  });
  ring(8, 19, 0, (p) => {
    if (!blocked(p) && !roadSpecs.some((r) => inRoadCorridor(r, p, STREET_WIDTH / 2 + 1, 4))) planterPositions.push(p);
  });
  ring(8, plaza.radius - 8, Math.PI / 8, (p) => {
    if (!blocked(p) && !roadSpecs.some((r) => inRoadCorridor(r, p, STREET_WIDTH / 2, 4))) treePositions.push(p);
  });

  // Plaza stroll loop and one cross-city loop that links the two streets through the plaza.
  const stroll: Vec2[] = [];
  ring(8, 16, Math.PI / 16, (p) => stroll.push(p));
  npcPaths.push(stroll);
  const xRoads = roadSpecs.filter((r) => r.axis === "x");
  if (xRoads.length >= 2) {
    const east = xRoads.find((r) => r.dir > 0);
    const west = xRoads.find((r) => r.dir < 0);
    if (east && west) {
      npcPaths.push([
        pointOn(west, west.b + 6, -sidewalkPerp),
        pointOn(east, east.b - 6, -sidewalkPerp),
        pointOn(east, east.b - 6, sidewalkPerp),
        pointOn(west, west.b + 6, sidewalkPerp),
      ]);
    }
  }

  // Final safety pass: nothing stands inside a parcel or on the asphalt.
  const keep = <T extends Vec2>(items: T[]): T[] => items.filter((p) => !blocked(p));
  // Lamps also stay clear of crosswalk bollards.
  const lamps = keep(lampPositions).filter((p) => !crosswalks.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 5.5));
  const trees = keep(treePositions);
  const benches = keep(benchPoses);
  const planters = keep(planterPositions);
  const posts = keep(bollards);

  const environmentColliders: AABB[] = [
    aabbFromCenter("fountain", plaza.x, plaza.z, FOUNTAIN_RADIUS * 2 + 0.4, FOUNTAIN_RADIUS * 2 + 0.4),
    ...lamps.map((p, i) => aabbFromCenter(`lamp:${i}`, p.x, p.z, 0.5, 0.5)),
    ...trees.map((p, i) => aabbFromCenter(`tree:${i}`, p.x, p.z, 0.7, 0.7)),
    ...benches.map((p, i) => aabbFromCenter(`bench:${i}`, p.x, p.z, 1.9, 0.7, p.yaw)),
    ...planters.map((p, i) => aabbFromCenter(`planter:${i}`, p.x, p.z, 1.4, 1.4)),
    ...posts.map((p, i) => aabbFromCenter(`bollard:${i}`, p.x, p.z, 0.35, 0.35)),
    ...parcels.filter((p) => p.tier === "billboard").map((p) => parcelAabb(p)),
  ];

  return {
    roads,
    sidewalks,
    crosswalks,
    lampPositions: lamps,
    treePositions: trees,
    benchPoses: benches,
    planterPositions: planters,
    bollards: posts,
    npcPaths,
    plaza,
    environmentColliders,
  };
}
