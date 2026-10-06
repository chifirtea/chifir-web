import { create } from "zustand";
import type { RewardAppearance } from "@/types/domain";

interface AvatarState {
  /** What the player's avatar wears over the default body; null = default look. */
  outfit: RewardAppearance | null;
  setOutfit: (outfit: RewardAppearance | null) => void;
}

/**
 * Engine-side mirror of the equipped outfit. Features (entitlements) write it; the engine never
 * imports feature code, so this is the hand-off point.
 */
export const useAvatarStore = create<AvatarState>((set) => ({
  outfit: null,
  setOutfit: (outfit) => set({ outfit }),
}));
