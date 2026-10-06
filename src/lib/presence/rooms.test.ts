import { describe, expect, it } from "vitest";
import type { CityIndex } from "@/city/cityIndex";
import {
  channelName,
  isStreetRoom,
  nextRoom,
  OUTSIDE_DISTRICT_ROOM,
  parseRoom,
  partyRoom,
  ROOM_HYSTERESIS_M,
  ROOM_NAMESPACE,
  roomForLocation,
} from "./rooms";

const districts = [
  { id: "d-plaza", slug: "central-plaza", bounds: { minX: -40, minZ: -40, maxX: 40, maxZ: 40 } },
  { id: "d-food", slug: "food-street", bounds: { minX: 40, minZ: -30, maxX: 150, maxZ: 30 } },
  { id: "d-event", slug: "event-square", bounds: { minX: -60, minZ: -140, maxX: 60, maxZ: -40 } },
];
const index = {
  snapshot: { districts },
  districtsById: Object.fromEntries(districts.map((d) => [d.id, d])),
} as unknown as CityIndex;
const street = { kind: "street" } as const;

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

describe("district-edge hysteresis", () => {
  /** Walks from (x, z0) to (x, z1) in 0.5 m steps and returns the room after each step. */
  function walk(x: number, z0: number, z1: number): string[] {
    const rooms: string[] = [];
    let prev = { room: roomForLocation(street, index, x, z0), x, z: z0 };
    const step = z1 > z0 ? 0.5 : -0.5;
    for (let z = z0 + step; step > 0 ? z <= z1 : z >= z1; z += step) {
      const room = nextRoom(street, index, x, z, prev);
      rooms.push(room);
      prev = { room, x, z };
    }
    return rooms;
  }

  it("keeps the district you came from until a few metres past its edge", () => {
    // Central Plaza (z >= -40) down into Event Square.
    const rooms = walk(0, -36, -46);
    const switchedAt = -36 - 0.5 * (rooms.indexOf("district:d-event") + 1);
    expect(switchedAt).toBeLessThan(-40 - ROOM_HYSTERESIS_M + 0.01);
    expect(switchedAt).toBeGreaterThan(-40 - ROOM_HYSTERESIS_M - 1);
    expect(rooms.at(-1)).toBe("district:d-event");
  });

  it("does not flap for someone pacing on the line", () => {
    let prev = { room: "district:d-plaza", x: 0, z: -39.5 };
    for (const z of [-40.5, -39.5, -41, -40, -42, -39]) {
      const room = nextRoom(street, index, 0, z, prev);
      expect(room).toBe("district:d-plaza");
      prev = { room, x: 0, z };
    }
  });

  it("takes the new room at once after a teleport, a door, or without history", () => {
    const prev = { room: "district:d-plaza", x: 0, z: -38 };
    // 12 m in one tick is a teleport (a party spawn by a member on the edge), not a walk.
    expect(nextRoom(street, index, 0, -42.5, { ...prev, z: -30 })).toBe("district:d-event");
    expect(nextRoom({ kind: "interior", merchantId: "m1", parcelId: "p1" }, index, 0, 5000, prev)).toBe("interior:p1");
    expect(nextRoom(street, index, 0, -41, null)).toBe("district:d-event");
    expect(nextRoom(street, index, 0, -41, { room: "interior:p1", x: 0, z: -41 })).toBe("district:d-event");
  });

  it("knows which rooms are on the street layer", () => {
    expect(isStreetRoom("district:d-plaza")).toBe(true);
    expect(isStreetRoom(OUTSIDE_DISTRICT_ROOM)).toBe(true);
    expect(isStreetRoom("interior:p1")).toBe(false);
    expect(isStreetRoom(null)).toBe(false);
  });
});
