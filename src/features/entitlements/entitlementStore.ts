"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AvatarSlot, DigitalReward, Id } from "@/types/domain";
import { useAvatarStore } from "@/engine/store/avatarStore";

export type EntitlementSource = "purchase" | "event" | "admin" | "account";

export interface Entitlement {
  rewardId: Id;
  reward: DigitalReward;
  source: EntitlementSource;
  orderId?: Id;
  grantedAt: string;
}

export interface EntitlementState {
  entitlements: Record<Id, Entitlement>;
  equipped: Partial<Record<AvatarSlot, Id>>;
  /** Idempotent: granting the same reward twice keeps the first grant. */
  grant: (rewards: DigitalReward[], source: EntitlementSource, orderId?: Id) => Id[];
  grantFromOrder: (orderId: Id, rewards: DigitalReward[]) => Id[];
  equip: (rewardId: Id) => boolean;
  unequip: (slot: AvatarSlot) => void;
  /** Server grants for a signed-in user; never removes local (guest) grants. */
  mergeFromServer: (rewards: DigitalReward[]) => void;
  clear: () => void;
}

export const ENTITLEMENTS_STORAGE_KEY = "chifir.entitlements.v1";

function pushOutfit(state: Pick<EntitlementState, "entitlements" | "equipped">): void {
  const id = state.equipped.outfit;
  const reward = id ? state.entitlements[id]?.reward : undefined;
  useAvatarStore.getState().setOutfit(reward?.appearance ?? null);
}

/**
 * The player's digital entitlements: twins of things they bought, event rewards, account items.
 * Guests keep them in this browser; signing in merges the server's grants on top (the order page
 * claims guest orders into the account, so the two sets converge).
 */
export const useEntitlementStore = create<EntitlementState>()(
  persist(
    (set, get) => ({
      entitlements: {},
      equipped: {},
      grant: (rewards, source, orderId) => {
        const granted: Id[] = [];
        const now = new Date().toISOString();
        set((s) => {
          const next = { ...s.entitlements };
          for (const reward of rewards) {
            if (next[reward.id]) continue;
            next[reward.id] = {
              rewardId: reward.id,
              reward,
              source,
              grantedAt: now,
              ...(orderId ? { orderId } : {}),
            };
            granted.push(reward.id);
          }
          return granted.length ? { entitlements: next } : {};
        });
        return granted;
      },
      grantFromOrder: (orderId, rewards) => get().grant(rewards, "purchase", orderId),
      equip: (rewardId) => {
        const e = get().entitlements[rewardId];
        const slot = e?.reward.avatarSlot;
        if (!e || !slot) return false;
        set((s) => ({ equipped: { ...s.equipped, [slot]: rewardId } }));
        pushOutfit(get());
        return true;
      },
      unequip: (slot) => {
        set((s) => {
          const next = { ...s.equipped };
          delete next[slot];
          return { equipped: next };
        });
        pushOutfit(get());
      },
      mergeFromServer: (rewards) => {
        get().grant(rewards, "account");
      },
      clear: () => {
        set({ entitlements: {}, equipped: {} });
        pushOutfit(get());
      },
    }),
    {
      name: ENTITLEMENTS_STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ entitlements: s.entitlements, equipped: s.equipped }),
      onRehydrateStorage: () => (state) => {
        if (state) pushOutfit(state);
      },
    },
  ),
);

export const selectEntitlementList = (s: EntitlementState): Entitlement[] =>
  Object.values(s.entitlements).sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt));

export const selectIsEquipped = (rewardId: Id) => (s: EntitlementState): boolean =>
  Object.values(s.equipped).includes(rewardId);
