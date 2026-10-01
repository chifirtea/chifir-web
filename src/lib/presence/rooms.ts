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
