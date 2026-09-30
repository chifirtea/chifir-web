import "server-only";
import type { CitySnapshot } from "@/lib/data/types";
import { districts, parcels } from "./districts";
import { employees, merchants } from "./merchants";
import { products } from "./products";
import { rewards } from "./rewards";
import { buildOffers } from "./offers";
import { buildEvents } from "./events";

export { districts, parcels, merchants, employees, products, rewards, buildOffers, buildEvents };

/**
 * Full seed snapshot. `employees` carries the complete configs; StaticDataSource projects them to
 * the public shape before anything leaves the server.
 */
export function buildCitySnapshot(now = new Date()): CitySnapshot & { employees: typeof employees } {
  return {
    districts,
    parcels,
    merchants,
    products,
    employees,
    events: buildEvents(now),
    offers: buildOffers(now),
    rewards,
    generatedAt: now.toISOString(),
  };
}
