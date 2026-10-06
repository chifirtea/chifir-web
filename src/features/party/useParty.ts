"use client";

import { useEffect } from "react";
import { enterMerchant, teleportToPose } from "@/city/cityActions";
import { getCityIndex, useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { distance2D } from "@/city/navigation";
import { isInteriorZ } from "@/engine/interior/types";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";
import { usePresenceStore, type PartyPeer } from "@/lib/presence/presenceStore";
import { parseRoom } from "@/lib/presence/rooms";
import { PARTY_QUERY_PARAM, parsePartyCode, poseBehind } from "./partyLink";
import { usePartyStore } from "./partyStore";

/** How long a joiner waits for a member's packet before settling for the deep link's spot. */
export const JOIN_WAIT_MS = 3000;
/** Inside a room, closer than this to a member counts as "near" (rooms are small). */
const NEAR_INDOORS_M = 3;
/** Give the first fade time to finish before a second hop. */
const TRANSITION_WAIT_MS = 4000;

function firstMember(): PartyPeer | null {
  const peers = Object.values(usePresenceStore.getState().partyPeers);
  return peers.sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null;
}

/** Resolves when the world transition is idle again (or after a timeout). */
function afterTransition(): Promise<void> {
  return new Promise((resolve) => {
    if (useWorldStore.getState().transition === "idle") {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      unsub();
      resolve();
    }, TRANSITION_WAIT_MS);
    const unsub = useWorldStore.subscribe((s) => {
      if (s.transition !== "idle") return;
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

/**
 * Moves the player next to a party member: on the street a straight teleport 2 m behind them;
 * indoors, enter their room (then step beside them once inside). Returns whether a move started.
 */
export function goToPartyMember(member: PartyPeer, index: CityIndex): boolean {
  const my = useWorldStore.getState().location;
  const room = member.room ? parseRoom(member.room) : null;
  const target = poseBehind(member);

  if (room?.kind === "interior") {
    const parcel = index.parcelsById[room.id];
    if (!parcel?.merchantId) return false;
    if (my.kind === "interior" && my.parcelId === parcel.id) return teleportToPose(target, "party", my);
    const merchantId = parcel.merchantId;
    const ok = enterMerchant(merchantId, "teleport", parcel.id);
    if (ok) {
      void afterTransition().then(() => {
        const fresh = usePresenceStore.getState().partyPeers[member.id] ?? member;
        const world = useWorldStore.getState();
        if (world.location.kind !== "interior" || world.location.parcelId !== parcel.id) return;
        if (distance2D(playerRig, fresh) <= NEAR_INDOORS_M) return;
        teleportToPose(poseBehind(fresh), "party", world.location);
      });
    }
    return ok;
  }

  // No room reported: the packet came from our own room, so stay in it.
  if (!room && my.kind === "interior") return teleportToPose(target, "party", my);
  // A street member must be on the street layer; an interior coordinate with a street room is stale.
  if (isInteriorZ(member.z)) return false;
  return teleportToPose(target, "party");
}

/**
 * Party lifecycle for this tab: restores the party from sessionStorage, joins from `?party=` and,
 * once the city is ready, waits briefly for a member's packet to spawn next to them.
 */
export function useParty(): void {
  const ready = useWorldStore((s) => s.ready);
  const index = useCityStore((s) => s.index);
  const pendingJoin = usePartyStore((s) => s.pendingJoin);

  useEffect(() => {
    const party = usePartyStore.getState();
    party.hydrate();
    let code: string | null = null;
    try {
      code = parsePartyCode(new URLSearchParams(window.location.search).get(PARTY_QUERY_PARAM));
    } catch {
      code = null;
    }
    if (code && party.join(code)) party.setPendingJoin(code);
  }, []);

  useEffect(() => {
    if (!ready || !index || !pendingJoin) return;
    let done = false;
    const finish = (member: PartyPeer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      const spawnedNearInviter = Boolean(member && goToPartyMember(member, getCityIndex() ?? index));
      track("party_joined", {
        partyCode: pendingJoin,
        members: Object.keys(usePresenceStore.getState().partyPeers).length + 1,
        spawnedNearInviter,
      });
      usePartyStore.getState().setPendingJoin(null);
    };
    const timer = setTimeout(() => finish(firstMember()), JOIN_WAIT_MS);
    const unsub = usePresenceStore.subscribe((s, prev) => {
      if (s.partyPeers === prev.partyPeers) return;
      const member = firstMember();
      if (member) finish(member);
    });
    const immediate = firstMember();
    if (immediate) finish(immediate);
    return () => {
      done = true;
      clearTimeout(timer);
      unsub();
    };
  }, [ready, index, pendingJoin]);
}
