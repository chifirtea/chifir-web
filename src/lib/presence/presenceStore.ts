import { create } from "zustand";
import type { RewardAppearance } from "@/types/domain";
import { isStreetRoom } from "./rooms";
import {
  createBuffer,
  isSilent,
  pushSample,
  type InterpolationBuffer,
} from "./interpolation";
import {
  MAX_NEW_PEERS_PER_SECOND,
  MAX_PACKETS_PER_SECOND,
  MAX_PARTY_PEERS,
  MAX_ROOM_PEERS,
  packetToOutfit,
  type PresencePacket,
  type TransportKind,
} from "./transport";

/** A remote player in our room. The buffer and rate fields are mutated in place every packet. */
export interface Peer {
  id: string;
  name: string;
  bodyColor: string;
  hairColor: string;
  outfit: RewardAppearance | null;
  partyCode: string | null;
  buffer: InterpolationBuffer;
  /** Receiver clock of the last accepted packet. */
  lastSeen: number;
  /** Sender clock of the last accepted packet; a repeat of it is a duplicate and dropped. */
  lastT: number;
  rate: RateWindow;
}

/**
 * A party member heard on the party channel, whatever room they are in. Pose, buffer and clocks
 * are mutated in place; the record is replaced only on join, room change or look change, so the
 * member list re-renders for those and not for every step.
 */
export interface PartyPeer {
  id: string;
  name: string;
  bodyColor: string;
  hairColor: string;
  outfit: RewardAppearance | null;
  x: number;
  z: number;
  yaw: number;
  /** Room key the member reported, when known. */
  room: string | null;
  /** For drawing a member who stands nearby but in another room (across a district edge). */
  buffer: InterpolationBuffer;
  lastSeen: number;
  lastT: number;
  rate: RateWindow;
}

export interface RateWindow {
  /** Start of the current one-second window (receiver clock). */
  start: number;
  count: number;
}

export interface Identity {
  peerId: string;
  name: string;
  bodyColor: string;
  hairColor: string;
  outfit: RewardAppearance | null;
  partyCode: string | null;
}

export interface PresenceState {
  /** Room we are in (joined or joining); null before the city is ready. */
  room: string | null;
  /** Which transport carried the current room; null while connecting. */
  transport: TransportKind | null;
  me: Identity;
  /**
   * Peers by id. The record's identity changes only on join, leave and metadata change so React
   * subscribers re-render for those; position samples go into each peer's buffer in place.
   */
  peers: Record<string, Peer>;
  partyPeers: Record<string, PartyPeer>;

  setMe: (patch: Partial<Identity>) => void;
  /** Switching rooms clears peers: nobody from the old room can be in the new one. */
  setRoom: (room: string | null, transport: TransportKind | null) => void;
  setTransport: (transport: TransportKind | null) => void;
  /** Applies a validated room packet. Returns false when ignored (self, duplicate, rate-limited, room full). */
  applyPacket: (packet: PresencePacket, now: number) => boolean;
  applyPartyPacket: (packet: PresencePacket, now: number) => boolean;
  removePeer: (peerId: string) => void;
  removePartyPeer: (peerId: string) => void;
  /**
   * Membership snapshot from an authoritative source: drop anyone not listed, except peers heard
   * within `MEMBERSHIP_GRACE_MS` (their first packet can beat their presence join to us).
   */
  retainPeers: (peerIds: readonly string[], now: number) => void;
  retainPartyPeers: (peerIds: readonly string[], now: number) => void;
  /** Despawns peers silent for longer than DESPAWN_MS. Returns the removed ids. */
  prune: (now: number) => string[];
  clearPeers: () => void;
  clearPartyPeers: () => void;
}

/** A peer heard this recently survives a membership snapshot that does not list it yet. */
export const MEMBERSHIP_GRACE_MS = 2000;

const DEFAULT_IDENTITY: Identity = {
  peerId: "",
  name: "",
  bodyColor: "#4F86F7",
  hairColor: "#2B2118",
  outfit: null,
  partyCode: null,
};

/** One-second window; true when this event exceeds `limit` within the window. */
function overRate(rate: RateWindow, now: number, limit: number = MAX_PACKETS_PER_SECOND): boolean {
  if (now - rate.start >= 1000) {
    rate.start = now;
    rate.count = 0;
  }
  rate.count += 1;
  return rate.count > limit;
}

/**
 * New-id admission windows (room and party). Not React state: only the packet path reads them.
 * Reset whenever the set they guard is cleared.
 */
