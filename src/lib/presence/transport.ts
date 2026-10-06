import { z } from "zod";
import type { RewardAppearance } from "@/types/domain";

/**
 * Presence wire contract (ADR-006). A packet is one peer's pose at one instant plus the few
 * cosmetic facts the receiver needs to draw them: avatar colours, outfit, name, party code.
 * Nothing in here is trusted: inbound packets go through `decodePacket` and anything that does
 * not validate is dropped. No user ids or emails ever travel in a packet.
 */

export type TransportKind = "supabase" | "broadcast";

/** Hex colour as the engine materials take it. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Party codes are short, uppercase and unambiguous; see features/party/partyLink.ts. */
export const PARTY_CODE_PATTERN = /^[A-Z0-9]{6,12}$/;
/** World coordinates stay well inside this (interiors live at z ≈ 5000). */
const MAX_COORD = 20_000;
export const MAX_NAME_CHARS = 24;
export const MAX_OUTFIT_FIELD_CHARS = 24;
export const MAX_ROOM_CHARS = 64;
/** Sender clocks past this (year 2100) are not clocks. */
const MAX_SENDER_CLOCK_MS = 4_102_444_800_000;

const colorSchema = z.string().regex(HEX_COLOR);
const shortText = (max: number) => z.string().min(1).max(max);
const coord = z.number().finite().min(-MAX_COORD).max(MAX_COORD);

/** The subset of a reward's appearance that is worth sending; everything else is derived. */
const outfitSchema = z
  .object({
    style: shortText(MAX_OUTFIT_FIELD_CHARS).optional(),
    primary: colorSchema.optional(),
    accent: colorSchema.optional(),
    print: shortText(MAX_OUTFIT_FIELD_CHARS).optional(),
  })
  .strict();

export const packetSchema = z
  .object({
    /**
     * Sender clock (ms since epoch). Receivers order by arrival and only use this to drop exact
     * duplicates: a peer-supplied clock must not be able to lock another peer out.
     */
    t: z.number().finite().nonnegative().max(MAX_SENDER_CLOCK_MS),
    /** Peer id: random per tab, never an account id. */
    id: z.string().min(1).max(40),
    x: coord,
    z: coord,
    yaw: z.number().finite(),
    /** Moving flag: 0 standing, 1 walking. */
    m: z.union([z.literal(0), z.literal(1)]),
    /** Avatar body + hair colour. */
    a: z.object({ b: colorSchema, h: colorSchema }).strict(),
    o: outfitSchema.optional(),
    n: shortText(MAX_NAME_CHARS),
    p: z.string().regex(PARTY_CODE_PATTERN).optional(),
    /** Room key of the sender (party channel only), so a member can be found across districts. */
    r: shortText(MAX_ROOM_CHARS).optional(),
  })
  .strict();

export type PresencePacket = z.infer<typeof packetSchema>;
export type PacketOutfit = z.infer<typeof outfitSchema>;

/** What a peer tracks as membership metadata (Supabase Presence) or announces on join. */
export interface PeerMeta {
  id: string;
  n: string;
  a: { b: string; h: string };
  o?: PacketOutfit;
  p?: string;
}

export const peerMetaSchema = z
  .object({
    id: z.string().min(1).max(40),
    n: shortText(MAX_NAME_CHARS),
    a: z.object({ b: colorSchema, h: colorSchema }).strict(),
    o: outfitSchema.optional(),
    p: z.string().regex(PARTY_CODE_PATTERN).optional(),
  })
  .strict();

/** Narrows a reward appearance to the fields a packet carries; null when nothing is sendable. */
export function outfitToPacket(outfit: RewardAppearance | null | undefined): PacketOutfit | undefined {
  if (!outfit) return undefined;
  const out: PacketOutfit = {};
  if (outfit.style && outfit.style.length <= MAX_OUTFIT_FIELD_CHARS) out.style = outfit.style;
  if (outfit.primary && HEX_COLOR.test(outfit.primary)) out.primary = outfit.primary;
  if (outfit.accent && HEX_COLOR.test(outfit.accent)) out.accent = outfit.accent;
  if (outfit.print) {
    const print = outfit.print.trim().slice(0, MAX_OUTFIT_FIELD_CHARS);
    if (print) out.print = print;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Inverse of `outfitToPacket` for the renderer. */
export function packetToOutfit(o: PacketOutfit | undefined): RewardAppearance | null {
  if (!o) return null;
  return {
    ...(o.style ? { style: o.style } : {}),
    ...(o.primary ? { primary: o.primary } : {}),
    ...(o.accent ? { accent: o.accent } : {}),
    ...(o.print ? { print: o.print } : {}),
  };
}

export function encodePacket(packet: PresencePacket): string {
  return JSON.stringify(packet);
}

/**
 * Parses and validates an inbound packet from a string or an already-parsed object. Returns
 * null for anything malformed, oversized or off-schema; callers drop those silently.
 */
export function decodePacket(raw: unknown): PresencePacket | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 2048) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = packetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function decodePeerMeta(raw: unknown): PeerMeta | null {
  const parsed = peerMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface TransportHandlers {
  /** A validated packet from another peer in the room. */
  onPacket: (packet: PresencePacket) => void;
  /** A peer announced itself (joined or re-announced); the hook answers with a prompt heartbeat. */
  onJoin?: (peerId: string) => void;
  /** A peer left the room explicitly. */
  onLeave: (peerId: string) => void;
  /** Authoritative membership snapshot (Supabase Presence sync); ids include our own. */
  onMembers?: (peerIds: readonly string[]) => void;
}

export interface JoinResult {
  ok: boolean;
  kind: TransportKind;
}

/**
 * One room, one transport session. Implementations are thin: Supabase Realtime (Presence for
 * membership, Broadcast for movement) and a same-origin `BroadcastChannel` for local
 * development, static previews and end-to-end tests. Nothing here is authoritative.
 */
export interface PresenceTransport {
  readonly kind: TransportKind;
  readonly room: string;
  /** Resolves once the room is joined, or with `ok: false` when the transport cannot connect. */
  join(self: PeerMeta, handlers: TransportHandlers): Promise<JoinResult>;
  /** Fire-and-forget. Called at ≤ 10 Hz by the publisher; implementations never throw. */
  publish(packet: PresencePacket): void;
  /** Updates what others see about us without re-joining (party code, outfit, name). */
  updateMeta(self: PeerMeta): void;
  leave(): void;
}

/** Hard ceiling for inbound packets per peer per second; anything faster is ignored. */
export const MAX_PACKETS_PER_SECOND = 30;
/** Most peers one room keeps (far beyond what is drawn); a flood of fake ids stops here. */
export const MAX_ROOM_PEERS = 200;
/** Parties are a few friends; more "members" than this is noise. */
export const MAX_PARTY_PEERS = 16;
/** New peer ids admitted per second per room; rotating ids does not get around the rate limit. */
export const MAX_NEW_PEERS_PER_SECOND = 20;
/** After the network transport fails, how long until it is tried again (also for a live room). */
export const TRANSPORT_RETRY_MS = 60_000;
/** Outbound cadence of the room publisher. */
export const PUBLISH_INTERVAL_MS = 100;
/** A standing peer still announces itself this often so silence means "gone". */
export const HEARTBEAT_MS = 1000;
/** Position and heading deltas below these are not worth a packet. */
export const MIN_MOVE_M = 0.02;
export const MIN_TURN_RAD = Math.PI / 180;
