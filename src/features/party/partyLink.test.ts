import { describe, expect, it } from "vitest";
import type { CityIndex } from "@/city/cityIndex";
import {
  buildInviteUrl,
  generatePartyCode,
  inviteTargetFor,
  isValidPartyCode,
  parseInviteUrl,
  parsePartyCode,
  poseBehind,
} from "./partyLink";

const CODE = /^[A-Z0-9]{6,12}$/;

describe("party codes", () => {
  it("generates codes that match the wire pattern and avoid look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePartyCode();
      expect(code).toMatch(CODE);
      expect(code).not.toMatch(/[01IO]/);
    }
    expect(generatePartyCode(() => 0)).toBe("AAAAAA");
    expect(generatePartyCode(() => 0.999999)).toBe("999999");
  });

  it("parses user and URL input leniently but validates strictly", () => {
    expect(parsePartyCode(" abc234 ")).toBe("ABC234");
    expect(parsePartyCode("ABC234567890")).toBe("ABC234567890");
    expect(parsePartyCode("ABC2345678901")).toBeNull();
    expect(parsePartyCode("abc")).toBeNull();
    expect(parsePartyCode("ABC-234")).toBeNull();
    expect(parsePartyCode("")).toBeNull();
    expect(parsePartyCode(null)).toBeNull();
    expect(isValidPartyCode("abc234")).toBe(false);
  });
});

describe("invite links", () => {
  it("builds /city?party=CODE&to=... on the given origin", () => {
    const url = buildInviteUrl("https://chifir.com", "ABC234", "district:central-plaza");
    expect(url).toBe("https://chifir.com/city?party=ABC234&to=district%3Acentral-plaza");
    expect(buildInviteUrl("http://localhost:3100", "ABC234", null)).toBe("http://localhost:3100/city?party=ABC234");
  });

  it("parses what it builds and rejects links without a valid code", () => {
    expect(parseInviteUrl("https://chifir.com/city?party=ABC234&to=district%3Acentral-plaza")).toEqual({
      code: "ABC234",
      to: "district:central-plaza",
    });
    expect(parseInviteUrl("https://chifir.com/city?party=abc234")).toEqual({ code: "ABC234", to: null });
    expect(parseInviteUrl("https://chifir.com/city?party=nope")).toBeNull();
    expect(parseInviteUrl("not a url")).toBeNull();
  });
});

const index = {
  snapshot: {
    districts: [{ id: "d-plaza", slug: "central-plaza", bounds: { minX: -40, minZ: -40, maxX: 40, maxZ: 40 } }],
  },
  parcelsById: {
    "p-store": { id: "p-store", slug: "fa-n2", merchantId: "m-northline" },
    "p-popup": { id: "p-popup", slug: "es-pop1", merchantId: "m-northline" },
  },
  merchantsById: { "m-northline": { id: "m-northline", slug: "northline-supply" } },
  parcelByMerchant: { "m-northline": { id: "p-store" } },
} as unknown as CityIndex;

describe("inviteTargetFor", () => {
  it("names the district on the street", () => {
    expect(inviteTargetFor({ kind: "street" }, index, 0, 21)).toBe("district:central-plaza");
    expect(inviteTargetFor({ kind: "street" }, index, 999, 999)).toBeNull();
    expect(inviteTargetFor({ kind: "street" }, null, 0, 0)).toBeNull();
  });

  it("names the merchant inside its store and the parcel inside a pop-up", () => {
    expect(inviteTargetFor({ kind: "interior", merchantId: "m-northline", parcelId: "p-store" }, index, 0, 5000)).toBe("northline-supply");
    expect(inviteTargetFor({ kind: "interior", merchantId: "m-northline", parcelId: "p-popup" }, index, 0, 5000)).toBe("parcel:es-pop1");
    expect(inviteTargetFor({ kind: "interior", merchantId: "ghost", parcelId: "p-store" }, index, 0, 5000)).toBeNull();
  });
});

describe("poseBehind", () => {
  it("stands 2 m behind the member, facing the same way", () => {
    // yaw 0 faces +Z, so "behind" is -Z.
    const behind = poseBehind({ x: 0, z: 0, yaw: 0 });
    expect(behind.x).toBeCloseTo(0);
    expect(behind.z).toBeCloseTo(-2);
    expect(behind.yaw).toBe(0);
    const p = poseBehind({ x: 10, z: 5, yaw: Math.PI / 2 }); // facing +X
    expect(p.x).toBeCloseTo(8);
    expect(p.z).toBeCloseTo(5);
    expect(p.yaw).toBe(Math.PI / 2);
  });
});
