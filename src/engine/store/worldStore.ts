import { create } from "zustand";
import type { Hotspot } from "@/engine/interaction/hotspots";
import type { NavTarget } from "@/types/domain";

/**
 * Where the player is. Interiors are keyed by the parcel whose door was used: a merchant's
 * permanent store and its event pop-up are different rooms with different products.
 */
export type Location =
  { kind: "street" } | { kind: "interior"; merchantId: string; parcelId: string };

/**
 * Yaw convention (everywhere in the engine): forward = (sin(yaw), 0, cos(yaw)).
 * yaw 0 faces +Z, PI/2 faces +X, PI faces -Z. This is three.js `Object3D.rotation.y`.
 */
export interface PlayerPose {
  x: number;
  z: number;
  yaw: number;
}

export interface Waypoint {
  target: NavTarget;
  x: number;
  z: number;
  label: string;
}

export type TransitionPhase = "idle" | "out" | "in";

export interface PendingTransition {
  pose: PlayerPose;
  location?: Location;
  /** Called after the player has been moved, before fading back in. */
  onCommit?: () => void;
}

export interface WorldState {
  ready: boolean;
  location: Location;
  transition: TransitionPhase;
  /** Monotonic counter; the Fade driver uses it to restart its timeline. */
  transitionId: number;
  pending: PendingTransition | null;
  waypoint: Waypoint | null;
  activeHotspot: Hotspot | null;
  focusedProductId: string | null;
  talkingToMerchantId: string | null;
  /** Merchant whose overview sheet is open (AI `open_merchant`, card "Details"). */
  merchantPanelId: string | null;
  /** Parcel whose door is lit up in-world (AI `highlight_storefront`, party pings). */
  highlightedParcelId: string | null;
  /** Event whose sheet is open (Event HUD, Places "Details", AI). */
  eventPanelId: string | null;
  conciergeOpen: boolean;
  cartOpen: boolean;
  placesOpen: boolean;
  /** Text to pre-fill the concierge with (deep link `?ask=`). */
  conciergeSeed: string | null;

  setReady: (ready: boolean) => void;
  /**
   * Starts a fade-out. Returns false only while a fade-out is already in progress; during
   * fade-in the new request replaces the old one and the fade reverses.
   */
  beginTransition: (pending: PendingTransition) => boolean;
  /** Called by the Fade driver at full black. Applies the pending location and returns it. */
  commitTransition: () => PendingTransition | null;
  /** Called by the Fade driver when fully visible again. */
  endTransition: () => void;
  /** Recovery hook for Canvas/Fade mount and unmount: never leave input locked. */
  resetTransition: () => void;
  setLocation: (location: Location) => void;
  setWaypoint: (waypoint: Waypoint | null) => void;
  setActiveHotspot: (hotspot: Hotspot | null) => void;
  setFocusedProduct: (productId: string | null) => void;
  setTalkingTo: (merchantId: string | null) => void;
  setMerchantPanel: (merchantId: string | null) => void;
  setEventPanel: (eventId: string | null) => void;
  setHighlightedParcel: (parcelId: string | null) => void;
  setConciergeOpen: (open: boolean, seed?: string | null) => void;
  setCartOpen: (open: boolean) => void;
  setPlacesOpen: (open: boolean) => void;
  closeAllPanels: () => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  ready: false,
  location: { kind: "street" },
  transition: "idle",
  transitionId: 0,
  pending: null,
  waypoint: null,
  activeHotspot: null,
  focusedProductId: null,
  talkingToMerchantId: null,
  merchantPanelId: null,
  highlightedParcelId: null,
  eventPanelId: null,
  conciergeOpen: false,
  cartOpen: false,
  placesOpen: false,
  conciergeSeed: null,

  setReady: (ready) => set({ ready }),
  beginTransition: (pending) => {
    const { transition, transitionId } = get();
    if (transition === "out") return false;
    set({ pending, transition: "out", transitionId: transitionId + 1, activeHotspot: null });
    return true;
  },
  commitTransition: () => {
    const { pending, transition } = get();
    if (transition !== "out") return null;
    set({
      transition: "in",
      pending: null,
      ...(pending?.location ? { location: pending.location } : {}),
    });
    return pending;
  },
  endTransition: () => {
    if (get().transition === "in") set({ transition: "idle" });
  },
  resetTransition: () => set({ transition: "idle", pending: null }),
  setLocation: (location) => set({ location }),
  setWaypoint: (waypoint) => set({ waypoint }),
  setActiveHotspot: (activeHotspot) => {
    if (get().activeHotspot?.id === activeHotspot?.id) return;
    set({ activeHotspot });
  },
  setFocusedProduct: (focusedProductId) => set({ focusedProductId }),
  setTalkingTo: (talkingToMerchantId) => set({ talkingToMerchantId }),
  setMerchantPanel: (merchantPanelId) => set({ merchantPanelId }),
  setEventPanel: (eventPanelId) => set({ eventPanelId }),
  setHighlightedParcel: (highlightedParcelId) => {
    if (get().highlightedParcelId === highlightedParcelId) return;
    set({ highlightedParcelId });
  },
  setConciergeOpen: (conciergeOpen, seed = null) =>
    set({ conciergeOpen, conciergeSeed: conciergeOpen ? seed : null }),
  setCartOpen: (cartOpen) => set({ cartOpen }),
  setPlacesOpen: (placesOpen) => set({ placesOpen }),
  closeAllPanels: () =>
    set({
      focusedProductId: null,
      talkingToMerchantId: null,
      merchantPanelId: null,
      eventPanelId: null,
      conciergeOpen: false,
      cartOpen: false,
      placesOpen: false,
    }),
}));

/** True while any overlay owns keyboard/touch input or a transition is running. */
export const selectInputLocked = (s: WorldState): boolean =>
  s.transition !== "idle" ||
  s.focusedProductId !== null ||
  s.talkingToMerchantId !== null ||
  s.merchantPanelId !== null ||
  s.eventPanelId !== null ||
  s.conciergeOpen ||
  s.cartOpen ||
  s.placesOpen;
