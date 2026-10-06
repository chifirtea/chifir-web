import { describe, expect, it } from "vitest";
import { fitFontSize, glowColor, luminance, mixHex } from "./signage";

/** Fake measurer: every glyph is 0.6em wide. */
const measure = (text: string, size: number) => text.length * size * 0.6;

describe("fitFontSize", () => {
  it("returns maxSize when the text already fits", () => {
    expect(fitFontSize(measure, "Kōri", 1000, 64)).toBe(64);
  });

  it("returns the largest integer size that fits the width", () => {
    // "Ember & Oak" = 11 glyphs → width = 6.6 * size; fits 400px at size ≤ 60.6.
    const size = fitFontSize(measure, "Ember & Oak", 400, 120);
    expect(size).toBe(60);
    expect(measure("Ember & Oak", size)).toBeLessThanOrEqual(400);
    expect(measure("Ember & Oak", size + 1)).toBeGreaterThan(400);
  });

  it("never goes below minSize, even when the text cannot fit", () => {
    expect(fitFontSize(measure, "A very long merchant name that will not fit", 10, 80, 12)).toBe(12);
  });

  it("handles empty text and degenerate bounds", () => {
    expect(fitFontSize(measure, "", 100, 40)).toBe(40);
    expect(fitFontSize(measure, "X", 100, 0.5)).toBe(1);
    expect(fitFontSize(measure, "Xyz", 100, 10, 50)).toBe(10);
  });

  it("is monotonic in maxWidth", () => {
    let last = 0;
    for (const width of [50, 100, 200, 400, 800]) {
      const size = fitFontSize(measure, "Northline Supply", width, 200);
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
    }
  });
});

describe("colour helpers", () => {
  it("computes luminance in [0, 1]", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#fff")).toBeCloseTo(1, 5);
  });

  it("mixes colours linearly", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#0000ff", 0)).toBe("#ff0000");
  });

  it("picks a colour that glows against the night for every seed palette shape", () => {
    expect(glowColor({ primary: "#1F1B18", secondary: "#B4532A", accent: "#F2C57C", onPrimary: "#FFF3E6" })).toBe("#F2C57C");
    // Dark accent → falls through to the next bright colour.
    expect(glowColor({ primary: "#0B0B0D", secondary: "#E8E4DA", accent: "#101010", onPrimary: "#F5F5F0" })).toBe("#E8E4DA");
  });
});
