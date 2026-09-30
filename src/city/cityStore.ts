import { create } from "zustand";
import type { CitySnapshot } from "@/lib/data/types";
import { now as clockNow } from "@/lib/time/clock";
import { buildCityIndex, type CityIndex } from "./cityIndex";

interface CityState {
  index: CityIndex | null;
  setSnapshot: (snapshot: CitySnapshot, now?: number) => void;
  /** Rebuilds the index for the current clock (an event started, a pop-up opened). */
  refreshIndex: (now?: number) => void;
}

/** Client-side holder for the city data the server rendered into the page. */
export const useCityStore = create<CityState>((set, get) => ({
  index: null,
  setSnapshot: (snapshot, now = clockNow()) => set({ index: buildCityIndex(snapshot, now) }),
  refreshIndex: (now = clockNow()) => {
    const current = get().index;
    if (!current) return;
    set({ index: buildCityIndex(current.snapshot, now) });
  },
}));

export function getCityIndex(): CityIndex | null {
  return useCityStore.getState().index;
}
