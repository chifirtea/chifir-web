import { afterEach, describe, expect, it } from "vitest";
import {
  clampOffset,
  clockOffsetMs,
  now,
  parseClockHeader,
  parseClockOverride,
  setClockOffsetMs,
} from "./clock";

const REAL = Date.parse("2026-09-30T18:00:00Z");

describe("clock override parsing", () => {
  it("accepts ISO date-times and turns them into an offset from real time", () => {
    expect(parseClockOverride("2026-09-30T19:58:00Z", REAL)).toBe(118 * 60_000);
    expect(parseClockOverride("2026-09-29T18:00:00Z", REAL)).toBe(-24 * 3600_000);
  });
  it("accepts relative seconds and epoch milliseconds", () => {
    expect(parseClockOverride("+900", REAL)).toBe(900_000);
    expect(parseClockOverride("-60", REAL)).toBe(-60_000);
    expect(parseClockOverride(String(REAL + 5_000), REAL)).toBe(5_000);
  });
  it("rejects garbage and clamps absurd offsets", () => {
    expect(parseClockOverride("tomorrow", REAL)).toBeNull();
    expect(parseClockOverride("", REAL)).toBeNull();
    expect(parseClockOverride(undefined, REAL)).toBeNull();
    expect(Math.abs(parseClockOverride("2099-01-01T00:00:00Z", REAL)!)).toBeLessThanOrEqual(
      366 * 24 * 3600_000,
    );
    expect(clampOffset(Number.NaN)).toBe(0);
  });
  it("parses the offset header strictly", () => {
    expect(parseClockHeader("120000")).toBe(120_000);
    expect(parseClockHeader("-5")).toBe(-5);
    expect(parseClockHeader("12.5")).toBeNull();
    expect(parseClockHeader("abc")).toBeNull();
    expect(parseClockHeader(null)).toBeNull();
  });
});

describe("clock offset", () => {
  afterEach(() => setClockOffsetMs(0));
  it("shifts now() by the offset", () => {
    setClockOffsetMs(3_600_000);
    expect(clockOffsetMs()).toBe(3_600_000);
    expect(now() - Date.now()).toBeGreaterThan(3_599_000);
  });
});
