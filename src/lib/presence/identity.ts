/**
 * Who we are on the wire: a random per-tab peer id (never an account id), a display name that
 * never reveals an email, and a deterministic body colour so the same tab keeps the same look.
 */

export const PEER_ID_STORAGE_KEY = "chifir.peer.v1";

/** Muted, contemporary tones; shared with the ambient walkers' palette in spirit, not code. */
export const PEER_BODY_COLORS = [
  "#8a5a44", "#2f3e5c", "#5c3a4a", "#3d5a4a", "#6b6b78", "#a0522d", "#7a6a52", "#4a3f6b",
  "#c46a3a", "#1f5f5b", "#b23a48", "#4f6d7a", "#d9b26f", "#3b2f2f", "#2b6ca3", "#8c6d31",
] as const;

export const PEER_HAIR_COLORS = ["#1a120e", "#3b2416", "#6b4a2a", "#0e0e10", "#8a7a68", "#a8532c"] as const;

/** FNV-1a 32-bit; stable across runs and engines. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

/** Random per tab, kept across reloads of that tab (sessionStorage). */
export function getPeerId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = sessionStorage.getItem(PEER_ID_STORAGE_KEY);
    if (existing && /^[a-z0-9]{8,40}$/i.test(existing)) return existing;
    const id = randomId();
    sessionStorage.setItem(PEER_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

export function bodyColorFor(peerId: string): string {
  return PEER_BODY_COLORS[hashString(peerId) % PEER_BODY_COLORS.length]!;
}

export function hairColorFor(peerId: string): string {
  return PEER_HAIR_COLORS[hashString(`hair:${peerId}`) % PEER_HAIR_COLORS.length]!;
}

/** "Citizen 7KQ": three unambiguous characters derived from the peer id. */
export function fallbackName(peerId: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let h = hashString(`name:${peerId}`);
  let tag = "";
  for (let i = 0; i < 3; i++) {
    tag += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length);
  }
  return `Citizen ${tag}`;
}

/** Trims a chosen display name to what a packet carries; falls back when empty. */
export function displayNameFor(peerId: string, chosen: string | null | undefined, max: number): string {
  const clean = (chosen ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return clean || fallbackName(peerId);
}
