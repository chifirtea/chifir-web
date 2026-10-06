"use client";

import { create } from "zustand";
import { usePresenceStore } from "@/lib/presence/presenceStore";
import { track } from "@/lib/analytics/client";
import { generatePartyCode, parsePartyCode } from "./partyLink";

export const PARTY_STORAGE_KEY = "chifir.party.v1";

interface Persisted {
  code: string;
  joinedAt: number;
}

export interface PartyState {
  /** The party we are in, or null. Mirrored into the presence identity so packets carry it. */
  code: string | null;
  joinedAt: number | null;
  /** True once sessionStorage has been read (avoids a server/client mismatch on first paint). */
  hydrated: boolean;
  /** A `?party=` code waiting for the city to be ready so the joiner can be placed. */
  pendingJoin: string | null;

  hydrate: () => void;
  /** Creates a party or returns the current one. */
  createOrGet: () => string;
  /** Joins by code (from a link). Returns false for an invalid code. */
  join: (raw: string) => boolean;
  leave: () => void;
  setPendingJoin: (code: string | null) => void;
}

function readPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(PARTY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const code = parsePartyCode(typeof parsed.code === "string" ? parsed.code : null);
    if (!code) return null;
    return { code, joinedAt: typeof parsed.joinedAt === "number" ? parsed.joinedAt : Date.now() };
  } catch {
    return null;
  }
}

function writePersisted(value: Persisted | null): void {
  try {
    if (value) sessionStorage.setItem(PARTY_STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PARTY_STORAGE_KEY);
  } catch {
    // Private mode: the party lasts for this page load only.
  }
}

function apply(set: (patch: Partial<PartyState>) => void, code: string | null, joinedAt: number | null): void {
  set({ code, joinedAt });
  usePresenceStore.getState().setMe({ partyCode: code });
  writePersisted(code && joinedAt !== null ? { code, joinedAt } : null);
}

/**
 * The party is a code shared by link. Membership is whoever broadcasts the same code; there is
 * no server record, nothing to moderate, nothing that touches commerce.
 */
export const usePartyStore = create<PartyState>((set, get) => ({
  code: null,
  joinedAt: null,
  hydrated: false,
  pendingJoin: null,

  hydrate: () => {
    if (get().hydrated) return;
    const stored = readPersisted();
    set({ hydrated: true });
    if (stored && !get().code) apply(set, stored.code, stored.joinedAt);
  },
  createOrGet: () => {
    const current = get().code;
    if (current) return current;
    const code = generatePartyCode();
    apply(set, code, Date.now());
    return code;
  },
  join: (raw) => {
    const code = parsePartyCode(raw);
    if (!code) return false;
    if (get().code !== code) apply(set, code, Date.now());
    return true;
  },
  leave: () => {
    const { code, joinedAt } = get();
    if (!code) return;
    track("party_left", { partyCode: code, seconds: joinedAt ? Math.round((Date.now() - joinedAt) / 1000) : 0 });
    apply(set, null, null);
    set({ pendingJoin: null });
  },
  setPendingJoin: (pendingJoin) => set({ pendingJoin }),
}));
