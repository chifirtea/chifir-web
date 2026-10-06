import type { Id } from "@/types/domain";

export type HotspotKind = "door" | "exit" | "product" | "employee" | "event" | "info";

export interface Hotspot {
  id: string;
  kind: HotspotKind;
  /** Short verb phrase shown in the HUD, e.g. "Enter Ember & Oak". */
  label: string;
  x: number;
  z: number;
  /** Activation radius in metres. */
  radius: number;
  payload: {
    merchantId?: Id;
    /** For doors: which parcel's room to enter (pop-ups differ from the main store). */
    parcelId?: Id;
    productId?: Id;
    eventId?: Id;
  };
}
