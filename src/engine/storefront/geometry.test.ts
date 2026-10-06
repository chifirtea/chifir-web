import { describe, expect, it } from "vitest";
import { evenlySpaced, scaleBoxUvs, tiledBox } from "./geometry";

describe("scaleBoxUvs", () => {
  it("tiles side faces by width/height and caps by width/depth", () => {
    const geo = tiledBox(12, 6, 9, 3);
    const uv = geo.attributes.uv!;
    const faceMax = (face: number) => {
      let u = 0;
      let v = 0;
      for (let i = face * 4; i < face * 4 + 4; i++) {
        u = Math.max(u, uv.getX(i));
        v = Math.max(v, uv.getY(i));
      }
      return [u, v];
    };
    expect(faceMax(0)).toEqual([3, 2]); // +x: depth 9 / 3, height 6 / 3
    expect(faceMax(2)).toEqual([4, 3]); // +y: width 12 / 3, depth 9 / 3
    expect(faceMax(4)).toEqual([4, 2]); // +z: width 12 / 3, height 6 / 3
  });

  it("is cached per size and never divides by a zero tile", () => {
    expect(tiledBox(4, 4, 4, 2)).toBe(tiledBox(4, 4, 4, 2));
    expect(tiledBox(4, 4, 4, 2)).not.toBe(tiledBox(4, 4, 4, 1));
    const uv = { count: 4, data: [0, 0, 1, 0, 0, 1, 1, 1], getX(i: number) { return this.data[i * 2]!; }, getY(i: number) { return this.data[i * 2 + 1]!; }, setXY(i: number, x: number, y: number) { this.data[i * 2] = x; this.data[i * 2 + 1] = y; } };
    scaleBoxUvs(uv, 2, 2, 2, 0);
    expect(Number.isFinite(uv.getX(1))).toBe(true);
  });
});

describe("evenlySpaced", () => {
  it("spreads items inclusively between the ends", () => {
    expect(evenlySpaced(-2, 2, 5)).toEqual([-2, -1, 0, 1, 2]);
    expect(evenlySpaced(-2, 2, 1)).toEqual([0]);
    expect(evenlySpaced(-2, 2, 0)).toEqual([]);
  });
});