const roomAdmissions: RateWindow = { start: -Infinity, count: 0 };
const partyAdmissions: RateWindow = { start: -Infinity, count: 0 };
function resetWindow(rate: RateWindow): void {
  rate.start = -Infinity;
  rate.count = 0;
}

/** Whether a packet from an id we have not seen yet may create a peer. */
function admit(size: number, cap: number, window: RateWindow, now: number): boolean {
  return size < cap && !overRate(window, now, MAX_NEW_PEERS_PER_SECOND);
}

function sameOutfit(a: RewardAppearance | null, b: RewardAppearance | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.style === b.style && a.primary === b.primary && a.accent === b.accent && a.print === b.print;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  room: null,
  transport: null,
  me: DEFAULT_IDENTITY,
  peers: {},
  partyPeers: {},

  setMe: (patch) => set((s) => ({ me: { ...s.me, ...patch } })),
  setRoom: (room, transport) => {
    resetWindow(roomAdmissions);
    set({ room, transport, peers: {} });
  },
  setTransport: (transport) => set({ transport }),

  applyPacket: (packet, now) => {
    const { peers, me } = get();
    if (packet.id === me.peerId) return false;
    const existing = peers[packet.id];
    if (existing) {
      if (overRate(existing.rate, now)) return false;
      // Arrival order: both transports deliver one sender's packets in order. Trusting the sender
      // clock for ordering let a single forged far-future `t` lock the real peer out.
      if (packet.t === existing.lastT) return false;
      existing.lastT = packet.t;
      existing.lastSeen = now;
      pushSample(existing.buffer, { t: now, x: packet.x, z: packet.z, yaw: packet.yaw, moving: packet.m === 1 });
      const outfit = packetToOutfit(packet.o);
      const partyCode = packet.p ?? null;
      const changed =
        existing.name !== packet.n ||
        existing.bodyColor !== packet.a.b ||
        existing.hairColor !== packet.a.h ||
        existing.partyCode !== partyCode ||
        !sameOutfit(existing.outfit, outfit);
      if (changed) {
        const next: Peer = { ...existing, name: packet.n, bodyColor: packet.a.b, hairColor: packet.a.h, outfit, partyCode };
        set({ peers: { ...peers, [packet.id]: next } });
      }
      return true;
    }
    if (!admit(Object.keys(peers).length, MAX_ROOM_PEERS, roomAdmissions, now)) return false;
    const buffer = createBuffer();
    pushSample(buffer, { t: now, x: packet.x, z: packet.z, yaw: packet.yaw, moving: packet.m === 1 });
    const peer: Peer = {
      id: packet.id,
      name: packet.n,
      bodyColor: packet.a.b,
      hairColor: packet.a.h,
      outfit: packetToOutfit(packet.o),
      partyCode: packet.p ?? null,
      buffer,
      lastSeen: now,
      lastT: packet.t,
      rate: { start: now, count: 1 },
    };
    set({ peers: { ...peers, [packet.id]: peer } });
    return true;
  },

  applyPartyPacket: (packet, now) => {
    const { partyPeers, me } = get();
    if (packet.id === me.peerId) return false;
    // Only members of our party belong in the list, whatever channel delivered the packet.
    if (!me.partyCode || packet.p !== me.partyCode) return false;
    const room = packet.r ?? null;
    const outfit = packetToOutfit(packet.o);
    const sample = { t: now, x: packet.x, z: packet.z, yaw: packet.yaw, moving: packet.m === 1 };
    const existing = partyPeers[packet.id];
    if (existing) {
      if (overRate(existing.rate, now)) return false;
      if (packet.t === existing.lastT) return false;
      existing.x = packet.x;
      existing.z = packet.z;
      existing.yaw = packet.yaw;
      existing.lastSeen = now;
      existing.lastT = packet.t;
      pushSample(existing.buffer, sample);
      const changed =
        existing.room !== room ||
        existing.name !== packet.n ||
        existing.bodyColor !== packet.a.b ||
        existing.hairColor !== packet.a.h ||
        !sameOutfit(existing.outfit, outfit);
      if (changed) {
        const next: PartyPeer = { ...existing, name: packet.n, bodyColor: packet.a.b, hairColor: packet.a.h, outfit, room };
        set({ partyPeers: { ...partyPeers, [packet.id]: next } });
      }
      return true;
    }
    if (!admit(Object.keys(partyPeers).length, MAX_PARTY_PEERS, partyAdmissions, now)) return false;
    const buffer = createBuffer();
    pushSample(buffer, sample);
    const peer: PartyPeer = {
      id: packet.id,
      name: packet.n,
      bodyColor: packet.a.b,
      hairColor: packet.a.h,
      outfit,
      x: packet.x,
      z: packet.z,
      yaw: packet.yaw,
      room,
      buffer,
      lastSeen: now,
      lastT: packet.t,
      rate: { start: now, count: 1 },
    };
    set({ partyPeers: { ...partyPeers, [packet.id]: peer } });
    return true;
  },

  removePeer: (peerId) => {
    const { peers } = get();
    if (!peers[peerId]) return;
    const next = { ...peers };
    delete next[peerId];
    set({ peers: next });
  },
  removePartyPeer: (peerId) => {
    const { partyPeers } = get();
    if (!partyPeers[peerId]) return;
    const next = { ...partyPeers };
    delete next[peerId];
    set({ partyPeers: next });
  },

  retainPeers: (peerIds, now) => {
    const { peers } = get();
    const keep = new Set(peerIds);
    const gone = Object.values(peers)
      .filter((p) => !keep.has(p.id) && now - p.lastSeen > MEMBERSHIP_GRACE_MS)
      .map((p) => p.id);
    if (gone.length === 0) return;
    const next = { ...peers };
    for (const id of gone) delete next[id];
    set({ peers: next });
  },
  retainPartyPeers: (peerIds, now) => {
    const { partyPeers } = get();
    const keep = new Set(peerIds);
    const gone = Object.values(partyPeers)
      .filter((p) => !keep.has(p.id) && now - p.lastSeen > MEMBERSHIP_GRACE_MS)
      .map((p) => p.id);
    if (gone.length === 0) return;
    const next = { ...partyPeers };
    for (const id of gone) delete next[id];
    set({ partyPeers: next });
  },

  prune: (now) => {
    const { peers, partyPeers } = get();
    const removed: string[] = [];
    let nextPeers: Record<string, Peer> | null = null;
    for (const peer of Object.values(peers)) {
      if (!isSilent(peer.lastSeen, now)) continue;
      nextPeers ??= { ...peers };
      delete nextPeers[peer.id];
      removed.push(peer.id);
    }
    let nextParty: Record<string, PartyPeer> | null = null;
    for (const peer of Object.values(partyPeers)) {
      if (!isSilent(peer.lastSeen, now)) continue;
      nextParty ??= { ...partyPeers };
      delete nextParty[peer.id];
      removed.push(peer.id);
    }
    if (nextPeers || nextParty) {
      set({ ...(nextPeers ? { peers: nextPeers } : {}), ...(nextParty ? { partyPeers: nextParty } : {}) });
    }
    return removed;
  },

  clearPeers: () => {
    resetWindow(roomAdmissions);
    set({ peers: {} });
  },
  clearPartyPeers: () => {
    resetWindow(partyAdmissions);
    set({ partyPeers: {} });
  },
}));

