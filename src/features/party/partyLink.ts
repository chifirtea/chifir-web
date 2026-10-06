import type { CityIndex } from "@/city/cityIndex";
import { districtAt } from "@/city/cityIndex";
import type { Location, PlayerPose } from "@/engine/store/worldStore";
import { PARTY_CODE_PATTERN } from "@/lib/presence/transport";

/**
 * Party links: `/city?party=CODE&to=<where the inviter is>`. The code is short and unambiguous
 * (no 0/O or 1/I) so it survives being read aloud; `to` is an ordinary deep link so the joiner
 * lands in the right district even before any presence packet arrives.
 */

export const PARTY_QUERY_PARAM = "party";
export const PARTY_CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePartyCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))];
  }
  return code;
}

export function isValidPartyCode(code: string): boolean {
  return PARTY_CODE_PATTERN.test(code);
}

/** Normalises user-typed or URL-borne codes (case, whitespace); null when not a code. */
export function parsePartyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return isValidPartyCode(code) ? code : null;
}

export function buildInviteUrl(origin: string, code: string, to: string | null): string {
  const url = new URL("/city", origin);
  url.searchParams.set(PARTY_QUERY_PARAM, code);
  if (to) url.searchParams.set("to", to);
  return url.toString();
}

export interface ParsedInvite {
  code: string;
  to: string | null;
}

export function parseInviteUrl(href: string): ParsedInvite | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const code = parsePartyCode(url.searchParams.get(PARTY_QUERY_PARAM));
  if (!code) return null;
  const to = url.searchParams.get("to");
  return { code, to: to && to.trim() ? to.trim().slice(0, 120) : null };
}

/**
 * The `to=` value for where the inviter stands: `district:<slug>` on the street, the merchant
 * slug indoors (or `parcel:<slug>` inside a pop-up, which is a different room from the store).
 */
export function inviteTargetFor(location: Location, index: CityIndex | null, x: number, z: number): string | null {
  if (!index) return null;
  if (location.kind === "interior") {
    const parcel = index.parcelsById[location.parcelId];
    const merchant = index.merchantsById[location.merchantId];
    if (!merchant) return null;
    const isStore = index.parcelByMerchant[merchant.id]?.id === parcel?.id;
    return isStore || !parcel ? merchant.slug : `parcel:${parcel.slug}`;
  }
  const district = districtAt(index, x, z);
  return district ? `district:${district.slug}` : null;
}

/** Where a joiner stands relative to a member: 2 m behind them, a step to the side, same heading. */
export const SPAWN_BEHIND_M = 2;
export const SPAWN_SIDE_M = 1;

/**
 * Candidate (behind, side) offsets in the member's frame, best first. Straight behind would hide
 * the member behind the joiner's own avatar in the follow camera, so the first picks step aside;
 * the rest exist for members standing with their back to a wall.
 */
const SPAWN_OFFSETS: ReadonlyArray<readonly [behind: number, side: number]> = [
  [SPAWN_BEHIND_M, SPAWN_SIDE_M],
  [SPAWN_BEHIND_M, -SPAWN_SIDE_M],
  [SPAWN_BEHIND_M, 0],
  [0, 1.5],
  [0, -1.5],
  [-SPAWN_BEHIND_M, 0],
];

/**
 * The pose `behind` metres behind the member and `side` metres to their right, facing the same
 * way. Engine convention: forward = (sin yaw, cos yaw), so right = (-cos yaw, sin yaw).
 */
export function poseBehind(
  member: { x: number; z: number; yaw: number },
  behind: number = SPAWN_BEHIND_M,
  side: number = SPAWN_SIDE_M,
): PlayerPose {
  const fx = Math.sin(member.yaw);
  const fz = Math.cos(member.yaw);
  return {
    x: member.x - fx * behind - fz * side,
    z: member.z - fz * behind + fx * side,
    yaw: member.yaw,
  };
}

/** The first free spot near the member (see SPAWN_OFFSETS); behind-and-aside when all are blocked. */
export function spawnNear(
  member: { x: number; z: number; yaw: number },
  isFree: (x: number, z: number) => boolean = () => true,
): PlayerPose {
  for (const [behind, side] of SPAWN_OFFSETS) {
    const pose = poseBehind(member, behind, side);
    if (isFree(pose.x, pose.z)) return pose;
  }
  return poseBehind(member);
}
