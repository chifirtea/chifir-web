import "server-only";
import type { CitySnapshot } from "@/lib/data/types";
import { buildParcels, districts, parcels } from "./districts";
import { employees, merchants } from "./merchants";
import { buildProducts, products } from "./products";
import { rewards } from "./rewards";
import { buildOffers } from "./offers";
import { buildEvents } from "./events";

export {
  districts,
  parcels,
  buildParcels,
  merchants,
  employees,
  products,
  buildProducts,
  rewards,
  buildOffers,
  buildEvents,
};

/**
 * Full seed snapshot for a given clock. `employees` carries the complete configs; StaticDataSource
 * projects them to the public shape before anything leaves the server.
 */
export function buildCitySnapshot(
  now = new Date(),
): CitySnapshot & { employees: typeof employees } {
  return {
    districts,
    parcels: buildParcels(now),
    merchants,
    products: buildProducts(now),
    employees,
    events: buildEvents(now),
    offers: buildOffers(now),
    rewards,
    generatedAt: now.toISOString(),
  };
}
