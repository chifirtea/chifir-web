import { registerInteriorTemplate } from "../registry";
import { restaurantCounterTemplate } from "./RestaurantCounter";
import { restaurantDiningTemplate } from "./RestaurantDining";
import { retailRacksTemplate } from "./RetailRacks";
import { retailGalleryTemplate } from "./RetailGallery";
import { popupGalleryTemplate } from "./PopupGallery";

/** Importing this module once registers every interior template. */
export const interiorTemplates = [
  restaurantCounterTemplate,
  restaurantDiningTemplate,
  retailRacksTemplate,
  retailGalleryTemplate,
  popupGalleryTemplate,
] as const;

for (const def of interiorTemplates) registerInteriorTemplate(def);

export {
  restaurantCounterTemplate,
  restaurantDiningTemplate,
  retailRacksTemplate,
  retailGalleryTemplate,
  popupGalleryTemplate,
};
