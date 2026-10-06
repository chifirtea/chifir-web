import { create } from "zustand";
import { resolvePreset, type QualitySettings, type QualityTier } from "./quality";

interface QualityState {
  settings: QualitySettings;
  mobile: boolean;
  /** Set once from detection; later tier changes keep it. */
  configure: (tier: QualityTier, mobile: boolean) => void;
  setTier: (tier: QualityTier) => void;
}

export const useQualityStore = create<QualityState>((set, get) => ({
  settings: resolvePreset("medium", { mobile: false }),
  mobile: false,
  configure: (tier, mobile) => set({ settings: resolvePreset(tier, { mobile }), mobile }),
  setTier: (tier) => {
    if (get().settings.tier === tier) return;
    set({ settings: resolvePreset(tier, { mobile: get().mobile }) });
  },
}));

/** Runtime quality settings (re-renders when the tier changes). */
export function useQuality(): QualitySettings {
  return useQualityStore((s) => s.settings);
}

export function setQualityTier(tier: QualityTier): void {
  useQualityStore.getState().setTier(tier);
}
