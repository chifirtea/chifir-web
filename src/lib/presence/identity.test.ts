import { describe, expect, it } from "vitest";
import { bodyColorFor, displayNameFor, fallbackName, hairColorFor, PEER_BODY_COLORS } from "./identity";

describe("presence identity", () => {
  it("derives a stable body colour, hair colour and fallback name from the peer id", () => {
    expect(bodyColorFor("abc123")).toBe(bodyColorFor("abc123"));
    expect(PEER_BODY_COLORS).toContain(bodyColorFor("abc123"));
    expect(hairColorFor("abc123")).toMatch(/^#[0-9a-f]{6}$/);
    expect(fallbackName("abc123")).toMatch(/^Citizen [A-HJ-NP-Z2-9]{3}$/);
    expect(fallbackName("abc123")).toBe(fallbackName("abc123"));
    // Different tabs mostly look different.
    const colours = new Set(Array.from({ length: 64 }, (_, i) => bodyColorFor(`peer${i}`)));
    expect(colours.size).toBeGreaterThan(8);
  });

  it("uses the chosen display name, trimmed to the wire limit and stripped of control characters", () => {
    expect(displayNameFor("p1", "  Ada  ", 24)).toBe("Ada");
    expect(displayNameFor("p1", "Ada\u0000\u0007 L", 24)).toBe("Ada L");
    expect(displayNameFor("p1", "x".repeat(40), 24)).toHaveLength(24);
  });

  it("never puts an email-shaped name on the wire", () => {
    expect(displayNameFor("p1", "ada@example.com", 24)).toBe(fallbackName("p1"));
    expect(displayNameFor("p1", "", 24)).toBe(fallbackName("p1"));
    expect(displayNameFor("p1", null, 24)).toBe(fallbackName("p1"));
  });
});
