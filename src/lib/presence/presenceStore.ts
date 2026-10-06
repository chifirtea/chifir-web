import { create } from "zustand";
import type { RewardAppearance } from "@/types/domain";
import {
  createBuffer,
  isSilent,
  pushSample,
  type InterpolationBuffer,
} from "./interpolation";
import {
  MAX_PACKETS_PER_SECOND,
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
  /** Sender clock of the last accepted packet; older ones are out of order and dropped. */
  lastT: number;
  rate: RateWindow;
}

/** A party member heard on the party channel: coarse pose + room, not interpolated. */
export interface PartyPeer {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Room key the member reported, when known. */
  room: string | null;
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
  /** Applies a validated room packet. Returns false when ignored (self, stale, rate-limited). */
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

/** Sliding one-second window; true when this packet exceeds the per-peer ceiling. */
function overRate(rate: RateWindow, now: number): boolean {
  if (now - rate.start >= 1000) {
    rate.start = now;
    rate.count = 0;
  }
  rate.count += 1;
  return rate.count > MAX_PACKETS_PER_SECOND;
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
  setRoom: (room, transport) => set({ room, transport, peers: {} }),
  setTransport: (transport) => set({ transport }),

  applyPacket: (packet, now) => {
    const { peers, me } = get();
    if (packet.id === me.peerId) return false;
    const existing = peers[packet.id];
    if (existing) {
      if (overRate(existing.rate, now)) return false;
      if (packet.t <= existing.lastT) return false;
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
    const existing = partyPeers[packet.id];
    if (existing) {
      if (overRate(existing.rate, now)) return false;
      if (packet.t <= existing.lastT) return false;
      const room = packet.r ?? null;
      const next: PartyPeer = { ...existing, name: packet.n, x: packet.x, z: packet.z, yaw: packet.yaw, room, lastSeen: now, lastT: packet.t };
      set({ partyPeers: { ...partyPeers, [packet.id]: next } });
      return true;
    }
    const peer: PartyPeer = {
      id: packet.id,
      name: packet.n,
      x: packet.x,
      z: packet.z,
      yaw: packet.yaw,
      room: packet.r ?? null,
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

  clearPeers: () => set({ peers: {} }),
  clearPartyPeers: () => set({ partyPeers: {} }),
}));

/** Everyone in the room including us. */
export const selectRoomCount = (s: PresenceState): number => Object.keys(s.peers).length + 1;

/** Party members heard on the party channel (not including us). */
export const selectPartyPeers = (s: PresenceState): Record<string, PartyPeer> => s.partyPeers;

export const selectPartyMemberCount = (s: PresenceState): number =>
  s.me.partyCode ? Object.keys(s.partyPeers).length + 1 : 0;
