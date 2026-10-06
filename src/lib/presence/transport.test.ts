import { describe, expect, it } from "vitest";
import {
  decodePacket,
  decodePeerMeta,
  encodePacket,
  outfitToPacket,
  packetToOutfit,
  type PresencePacket,
} from "./transport";

const valid: PresencePacket = {
  t: 1_700_000_000_000,
  id: "abc123def456",
  x: 12.34,
  z: -56.78,
  yaw: 1.57,
  m: 1,
  a: { b: "#8a5a44", h: "#1a120e" },
  o: { style: "hoodie", primary: "#101820", accent: "#ffffff", print: "NIGHT SHIFT" },
  n: "Citizen 7KQ",
  p: "ABC234",
};

describe("presence packet codec", () => {
  it("round-trips a valid packet through JSON", () => {
    const wire = encodePacket(valid);
    expect(decodePacket(wire)).toEqual(valid);
    expect(decodePacket(JSON.parse(wire))).toEqual(valid);
  });

  it("accepts the minimal packet (no outfit, no party, no room)", () => {
    const minimal: PresencePacket = { ...valid };
    delete minimal.o;
    delete minimal.p;
    expect(decodePacket(minimal)).toEqual(minimal);
  });

  it("accepts an optional room key for party-channel packets", () => {
    expect(decodePacket({ ...valid, r: "district:d1" })?.r).toBe("district:d1");
    expect(decodePacket({ ...valid, r: "" })).toBeNull();
  });

  it("drops malformed input instead of throwing", () => {
    expect(decodePacket("not json")).toBeNull();
    expect(decodePacket(null)).toBeNull();
    expect(decodePacket(42)).toBeNull();
    expect(decodePacket("x".repeat(3000))).toBeNull();
    expect(decodePacket({})).toBeNull();
  });

  it("rejects off-schema fields: colours, lengths, flags, unknown keys, non-finite numbers", () => {
    expect(decodePacket({ ...valid, a: { b: "red", h: "#1a120e" } })).toBeNull();
    expect(decodePacket({ ...valid, n: "x".repeat(25) })).toBeNull();
    expect(decodePacket({ ...valid, n: "" })).toBeNull();
    expect(decodePacket({ ...valid, p: "abc" })).toBeNull();
    expect(decodePacket({ ...valid, p: "TOOLONGPARTYCODE1" })).toBeNull();
    expect(decodePacket({ ...valid, m: 2 })).toBeNull();
    expect(decodePacket({ ...valid, x: Number.NaN })).toBeNull();
    expect(decodePacket({ ...valid, x: 1e9 })).toBeNull();
    expect(decodePacket({ ...valid, yaw: "1.5" })).toBeNull();
    expect(decodePacket({ ...valid, email: "a@b.c" })).toBeNull();
    expect(decodePacket({ ...valid, o: { print: "x".repeat(25) } })).toBeNull();
    expect(decodePacket({ ...valid, o: { primary: "blue" } })).toBeNull();
    expect(decodePacket({ ...valid, id: "" })).toBeNull();
    expect(decodePacket({ ...valid, id: "i".repeat(41) })).toBeNull();
  });

  it("validates presence metadata the same way", () => {
    expect(decodePeerMeta({ id: "p1", n: "Ada", a: { b: "#000000", h: "#ffffff" } })).toEqual({
      id: "p1",
      n: "Ada",
      a: { b: "#000000", h: "#ffffff" },
    });
    expect(decodePeerMeta({ id: "p1", n: "Ada", a: { b: "#000000", h: "#ffffff" }, userId: "u" })).toBeNull();
    expect(decodePeerMeta({ id: "p1" })).toBeNull();
  });
});

describe("outfit subset", () => {
  it("keeps only the sendable fields and trims the print", () => {
    expect(
      outfitToPacket({ style: "hoodie", primary: "#101820", secondary: "#333333", accent: "#ffffff", print: "  NIGHT SHIFT  " }),
    ).toEqual({ style: "hoodie", primary: "#101820", accent: "#ffffff", print: "NIGHT SHIFT" });
    expect(outfitToPacket({ primary: "not-a-colour" })).toBeUndefined();
    expect(outfitToPacket(null)).toBeUndefined();
    expect(outfitToPacket({ print: "x".repeat(40) })?.print).toHaveLength(24);
  });

  it("turns back into an appearance for the renderer", () => {
    expect(packetToOutfit({ style: "zip-hoodie", primary: "#101820" })).toEqual({ style: "zip-hoodie", primary: "#101820" });
    expect(packetToOutfit(undefined)).toBeNull();
  });
});
