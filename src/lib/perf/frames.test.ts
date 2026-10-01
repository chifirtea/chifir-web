import { describe, expect, it } from "vitest";
import { FrameStats } from "./frames";

describe("FrameStats", () => {
  it("computes percentiles and long-frame counts over the ring", () => {
    const s = new FrameStats({ capacity: 100, longFrameMs: 50 });
    let t = 0;
    for (let i = 0; i < 95; i++) {
      t += 16.7;
      s.push(16.7, t);
    }
    for (let i = 0; i < 5; i++) {
      t += 80;
      s.push(80, t);
    }
    const sum = s.summary(t);
    expect(sum.samples).toBe(100);
    expect(sum.p50Ms).toBe(16.7);
    expect(sum.p95Ms).toBe(16.7);
    expect(sum.p99Ms).toBe(80);
    expect(sum.longFrames).toBe(5);
  });

  it("counts frames in the last second and ignores tab-switch gaps", () => {
    const s = new FrameStats({ capacity: 64 });
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 33.3;
      s.push(33.3, t);
    }
    expect(s.summary(t).fps1s).toBe(30);
    s.push(8000, t + 8000); // ignored
    expect(s.summary(t).samples).toBe(30);
    s.push(-1, t); // ignored
    expect(s.summary(t).samples).toBe(30);
  });

  it("wraps around once the ring is full", () => {
    const s = new FrameStats({ capacity: 16 });
    for (let i = 1; i <= 40; i++) s.push(i, i * 10);
    const sum = s.summary(400);
    expect(sum.samples).toBe(16);
    expect(sum.p50Ms).toBeGreaterThanOrEqual(25); // only the last 16 frames (25..40) remain
  });
});
