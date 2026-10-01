import { useWorldStore, type WorldState } from "@/engine/store/worldStore";

interface EventPanelView {
  eventId: string | null;
  open: (eventId: string) => void;
  close: () => void;
}

const open = (eventId: string) => useWorldStore.getState().setEventPanel(eventId);
const close = () => useWorldStore.getState().setEventPanel(null);
const view = (w: WorldState): EventPanelView => ({ eventId: w.eventPanelId, open, close });

/**
 * The event sheet's state lives in the world store (so it locks input and closes with every other
 * panel); this is the event feature's view of it.
 */
export function useEventPanelStore<T>(selector: (s: EventPanelView) => T): T {
  return useWorldStore((w) => selector(view(w)));
}
useEventPanelStore.getState = (): EventPanelView => view(useWorldStore.getState());