/** Everyone in the room including us. */
export const selectRoomCount = (s: PresenceState): number => Object.keys(s.peers).length + 1;

/** Party members heard on the party channel (not including us). */
export const selectPartyPeers = (s: PresenceState): Record<string, PartyPeer> => s.partyPeers;

export const selectPartyMemberCount = (s: PresenceState): number =>
  s.me.partyCode ? Object.keys(s.partyPeers).length + 1 : 0;

/**
 * Party members on the street within this distance but in another district room are drawn from
 * the party channel (and that channel then carries full-rate poses), so two friends a few steps
 * apart on either side of a district edge never lose sight of each other.
 */
export const PARTY_CROSS_ROOM_RADIUS_M = 60;

/** True when this party member should be drawn from the party channel rather than the room. */
export function seenAcrossRooms(member: PartyPeer, myRoom: string | null, x: number, z: number): boolean {
  if (!isStreetRoom(myRoom) || !isStreetRoom(member.room) || member.room === myRoom) return false;
  const dx = member.x - x;
  const dz = member.z - z;
  return dx * dx + dz * dz <= PARTY_CROSS_ROOM_RADIUS_M * PARTY_CROSS_ROOM_RADIUS_M;
}

/** Any party member nearby in another room (see `seenAcrossRooms`). */
export function partyNearbyElsewhere(s: PresenceState, myRoom: string | null, x: number, z: number): boolean {
  if (!s.me.partyCode) return false;
  for (const id in s.partyPeers) {
    const member = s.partyPeers[id];
    if (member && seenAcrossRooms(member, myRoom, x, z)) return true;
  }
  return false;
}
