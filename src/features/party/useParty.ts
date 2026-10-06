"use client";

import { useEffect } from "react";
import { enterMerchant, teleportToPose } from "@/city/cityActions";
import { getCityIndex, useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { distance2D } from "@/city/navigation";
import { getColliders, type ColliderScope } from "@/engine/physics/colliderStore";
import { resolveCircleAABB } from "@/engine/physics/collision";
import { PLAYER_RADIUS } from "@/engine/player/PlayerController";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore, type Location, type PlayerPose } from "@/engine/store/worldStore";
import { flush } from "@/lib/analytics/client";
import { usePresenceStore, type PartyPeer } from "@/lib/presence/presenceStore";
import { parseRoom, roomForLocation } from "@/lib/presence/rooms";
import { insideInterior, onStreetMap, PARTY_QUERY_PARAM, parsePartyCode, spawnNear } from "./partyLink";
import { usePartyStore } from "./partyStore";

/** How long a joiner stays put waiting for a member before exploring from the deep link's spot. */
export const JOIN_WAIT_MS = 3000;
/**
 * A member heard later than `JOIN_WAIT_MS` (the inviter's tab was hidden while they sent the
 * link) still gets the joiner placed, for this long after the city came up.
 */
export const LATE_JOIN_MS = 120_000;
/** Within this of where the deep link put them, a joiner is still waiting and is moved at once. */
const STAYED_PUT_M = 3;
/** "Next to the inviter" for `party_joined`: close enough that each is in the other's view. */
export const NEAR_MEMBER_M = 6;
/** Inside a room, closer than this to a member counts as "near" (rooms are small). */
const NEAR_INDOORS_M = 3;
/** Give the first fade time to finish before a second hop. */
const TRANSITION_WAIT_MS = 4000;
const POLL_MS = 250;

function firstMember(): PartyPeer | null {
  const peers = Object.values(usePresenceStore.getState().partyPeers);
  return peers.sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null;
}

/** The member's newest record (pose fields are updated in place, the record on room change). */
function latest(member: PartyPeer): PartyPeer {
  return usePresenceStore.getState().partyPeers[member.id] ?? member;
}

/**
 * A spot near the member that is not inside a wall of the given layer's colliders. On the street
 * it prefers spots in the member's own district room, so the two are in one room at once.
 */
