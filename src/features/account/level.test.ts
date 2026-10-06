import { describe, expect, it } from "vitest";
import { levelForXp, levelProgress, xpAtLevel, xpForNextLevel } from "./level";

describe("city level math", () => {
  it("matches the database formula: level = 1 + floor(sqrt(xp / 100))", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(399)).toBe(2);
    expect(levelForXp(400)).toBe(3);
    expect(levelForXp(900)).toBe(4);
    expect(levelForXp(10_000)).toBe(11);
  });

  it("is defensive about bad input", () => {
    expect(levelForXp(-50)).toBe(1);
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("level boundaries are consistent in both directions", () => {
    for (let level = 1; level <= 20; level++) {
      const start = xpAtLevel(level);
      const next = xpForNextLevel(level);
      expect(next).toBe(100 * level ** 2);
      expect(levelForXp(start)).toBe(level);
      expect(levelForXp(next - 1)).toBe(level);
      expect(levelForXp(next)).toBe(level + 1);
    }
  });

  it("reports progress through the current level", () => {
    expect(levelProgress(0)).toEqual({
      level: 1,
      xp: 0,
      levelStartXp: 0,
      nextLevelXp: 100,
      remainingXp: 100,
      fraction: 0,
    });
    const mid = levelProgress(250);
    expect(mid.level).toBe(2);
    expect(mid.levelStartXp).toBe(100);
    expect(mid.nextLevelXp).toBe(400);
    expect(mid.remainingXp).toBe(150);
    expect(mid.fraction).toBeCloseTo(0.5);
  });

  it("clamps fraction to [0, 1] and floors fractional xp", () => {
    const p = levelProgress(399.9);
    expect(p.xp).toBe(399);
    expect(p.fraction).toBeLessThan(1);
    expect(levelProgress(-10).fraction).toBe(0);
  });
});
