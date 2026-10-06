import { describe, expect, it } from "vitest";
import { resolveCircleAABB, segmentAABBEntry } from "./collision";
import type { AABB } from "./types";

const box = (id: string, minX: number, minZ: number, maxX: number, maxZ: number): AABB => ({
  id,
  minX,
  minZ,
  maxX,
  maxZ,
});

const wall = box("wall", 2, -5, 3, 5);

describe("resolveCircleAABB", () => {
  it("leaves a circle that overlaps nothing untouched", () => {
    const r = resolveCircleAABB(0, 0, 0.4, [wall]);
    expect(r).toEqual({ x: 0, z: 0, hits: [] });
  });

  it("treats touching as not colliding", () => {
    const r = resolveCircleAABB(2 - 0.4, 0, 0.4, [wall]);
    expect(r.x).toBe(1.6);
    expect(r.hits).toEqual([]);
  });

  it("pushes out along the requested axis toward the nearer face", () => {
    // Centre 0.1 m past the expanded -X face: back to exactly the face.
    const r = resolveCircleAABB(1.7, 0, 0.4, [wall], "x");
    expect(r.x).toBeCloseTo(1.6);
    expect(r.z).toBe(0);
    expect(r.hits).toEqual(["wall"]);
  });

  it("does not move the other axis when an axis is given", () => {
    // Deep in Z (the box is long in Z) but only just in X: an X pass must not touch Z.
    const r = resolveCircleAABB(1.7, 0.2, 0.4, [wall], "x");
    expect(r.z).toBe(0.2);
    expect(r.x).toBeCloseTo(1.6);
  });

  it("uses the smallest penetration when no axis is given", () => {
    // Inside the box, 0.3 from the -Z face and 0.8 from the -X face: leaves via -Z.
    const r = resolveCircleAABB(2.4, -5.1, 0.4, [wall]);
    expect(r.z).toBeCloseTo(-5.4);
    expect(r.x).toBe(2.4);
    expect(r.hits).toEqual(["wall"]);
  });

  it("escapes an inner corner formed by two boxes", () => {
    const boxes = [box("a", 0, 0, 4, 1), box("b", 0, 0, 1, 4)];
    // Inside both boxes' expanded volumes near the shared corner at (1, 1).
    const r = resolveCircleAABB(1.2, 1.2, 0.4, boxes);
    // Must end up outside both.
    for (const b of boxes) {
      const inside =
        r.x > b.minX - 0.4 && r.x < b.maxX + 0.4 && r.z > b.minZ - 0.4 && r.z < b.maxZ + 0.4;
      expect(inside).toBe(false);
    }
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("segmentAABBEntry", () => {
  it("returns 1 when the segment misses every box", () => {
    expect(segmentAABBEntry(0, 0, 0, -6, [wall])).toBe(1);
  });

  it("returns the entry parameter of the first box hit", () => {
    // From x=0 to x=4 along z=0: enters the wall at x=2 → t = 0.5.
    expect(segmentAABBEntry(0, 0, 4, 0, [wall])).toBeCloseTo(0.5);
  });

  it("handles axis-aligned segments (zero direction component)", () => {
    expect(segmentAABBEntry(2.5, -10, 2.5, 10, [wall])).toBeCloseTo(0.25);
    expect(segmentAABBEntry(10, -10, 10, 10, [wall])).toBe(1);
  });

  it("returns 0 when the segment starts inside a box", () => {
    expect(segmentAABBEntry(2.5, 0, 6, 0, [wall])).toBe(0);
  });

  it("ignores boxes smaller than minBoxSize on both axes", () => {
    const pole = box("pole", 1, -0.1, 1.2, 0.1);
    expect(segmentAABBEntry(0, 0, 4, 0, [pole], 1.5)).toBe(1);
    expect(segmentAABBEntry(0, 0, 4, 0, [pole])).toBeCloseTo(0.25);
  });
});