function spawnBeside(member: PartyPeer, scope: ColliderScope, index: CityIndex): PlayerPose {
  const colliders = getColliders(scope);
  const free = (x: number, z: number) => resolveCircleAABB(x, z, PLAYER_RADIUS, colliders).hits.length === 0;
  const memberRoom = member.room;
  const sameRoom =
    scope === "street" && memberRoom
      ? (x: number, z: number) => onStreetMap(index, x, z) && roomForLocation({ kind: "street" }, index, x, z) === memberRoom
      : undefined;
  return spawnNear(member, free, sameRoom);
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

/** Measured, not assumed: within `NEAR_MEMBER_M` of the member and in the room they report. */
function isNearMember(member: PartyPeer): boolean {
  const fresh = latest(member);
  if (distance2D(playerRig, fresh) > NEAR_MEMBER_M) return false;
  if (!fresh.room) return true;
  const index = getCityIndex();
  const strict = index ? roomForLocation(useWorldStore.getState().location, index, playerRig.x, playerRig.z) : null;
  return fresh.room === usePresenceStore.getState().room || fresh.room === strict;
}

export interface PartyMove {
  /** A move started (false: the member's spot is unusable, or a transition is running). */
  started: boolean;
  /** Resolves once the move has settled: whether we ended up next to the member, in their room. */
  done: Promise<boolean>;
}

const NOT_STARTED: PartyMove = { started: false, done: Promise.resolve(false) };

function settled(member: PartyPeer, ok: boolean): PartyMove {
  if (!ok) return NOT_STARTED;
  return { started: true, done: afterTransition().then(() => isNearMember(member)) };
}

/**
 * Moves the player next to a party member: on the street a teleport to just behind them (see
 * `spawnNear`); indoors, enter their room, then step beside them once inside. Member positions
 * come from other people's packets, so a spot off the street map or outside the reported room
 * is refused rather than followed.
 */
export function goToPartyMember(member: PartyPeer, index: CityIndex): PartyMove {
  const my = useWorldStore.getState().location;
  const room = member.room ? parseRoom(member.room) : null;

  if (room?.kind === "interior") {
    const parcel = index.parcelsById[room.id];
    if (!parcel?.merchantId || !insideInterior(parcel, member.x, member.z)) return NOT_STARTED;
    if (my.kind === "interior" && my.parcelId === parcel.id) {
      return settled(member, teleportToPose(spawnBeside(member, "interior", index), "party", my));
    }
    if (!enterMerchant(parcel.merchantId, "teleport", parcel.id)) return NOT_STARTED;
    const done = afterTransition().then(async () => {
      const fresh = latest(member);
      const world = useWorldStore.getState();
      if (world.location.kind !== "interior" || world.location.parcelId !== parcel.id) return false;
      const inside: Location = world.location;
      if (distance2D(playerRig, fresh) > NEAR_INDOORS_M && insideInterior(parcel, fresh.x, fresh.z)) {
        if (teleportToPose(spawnBeside(fresh, "interior", index), "party", inside)) await afterTransition();
      }
      return isNearMember(member);
    });
    return { started: true, done };
  }

  // No room reported: the packet came from our own room, so stay in it.
  if (!room && my.kind === "interior") {
    const parcel = index.parcelsById[my.parcelId];
    if (!parcel || !insideInterior(parcel, member.x, member.z)) return NOT_STARTED;
    return settled(member, teleportToPose(spawnBeside(member, "interior", index), "party", my));
  }
  // A street member must stand on the street map; anything else is stale or forged.
  if (!onStreetMap(index, member.x, member.z)) return NOT_STARTED;
  // From indoors the street colliders are not registered yet (any spot passes); the controller
  // pushes the player out of anything it lands in either way.
  return settled(member, teleportToPose(spawnBeside(member, "street", index), "party"));
}

/** The late-join offer's "Go to": hop next to the member, then report how it went. */
export function acceptJoinOffer(): void {
  const party = usePartyStore.getState();
  const offer = party.joinOffer;
  if (!offer) return;
  party.setJoinOffer(null);
  const member = usePresenceStore.getState().partyPeers[offer.memberId];
  const index = getCityIndex();
  const move = member && index ? goToPartyMember(member, index) : NOT_STARTED;
  void move.done.then((near) => usePartyStore.getState().resolveJoin(near));
}

/** The late-join offer was closed or timed out: the joiner keeps exploring on their own. */
export function dismissJoinOffer(): void {
  if (usePartyStore.getState().joinOffer) usePartyStore.getState().resolveJoin(false);
}

function locationKey(location: Location): string {
  return location.kind === "interior" ? `interior:${location.parcelId}` : "street";
}

/**
 * Places a link joiner next to a member once one is heard. Within `JOIN_WAIT_MS` that is a
 * straight teleport. Later (the inviter's phone was in their chat app, so their tab was hidden
 * and silent) the joiner is still moved if they have not left the deep link's spot, and is
 * offered a one-tap hop if they have. `party_joined` is reported once, when this resolves.
 * Returns the cleanup.
 */
function armJoin(code: string, index: CityIndex): () => void {
  const startedAt = Date.now();
  const spot = { x: playerRig.x, z: playerRig.z, where: locationKey(useWorldStore.getState().location) };
  let busy = false;
  let stopped = false;

  const stayedPut = () =>
    locationKey(useWorldStore.getState().location) === spot.where && distance2D(playerRig, spot) <= STAYED_PUT_M;

  const check = () => {
    const party = usePartyStore.getState();
    if (stopped || busy || party.pendingJoin !== code || party.joinOffer) return;
    // Left the party, or joined another one: the link join is over.
    if (party.code !== code) return party.resolveJoin(false);
    const elapsed = Date.now() - startedAt;
    if (elapsed > LATE_JOIN_MS) return party.resolveJoin(false);
    const member = firstMember();
    if (!member) return;
    if (elapsed > JOIN_WAIT_MS && !stayedPut()) {
      party.setJoinOffer({ code, memberId: member.id, name: member.name });
      return;
    }
    const move = goToPartyMember(member, getCityIndex() ?? index);
    // A transition was running or the member's spot was unusable: try again on the next poll.
    if (!move.started) return;
    busy = true;
    void move.done.then((near) => {
      busy = false;
      usePartyStore.getState().resolveJoin(near);
    });
  };

  const poll = setInterval(check, POLL_MS);
  const unsub = usePresenceStore.subscribe((s, prev) => {
    if (s.partyPeers !== prev.partyPeers) check();
  });
  // Leaving before anything resolved still counts the join (and gets it out before unload).
  const onPageHide = () => {
    usePartyStore.getState().resolveJoin(false);
    flush(true);
  };
  window.addEventListener("pagehide", onPageHide);
  check();

  return () => {
    stopped = true;
    clearInterval(poll);
    unsub();
    window.removeEventListener("pagehide", onPageHide);
  };
}

/** Drops `?party=` from the address bar so a reload after leaving does not rejoin. */
function stripPartyParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARTY_QUERY_PARAM)) return;
    url.searchParams.delete(PARTY_QUERY_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // An exotic history implementation: the link stays, nothing else depends on it.
  }
}

/**
 * Party lifecycle for this tab: restores the party from sessionStorage, joins from `?party=` and,
 * once the city is ready, places the joiner next to a member (see `armJoin`).
 */
export function useParty(): void {
  const ready = useWorldStore((s) => s.ready);
  // Presence of the index only: a rebuild at a phase boundary must not re-arm the join (that
  // would move the "where the link put you" spot to wherever the joiner has walked since).
  const hasIndex = useCityStore((s) => s.index !== null);
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

  // Not on mount: `session_started` reads `?party=` in its own (later-running, parent) effect.
  useEffect(() => {
    if (ready) stripPartyParam();
  }, [ready]);

  useEffect(() => {
    const index = getCityIndex();
    if (!ready || !hasIndex || !index || !pendingJoin) return;
    return armJoin(pendingJoin, index);
  }, [ready, hasIndex, pendingJoin]);
}
