import { districtAt, type CityIndex } from "@/city/cityIndex";
import type { Location } from "@/engine/store/worldStore";

/**
 * Rooms are locations (ADR-006): the district while on the street, the parcel indoors. Keys are
 * namespaced so a future wire format or a second deployment on the same Supabase project never
 * collides with this one.
 */
export const ROOM_NAMESPACE = "chifir.presence.v1";

/** Street positions outside every district (between blocks, off the map) share one room. */
export const OUTSIDE_DISTRICT_ROOM = "district:outside";

export function roomForLocation(location: Location, index: CityIndex | null, x: number, z: number): string {
  if (location.kind === "interior") return `interior:${location.parcelId}`;
  const district = index ? districtAt(index, x, z) : null;
  return district ? `district:${district.id}` : OUTSIDE_DISTRICT_ROOM;
}

/** Walking this far past a district edge still counts as the district you came from. */
export const ROOM_HYSTERESIS_M = 3;
/** A move longer than this between two ticks is a teleport: the new spot's room applies at once. */
export const ROOM_JUMP_M = 4;

/** The room chosen on the previous tick and where the player stood then. */
export interface RoomTrack {
  room: string;
  x: number;
  z: number;
}

/**
 * `roomForLocation` with hysteresis on district edges. Every room change is a leave + join that
 * clears the peers, so two friends walking a step apart across an edge would lose each other
 * while only one had crossed, and someone loitering on the line would flap between rooms. While
 * walking, the previous district is kept until the player is `ROOM_HYSTERESIS_M` past its
 * bounds; teleports and doors take the new room at once.
 */
export function nextRoom(
  location: Location,
  index: CityIndex | null,
  x: number,
  z: number,
  prev: RoomTrack | null,
): string {
  const strict = roomForLocation(location, index, x, z);
  if (!prev || !index || location.kind !== "street" || strict === prev.room) return strict;
  const parsed = parseRoom(prev.room);
  if (parsed?.kind !== "district") return strict;
  const dx = x - prev.x;
  const dz = z - prev.z;
  if (dx * dx + dz * dz > ROOM_JUMP_M * ROOM_JUMP_M) return strict;
  const district = index.districtsById[parsed.id];
  if (!district) return strict;
  const b = district.bounds;
  const m = ROOM_HYSTERESIS_M;
  const inside = x >= b.minX - m && x <= b.maxX + m && z >= b.minZ - m && z <= b.maxZ + m;
  return inside ? prev.room : strict;
}

/** True for rooms on the street layer (a district or the space between them). */
export function isStreetRoom(room: string | null): boolean {
  return room !== null && (room === OUTSIDE_DISTRICT_ROOM || room.startsWith("district:"));
}

/** The party channel: every member of a party, whatever room they are in. */
export function partyRoom(code: string): string {
  return `party:${code}`;
}

/** Full channel name as the transport sees it. */
export function channelName(room: string): string {
  return `${ROOM_NAMESPACE}:${room}`;
}

export interface ParsedRoom {
  kind: "district" | "interior" | "party" | "outside";
  id: string;
}

export function parseRoom(room: string): ParsedRoom | null {
  if (room === OUTSIDE_DISTRICT_ROOM) return { kind: "outside", id: "" };
  const i = room.indexOf(":");
  if (i <= 0 || i === room.length - 1) return null;
  const kind = room.slice(0, i);
  const id = room.slice(i + 1);
  if (kind === "district" || kind === "interior" || kind === "party") return { kind, id };
  return null;
}
