"use client";

import type { StorefrontTemplateDef } from "../types";
import { boutiqueTemplate } from "./Boutique";

/**
 * Pop-up: the temporary structure an event's brand rents for one night. Registered under its own
 * id so parcels can request it; currently shares the boutique's geometry (the visual pass gives it
 * a distinct container/tent silhouette without touching the contract).
 */
export const popupTemplate: StorefrontTemplateDef = {
  ...boutiqueTemplate,
  id: "popup",
  label: "Pop-up",
  suitableFor: ["retail", "popup", "service", "venue"],
  suitableTiers: ["standard", "corner", "kiosk"],
};
