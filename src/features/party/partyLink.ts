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

/** Where a joiner stands relative to a member: 2 m behind them, facing the same way. */
export const SPAWN_BEHIND_M = 2;

export function poseBehind(member: { x: number; z: number; yaw: number }): PlayerPose {
  return {
    x: member.x - Math.sin(member.yaw) * SPAWN_BEHIND_M,
    z: member.z - Math.cos(member.yaw) * SPAWN_BEHIND_M,
    yaw: member.yaw,
  };
}
