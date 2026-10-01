import { create } from "zustand";

interface EventPanelState {
  eventId: string | null;
  open: (eventId: string) => void;
  close: () => void;
}

/** Which event's sheet is open. Kept out of the world store so the HUD can own event UI. */
export const useEventPanelStore = create<EventPanelState>((set) => ({
  eventId: null,
  open: (eventId) => set({ eventId }),
  close: () => set({ eventId: null }),
}));
