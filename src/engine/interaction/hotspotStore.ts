import { create } from "zustand";
import type { Hotspot } from "./hotspots";

export type HotspotScope = "street" | "interior";

interface HotspotState {
  scopes: Record<HotspotScope, Hotspot[]>;
  setHotspots: (scope: HotspotScope, hotspots: Hotspot[]) => void;
  clearHotspots: (scope: HotspotScope) => void;
}

/** Interactable points by scope. Scenes register on mount; the scanner reads the active scope. */
export const useHotspotStore = create<HotspotState>((set) => ({
  scopes: { street: [], interior: [] },
  setHotspots: (scope, hotspots) => set((s) => ({ scopes: { ...s.scopes, [scope]: hotspots } })),
  clearHotspots: (scope) => set((s) => ({ scopes: { ...s.scopes, [scope]: [] } })),
}));

export function getHotspots(scope: HotspotScope): Hotspot[] {
  return useHotspotStore.getState().scopes[scope];
}
