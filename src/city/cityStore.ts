import { create } from "zustand";
import type { CitySnapshot } from "@/lib/data/types";
import { buildCityIndex, type CityIndex } from "./cityIndex";

interface CityState {
  index: CityIndex | null;
  setSnapshot: (snapshot: CitySnapshot) => void;
}

/** Client-side holder for the city data the server rendered into the page. */
export const useCityStore = create<CityState>((set) => ({
  index: null,
  setSnapshot: (snapshot) => set({ index: buildCityIndex(snapshot) }),
}));

export function getCityIndex(): CityIndex | null {
  return useCityStore.getState().index;
}
