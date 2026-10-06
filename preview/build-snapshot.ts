/**
 * Writes the seed snapshot the static preview embeds. Imports the seed modules directly
 * (src/data/seed/index.ts is server-only) and projects employees to their public shape.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildParcels, districts } from "../src/data/seed/districts";
import { employees, merchants } from "../src/data/seed/merchants";
import { buildProducts } from "../src/data/seed/products";
import { rewards } from "../src/data/seed/rewards";
import { buildEvents } from "../src/data/seed/events";
import { buildOffers } from "../src/data/seed/offers";

const now = new Date();
// Parcels, products, events and offers all derive from one clock so the drop window agrees.
const snapshot = {
  districts,
  parcels: buildParcels(now),
  merchants,
  products: buildProducts(now),
  employees: employees.map((e) => ({
    id: e.id,
    merchantId: e.merchantId,
    name: e.name,
    role: e.role,
    greeting: e.greeting,
  })),
  events: buildEvents(now),
  offers: buildOffers(now),
  rewards,
  generatedAt: now.toISOString(),
};
const out = fileURLToPath(new URL("./snapshot.json", import.meta.url));
writeFileSync(out, JSON.stringify(snapshot));
console.log(`snapshot: ${merchants.length} merchants, ${snapshot.products.length} products → ${out}`);
