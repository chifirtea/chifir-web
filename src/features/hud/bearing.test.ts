import { describe, expect, it } from "vitest";
import { bearingDegrees, formatDistance, normalizeDegrees } from "./bearing";

const origin = { x: 0, z: 0, yaw: 0 };

describe("bearingDegrees", () => {
  it("is 0 when the target is straight ahead", () => {
    expect(bearingDegrees(origin, { x: 0, z: 10 })).toBe(0);
  });

  it("is 180 when the target is behind", () => {
    expect(Math.abs(bearingDegrees(origin, { x: 0, z: -10 }))).toBe(180);
  });

  it("puts +X on the left when facing +Z (three.js handedness)", () => {
    expect(bearingDegrees(origin, { x: 10, z: 0 })).toBeCloseTo(-90);
    expect(bearingDegrees(origin, { x: -10, z: 0 })).toBeCloseTo(90);
  });

  it("is relative to the player's yaw", () => {
    // Facing +X (yaw PI/2): a target on +X is straight ahead, one on +Z is to the right.
    const facingX = { x: 0, z: 0, yaw: Math.PI / 2 };
    expect(bearingDegrees(facingX, { x: 10, z: 0 })).toBeCloseTo(0);
    expect(bearingDegrees(facingX, { x: 0, z: 10 })).toBeCloseTo(90);
  });

  it("uses the player's position, not the origin", () => {
    expect(bearingDegrees({ x: 50, z: 50, yaw: 0 }, { x: 50, z: 80 })).toBe(0);
    expect(bearingDegrees({ x: 50, z: 50, yaw: 0 }, { x: 20, z: 50 })).toBeCloseTo(90);
  });

  it("stays in (-180, 180] for large yaws", () => {
    const spun = { x: 0, z: 0, yaw: 7 * Math.PI };
    const deg = bearingDegrees(spun, { x: 0, z: 10 });
    expect(Math.abs(deg)).toBe(180);
    expect(bearingDegrees({ x: 0, z: 0, yaw: -4 * Math.PI }, { x: 0, z: 10 })).toBeCloseTo(0);
  });
});

describe("normalizeDegrees", () => {
  it("wraps into (-180, 180]", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(540)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
  });
});

describe("formatDistance", () => {
  it("rounds metres and switches to km", () => {
    expect(formatDistance(12.4)).toBe("12 m");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(-3)).toBe("0 m");
  });
});
