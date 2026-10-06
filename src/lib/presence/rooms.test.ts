import { describe, expect, it } from "vitest";
import type { CityIndex } from "@/city/cityIndex";
import { channelName, OUTSIDE_DISTRICT_ROOM, parseRoom, partyRoom, ROOM_NAMESPACE, roomForLocation } from "./rooms";

const index = {
  snapshot: {
    districts: [
      { id: "d-plaza", slug: "central-plaza", bounds: { minX: -40, minZ: -40, maxX: 40, maxZ: 40 } },
      { id: "d-food", slug: "food-street", bounds: { minX: 40, minZ: -30, maxX: 150, maxZ: 30 } },
    ],
  },
} as unknown as CityIndex;

describe("room keys", () => {
  it("is the district while on the street", () => {
    expect(roomForLocation({ kind: "street" }, index, 0, 21)).toBe("district:d-plaza");
    expect(roomForLocation({ kind: "street" }, index, 100, 0)).toBe("district:d-food");
  });

  it("is a shared outside room off the map or without an index", () => {
    expect(roomForLocation({ kind: "street" }, index, 0, 500)).toBe(OUTSIDE_DISTRICT_ROOM);
    expect(roomForLocation({ kind: "street" }, null, 0, 0)).toBe(OUTSIDE_DISTRICT_ROOM);
  });

  it("is the parcel indoors (a store and its pop-up are different rooms)", () => {
    expect(roomForLocation({ kind: "interior", merchantId: "m1", parcelId: "p-store" }, index, 0, 5000)).toBe("interior:p-store");
    expect(roomForLocation({ kind: "interior", merchantId: "m1", parcelId: "p-popup" }, index, 0, 5000)).toBe("interior:p-popup");
  });

  it("namespaces channel names and parses keys back", () => {
    expect(channelName("district:d-plaza")).toBe(`${ROOM_NAMESPACE}:district:d-plaza`);
    expect(partyRoom("ABC234")).toBe("party:ABC234");
    expect(parseRoom("district:d-plaza")).toEqual({ kind: "district", id: "d-plaza" });
    expect(parseRoom("interior:p1")).toEqual({ kind: "interior", id: "p1" });
    expect(parseRoom("party:ABC234")).toEqual({ kind: "party", id: "ABC234" });
    expect(parseRoom(OUTSIDE_DISTRICT_ROOM)).toEqual({ kind: "outside", id: "" });
    expect(parseRoom("bogus:x")).toBeNull();
    expect(parseRoom("district:")).toBeNull();
    expect(parseRoom("nocolon")).toBeNull();
  });
});
