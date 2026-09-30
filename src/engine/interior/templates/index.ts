import { registerInteriorTemplate } from "../registry";
import { restaurantCounterTemplate } from "./RestaurantCounter";
import { restaurantDiningTemplate } from "./RestaurantDining";
import { retailRacksTemplate } from "./RetailRacks";
import { retailGalleryTemplate } from "./RetailGallery";

/** Importing this module once registers every interior template. */
export const interiorTemplates = [restaurantCounterTemplate, restaurantDiningTemplate, retailRacksTemplate, retailGalleryTemplate] as const;

for (const def of interiorTemplates) registerInteriorTemplate(def);

export { restaurantCounterTemplate, restaurantDiningTemplate, retailRacksTemplate, retailGalleryTemplate };
