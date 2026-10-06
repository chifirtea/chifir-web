import { describe, expect, it } from "vitest";
import {
  createBuffer,
  DESPAWN_MS,
  isSilent,
  latestSample,
  lerpAngle,
  MAX_EXTRAPOLATION_MS,
  pushSample,
  sampleAt,
  type InterpolatedPose,
} from "./interpolation";

const out = (): InterpolatedPose => ({ x: 0, z: 0, yaw: 0, speed: 0 });
const sample = (t: number, x: number, z: number, yaw = 0, moving = true) => ({ t, x, z, yaw, moving });

describe("sampleAt", () => {
  it("returns false on an empty buffer and holds a single sample", () => {
    const buf = createBuffer();
    const o = out();
    expect(sampleAt(buf, 100, o)).toBe(false);
    pushSample(buf, sample(1000, 3, 4, 0.5));
    expect(sampleAt(buf, 5000, o)).toBe(true);
    expect(o).toMatchObject({ x: 3, z: 4, yaw: 0.5, speed: 0 });
  });

  it("interpolates position linearly and reports the implied speed", () => {
    const buf = createBuffer();
    pushSample(buf, sample(1000, 0, 0));
    pushSample(buf, sample(1100, 1, 0));
    const o = out();
    sampleAt(buf, 1050, o);
    expect(o.x).toBeCloseTo(0.5);
    expect(o.z).toBeCloseTo(0);
    expect(o.speed).toBeCloseTo(10); // 1 m in 100 ms
  });

  it("takes the shortest arc for yaw across the ±PI seam", () => {
    const buf = createBuffer();
    pushSample(buf, sample(0, 0, 0, Math.PI - 0.1));
    pushSample(buf, sample(100, 0, 0, -Math.PI + 0.1));
    const o = out();
    sampleAt(buf, 50, o);
    // Halfway between 3.04 and -3.04 the short way is exactly ±PI, never 0.
    expect(Math.abs(Math.abs(o.yaw) - Math.PI)).toBeLessThan(1e-6);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
    expect(lerpAngle(-3, 3, 0.5)).toBeCloseTo(-Math.PI, 5);
  });

  it("holds before the first sample", () => {
    const buf = createBuffer();
    pushSample(buf, sample(1000, 5, 5, 1));
    pushSample(buf, sample(1100, 6, 5, 1));
    const o = out();
    sampleAt(buf, 500, o);
    expect(o).toMatchObject({ x: 5, z: 5, yaw: 1, speed: 0 });
  });

  it("extrapolates at constant velocity for at most 200 ms, then holds", () => {
    const buf = createBuffer();
    pushSample(buf, sample(1000, 0, 0));
    pushSample(buf, sample(1100, 1, 0)); // 10 m/s along x
    const o = out();
    sampleAt(buf, 1200, o);
    expect(o.x).toBeCloseTo(2);
    expect(o.speed).toBeCloseTo(10);
    sampleAt(buf, 1100 + MAX_EXTRAPOLATION_MS + 500, o);
    expect(o.x).toBeCloseTo(1 + 10 * (MAX_EXTRAPOLATION_MS / 1000));
    expect(o.speed).toBe(0);
  });

  it("does not extrapolate a peer that reported standing still", () => {
    const buf = createBuffer();
    pushSample(buf, sample(1000, 0, 0));
    pushSample(buf, sample(1100, 1, 0, 0, false));
    const o = out();
    sampleAt(buf, 1250, o);
    expect(o.x).toBeCloseTo(1);
    expect(o.speed).toBe(0);
  });
});

describe("pushSample", () => {
  it("ignores out-of-order samples", () => {
    const buf = createBuffer();
    expect(pushSample(buf, sample(1000, 0, 0))).toBe(true);
    expect(pushSample(buf, sample(900, 9, 9))).toBe(false);
    expect(pushSample(buf, sample(1000, 9, 9))).toBe(false);
    expect(buf.samples).toHaveLength(1);
  });

  it("snaps (clears history) when a sample jumps more than 8 m", () => {
    const buf = createBuffer();
    pushSample(buf, sample(1000, 0, 0));
    pushSample(buf, sample(1100, 0.5, 0));
    pushSample(buf, sample(1200, 50, 50));
    expect(buf.samples).toHaveLength(1);
    expect(latestSample(buf)).toMatchObject({ x: 50, z: 50 });
    const o = out();
    sampleAt(buf, 1150, o);
    expect(o).toMatchObject({ x: 50, z: 50 });
  });

  it("keeps the buffer short", () => {
    const buf = createBuffer();
    for (let i = 0; i < 100; i++) pushSample(buf, sample(i * 100, i * 0.1, 0));
    expect(buf.samples.length).toBeLessThanOrEqual(24);
    // Still has the two newest.
    expect(latestSample(buf)?.t).toBe(9900);
    expect(buf.samples[0]!.t).toBeGreaterThanOrEqual(9900 - 1500);
  });
});

describe("despawn", () => {
  it("counts a peer as silent after DESPAWN_MS", () => {
    expect(isSilent(1000, 1000 + DESPAWN_MS)).toBe(false);
    expect(isSilent(1000, 1000 + DESPAWN_MS + 1)).toBe(true);
  });
});
