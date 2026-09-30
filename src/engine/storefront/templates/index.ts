import { registerStorefrontTemplate } from "../registry";
import { bistroTemplate } from "./Bistro";
import { fastCasualTemplate } from "./FastCasual";
import { cafeTemplate } from "./Cafe";
import { boutiqueTemplate } from "./Boutique";
import { flagshipTemplate } from "./Flagship";
import { kioskTemplate } from "./Kiosk";

/**
 * Importing this module once registers every procedural storefront template. The city app must
 * import it before anything resolves templates (renderer, navigation, colliders).
 */
export const storefrontTemplates = [bistroTemplate, fastCasualTemplate, cafeTemplate, boutiqueTemplate, flagshipTemplate, kioskTemplate] as const;

for (const def of storefrontTemplates) registerStorefrontTemplate(def);

export { bistroTemplate, fastCasualTemplate, cafeTemplate, boutiqueTemplate, flagshipTemplate, kioskTemplate };
