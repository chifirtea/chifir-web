import type { Identity, PresenceState } from "./presenceStore";
import { partyRoom } from "./rooms";
import {
  HEARTBEAT_MS,
  MIN_MOVE_M,
  MIN_TURN_RAD,
  outfitToPacket,
  TRANSPORT_RETRY_MS,
  type PeerMeta,
  type PresencePacket,
  type PresenceTransport,
  type TransportHandlers,
  type TransportKind,
} from "./transport";

/**
 * Drives presence from a 10 Hz tick: joins and leaves the room that matches the player's
 * location, keeps the party channel open while in a party, publishes the rig pose when it
 * changed (or as a heartbeat), applies inbound packets to the store and despawns silent peers.
 * Pure TypeScript so the hook stays a thin lifecycle wrapper and this can be unit-tested with a
 * fake transport.
 */

export interface TickInput {
  /** The city is up (canvas presented); nothing is published before that. */
  ready: boolean;
  /** Tab hidden: keep listening, stop publishing (peers despawn us after a few seconds). */
  hidden: boolean;
  /** Room key for the player's current location (see rooms.ts). */
  room: string;
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  me: Identity;
  /**
   * A party member stands nearby but in another room (just across a district edge): the party
   * channel then carries full-rate poses so they stay smooth on each other's screens.
   */
  partyDetail?: boolean;
}

export type ConnectFn = (
  room: string,
  self: PeerMeta,
  handlers: TransportHandlers,
) => Promise<PresenceTransport | null>;

export interface ControllerDeps {
  connect: ConnectFn;
  /**
   * Tries the network transport alone for a room that fell back to the same-browser one; null
   * when no network transport is configured. Retried every `TRANSPORT_RETRY_MS` while the room
   * stays the same, so one slow join does not leave someone invisible for the whole district.
   */
  upgrade?: ConnectFn | null;
  store: Pick<
    PresenceState,
    | "setRoom"
    | "setTransport"
    | "applyPacket"
    | "applyPartyPacket"
    | "removePeer"
    | "removePartyPeer"
    | "retainPeers"
    | "retainPartyPeers"
    | "prune"
    | "clearPartyPeers"
  >;
  /**
   * `presence_joined` sink; the hook binds it to analytics. Called once the room has had a
   * chance to fill (first membership sync, or `ROOM_SETTLE_MS` after the join) so a peer count
   * read from the store means something.
   */
  onRoomJoined: (room: string, transport: TransportKind) => void;
  now: () => number;
}

/** The party channel publishes coarse poses: enough to find a member, cheap enough to keep open. */
const PARTY_MIN_MOVE_M = 0.5;
const PARTY_MIN_INTERVAL_MS = 500;
const PARTY_HEARTBEAT_MS = 1000;
const PRUNE_INTERVAL_MS = 1000;
/** How long after a join `presence_joined` waits for peers to announce themselves. */
export const ROOM_SETTLE_MS = 2000;

interface Session {
  room: string;
  /** The party channel: no `presence_joined`, and the store's `transport` is the room's. */
  party: boolean;
  transport: PresenceTransport | null;
  handlers: TransportHandlers | null;
  /** Set when the join resolved (either way) so a failure is not retried every tick. */
  settled: boolean;
  disposed: boolean;
  /** Last published pose, for change detection. */
  lastX: number;
  lastZ: number;
  lastYaw: number;
  lastMoving: boolean | null;
  /** Room key carried by the last party packet; a new one is news for the members. */
  lastRoom: string | null;
  lastAt: number;
  /** Publish on the next tick regardless of thresholds (join, meta change, peer joined). */
  force: boolean;
  /** `presence_joined` bookkeeping: due at `reportAt`, or at the first membership sync. */
  reportAt: number;
  reported: boolean;
  synced: boolean;
  /** Next attempt to move a same-browser fallback onto the network transport. */
  upgradeAt: number;
  upgrading: boolean;
}

function newSession(room: string, party: boolean): Session {
  return {
    room,
    party,
    transport: null,
    handlers: null,
    settled: false,
    disposed: false,
    lastX: NaN,
    lastZ: NaN,
    lastYaw: NaN,
    lastMoving: null,
    lastRoom: null,
    lastAt: -Infinity,
    force: true,
    reportAt: Infinity,
    reported: false,
    synced: false,
    upgradeAt: Infinity,
    upgrading: false,
  };
}

export function identityToMeta(me: Identity): PeerMeta {
  const o = outfitToPacket(me.outfit);
  return {
    id: me.peerId,
    n: me.name,
    a: { b: me.bodyColor, h: me.hairColor },
    ...(o ? { o } : {}),
    ...(me.partyCode ? { p: me.partyCode } : {}),
  };
}

