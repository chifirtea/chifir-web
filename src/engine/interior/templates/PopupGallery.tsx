"use client";

import type { InteriorTemplateDef } from "../types";
import { retailGalleryTemplate } from "./RetailGallery";

/**
 * Pop-up gallery: the inside of an event pop-up. Shows only the event's collection (the renderer
 * filters products per parcel). Shares the gallery room for now; the visual pass restyles it.
 */
export const popupGalleryTemplate: InteriorTemplateDef = {
  ...retailGalleryTemplate,
  id: "popup-gallery",
  label: "Pop-up gallery",
  suitableFor: ["retail", "popup", "venue"],
};