function wrap(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class PresenceController {
  private roomSession: Session | null = null;
  private partySession: Session | null = null;
  private metaKey = "";
  private meta: PeerMeta | null = null;
  private lastPrune = -Infinity;
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {}

  /** Called at ~10 Hz. Cheap when nothing changed. */
  tick(input: TickInput): void {
    if (this.disposed || !input.me.peerId || !input.me.name) return;
    const now = this.deps.now();
    const meta = identityToMeta(input.me);

    // Room: follow the location; leave when the city is not ready (canvas unmounted).
    if (!input.ready) {
      this.closeRoom();
    } else if (!this.roomSession || this.roomSession.room !== input.room) {
      this.openRoom(input.room, meta);
    }

    // Party channel: open while in a party, closed otherwise.
    const partyKey = input.me.partyCode ? partyRoom(input.me.partyCode) : null;
    if (!partyKey) {
      this.closeParty();
    } else if (!this.partySession || this.partySession.room !== partyKey) {
      this.openParty(partyKey, meta);
    }

    // Metadata (name, outfit, party code) changed: tell the transports and re-announce quickly.
    this.meta = meta;
    const metaKey = JSON.stringify(meta);
    if (metaKey !== this.metaKey) {
      this.metaKey = metaKey;
      for (const s of [this.roomSession, this.partySession]) {
        if (!s) continue;
        s.transport?.updateMeta(meta);
        s.force = true;
      }
    }

    if (!input.hidden) {
      const room = this.roomSession;
      if (room?.transport && this.due(room, input, now, MIN_MOVE_M, MIN_TURN_RAD, HEARTBEAT_MS, 0)) {
        room.transport.publish(this.packet(input, meta, now));
        this.mark(room, input, now);
      }
      const party = this.partySession;
      if (party && party.lastRoom !== input.room) party.force = true;
      const partyDue =
        party?.transport &&
        (input.partyDetail
          ? this.due(party, input, now, MIN_MOVE_M, MIN_TURN_RAD, HEARTBEAT_MS, 0)
          : this.due(party, input, now, PARTY_MIN_MOVE_M, Infinity, PARTY_HEARTBEAT_MS, PARTY_MIN_INTERVAL_MS));
      if (party?.transport && partyDue) {
        party.transport.publish({ ...this.packet(input, meta, now), r: input.room });
        this.mark(party, input, now);
        party.lastRoom = input.room;
      }
    }

    for (const s of [this.roomSession, this.partySession]) {
      if (s) this.maintain(s, meta, now);
    }

    if (now - this.lastPrune >= PRUNE_INTERVAL_MS) {
      this.lastPrune = now;
      this.deps.store.prune(now);
    }
  }

  /** Leaves every room. Safe to call twice. */
  dispose(): void {
    this.disposed = true;
    this.closeRoom();
    this.closeParty();
  }

  /**
   * Leaves every room but keeps ticking: the next tick rejoins. For `pagehide`, so peers drop us
   * at once, and a page restored from the back/forward cache comes back without a remount.
   */
  suspend(): void {
    this.closeRoom();
    this.closeParty();
  }

  /** Re-announce on both channels (tab became visible again). */
  nudge(): void {
    if (this.roomSession) this.roomSession.force = true;
    if (this.partySession) this.partySession.force = true;
  }

  private due(
    s: Session,
    input: TickInput,
    now: number,
    minMove: number,
    minTurn: number,
    heartbeat: number,
    minInterval: number,
  ): boolean {
    // Forced packets (join, look or room change, a peer arrived) are rare: they skip the spacing.
    if (s.force) return true;
    if (now - s.lastAt < minInterval) return false;
    if (now - s.lastAt >= heartbeat) return true;
    // Stopping is news: without it receivers extrapolate past the stop until the next heartbeat.
    if (input.moving !== s.lastMoving) return true;
    const dx = input.x - s.lastX;
    const dz = input.z - s.lastZ;
    if (Number.isNaN(s.lastX) || dx * dx + dz * dz > minMove * minMove) return true;
    return Math.abs(wrap(input.yaw - s.lastYaw)) > minTurn;
  }

  private mark(s: Session, input: TickInput, now: number): void {
    s.lastX = input.x;
    s.lastZ = input.z;
    s.lastYaw = input.yaw;
    s.lastMoving = input.moving;
    s.lastAt = now;
    s.force = false;
  }

  /** Per-tick upkeep for a joined session: the delayed `presence_joined` and the upgrade retry. */
  private maintain(s: Session, meta: PeerMeta, now: number): void {
    const transport = s.transport;
    if (!transport || s.disposed) return;
    if (!s.party && !s.reported && (s.synced || now >= s.reportAt)) {
      s.reported = true;
      this.deps.onRoomJoined(s.room, transport.kind);
    }
    const upgrade = this.deps.upgrade;
    if (!upgrade || transport.kind !== "broadcast" || s.upgrading || now < s.upgradeAt || !s.handlers) return;
    s.upgrading = true;
    void upgrade(s.room, meta, s.handlers).then(
      (next) => this.upgraded(s, next),
      () => this.upgraded(s, null),
    );
  }

  private upgraded(s: Session, next: PresenceTransport | null): void {
    s.upgrading = false;
    const now = this.deps.now();
    if (!next) {
      s.upgradeAt = now + TRANSPORT_RETRY_MS;
      return;
    }
    if (s.disposed) {
      next.leave();
      return;
    }
    const old = s.transport;
    s.transport = next;
    // The metadata may have changed while the upgrade was in flight.
    if (this.meta) next.updateMeta(this.meta);
    s.force = true;
    s.upgradeAt = Infinity;
    old?.leave();
    if (!s.party) {
      this.deps.store.setTransport(next.kind);
      s.reported = false;
      s.synced = false;
      s.reportAt = now + ROOM_SETTLE_MS;
    }
  }

  /** Bookkeeping once a session's first join resolved. */
  private joined(s: Session, transport: PresenceTransport | null): void {
    s.settled = true;
    if (s.disposed) {
      transport?.leave();
      return;
    }
    s.transport = transport;
    s.force = true;
    const now = this.deps.now();
    s.reportAt = now + ROOM_SETTLE_MS;
    if (transport?.kind === "broadcast") s.upgradeAt = now + TRANSPORT_RETRY_MS;
    if (!s.party) this.deps.store.setTransport(transport?.kind ?? null);
  }

  private packet(input: TickInput, meta: PeerMeta, now: number): PresencePacket {
    return {
      t: now,
      id: meta.id,
      x: round(input.x),
      z: round(input.z),
      yaw: round(input.yaw),
      m: input.moving ? 1 : 0,
      a: meta.a,
      ...(meta.o ? { o: meta.o } : {}),
      n: meta.n,
      ...(meta.p ? { p: meta.p } : {}),
    };
  }

  private openRoom(room: string, meta: PeerMeta): void {
    this.closeRoom();
    const session = newSession(room, false);
    this.roomSession = session;
    this.deps.store.setRoom(room, null);
    const { store } = this.deps;
    const handlers: TransportHandlers = {
      onPacket: (packet) => {
        if (!session.disposed) store.applyPacket(packet, this.deps.now());
      },
      onJoin: () => {
        session.force = true;
      },
      onLeave: (id) => {
        if (!session.disposed) store.removePeer(id);
      },
      onMembers: (ids) => {
        if (session.disposed) return;
        session.synced = true;
        store.retainPeers(ids, this.deps.now());
      },
    };
    session.handlers = handlers;
    void this.deps.connect(room, meta, handlers).then(
      (transport) => this.joined(session, transport),
      () => {
        session.settled = true;
      },
    );
  }

  private closeRoom(): void {
    const s = this.roomSession;
    if (!s) return;
    this.roomSession = null;
    s.disposed = true;
    s.transport?.leave();
    s.transport = null;
    this.deps.store.setRoom(null, null);
  }

  private openParty(room: string, meta: PeerMeta): void {
    this.closeParty();
    const session = newSession(room, true);
    this.partySession = session;
    const { store } = this.deps;
    const handlers: TransportHandlers = {
      onPacket: (packet) => {
        if (!session.disposed) store.applyPartyPacket(packet, this.deps.now());
      },
      onJoin: () => {
        session.force = true;
      },
      onLeave: (id) => {
        if (!session.disposed) store.removePartyPeer(id);
      },
      onMembers: (ids) => {
        if (!session.disposed) store.retainPartyPeers(ids, this.deps.now());
      },
    };
    session.handlers = handlers;
    void this.deps.connect(room, meta, handlers).then(
      (transport) => this.joined(session, transport),
      () => {
        session.settled = true;
      },
    );
  }

  private closeParty(): void {
    const s = this.partySession;
    if (!s) return;
    this.partySession = null;
    s.disposed = true;
    s.transport?.leave();
    s.transport = null;
    this.deps.store.clearPartyPeers();
  }
}

/** Centimetre precision keeps packets short without visible quantisation. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}
