import type { District, Parcel } from "@/types/domain";
import { sid } from "./ids";
import { dropWindow } from "./time";

export const districts: District[] = [
  {
    id: sid.district("central-plaza"),
    slug: "central-plaza",
    name: "Central Plaza",
    description: "Where everyone arrives. Fountains, benches, and the road to everything else.",
    theme: { accent: "#FFC46B", ambience: "warm", pavement: "plaza" },
    bounds: { minX: -40, minZ: -40, maxX: 40, maxZ: 40 },
    spawnPoint: { x: 0, z: 21, yaw: Math.PI },
    sortOrder: 0,
  },
  {
    id: sid.district("food-street"),
    slug: "food-street",
    name: "Food Street",
    description: "Smoke, steam and neon. Five kitchens and counting, all delivering to your door.",
    theme: { accent: "#FF5A36", ambience: "neon", pavement: "brick" },
    bounds: { minX: 40, minZ: -30, maxX: 150, maxZ: 30 },
    spawnPoint: { x: 48, z: 0, yaw: Math.PI / 2 },
    sortOrder: 1,
  },
  {
    id: sid.district("fashion-street"),
    slug: "fashion-street",
    name: "Fashion Street",
    description: "Flagships, ateliers and a florist that knows what tonight is about.",
    theme: { accent: "#C8A27A", ambience: "cool", pavement: "stone" },
    bounds: { minX: -150, minZ: -30, maxX: -40, maxZ: 30 },
    spawnPoint: { x: -48, z: 0, yaw: -Math.PI / 2 },
    sortOrder: 2,
  },
  {
    id: sid.district("event-square"),
    slug: "event-square",
    name: "Event Square",
    description: "Drops, live sets and openings. Something is always scheduled.",
    theme: { accent: "#8B5CF6", ambience: "neon", pavement: "asphalt" },
    bounds: { minX: -60, minZ: -140, maxX: 60, maxZ: -40 },
    spawnPoint: { x: 0, z: -48, yaw: Math.PI },
    sortOrder: 3,
  },
];

const D = Object.fromEntries(districts.map((d) => [d.slug, d.id])) as Record<string, string>;

function parcel(
  slug: string,
  districtSlug: string,
  position: { x: number; z: number },
  rotationY: number,
  tier: Parcel["tier"],
  merchantSlug?: string,
  sponsored = false,
): Parcel {
  const sizes: Record<Parcel["tier"], { width: number; depth: number }> = {
    standard: { width: 16, depth: 14 },
    corner: { width: 20, depth: 16 },
    flagship: { width: 26, depth: 18 },
    kiosk: { width: 8, depth: 6 },
    venue: { width: 40, depth: 24 },
    billboard: { width: 12, depth: 2 },
  };
  return {
    id: sid.parcel(slug),
    districtId: D[districtSlug]!,
    slug,
    position,
    rotationY,
    size: sizes[tier],
    tier,
    status: merchantSlug ? "occupied" : "available",
    ...(merchantSlug ? { merchantId: sid.merchant(merchantSlug) } : {}),
    sponsored,
  };
}

/**
 * Yaw convention: forward = (sin(yaw), 0, cos(yaw)); yaw 0 faces +Z, PI/2 faces +X.
 * Streets run along X at z = 0, 14 m wide. North-side parcels (negative Z) face +Z (rotation 0);
 * south-side parcels face -Z (rotation PI). Event Square is north of the plaza (negative Z).
 */
export function buildParcels(now = new Date()): Parcel[] {
  const drop = dropWindow(now);
  return [
    // Food Street — north side
    parcel("fs-n1", "food-street", { x: 58, z: -14 }, 0, "standard", "ember-and-oak"),
    parcel("fs-n2", "food-street", { x: 82, z: -14 }, 0, "standard", "kori-ramen"),
    parcel("fs-n3", "food-street", { x: 106, z: -14 }, 0, "standard"),
    parcel("fs-n4", "food-street", { x: 130, z: -15 }, 0, "corner", "la-dolce-sera"),
    // Food Street — south side
    parcel("fs-s1", "food-street", { x: 58, z: 14 }, Math.PI, "standard", "saffron-alley"),
    parcel("fs-s2", "food-street", { x: 82, z: 14 }, Math.PI, "standard", "verde-bowl"),
    parcel("fs-s3", "food-street", { x: 106, z: 14 }, Math.PI, "standard"),
    parcel("fs-s4", "food-street", { x: 130, z: 15 }, Math.PI, "corner", undefined, true),
    // Fashion Street — north side
    parcel("fa-n1", "fashion-street", { x: -58, z: -14 }, 0, "standard", "atelier-mira"),
    parcel("fa-n2", "fashion-street", { x: -84, z: -16 }, 0, "flagship", "northline-supply", true),
    parcel("fa-n3", "fashion-street", { x: -112, z: -14 }, 0, "standard"),
    // Fashion Street — south side
    parcel("fa-s1", "fashion-street", { x: -58, z: 14 }, Math.PI, "standard", "bloom-and-co"),
    parcel("fa-s2", "fashion-street", { x: -84, z: 14 }, Math.PI, "standard"),
    parcel("fa-s3", "fashion-street", { x: -112, z: 10 }, Math.PI, "kiosk"),
    // Event Square
    parcel("es-venue", "event-square", { x: 0, z: -100 }, 0, "venue", "the-hall", true),
    parcel("es-bb1", "event-square", { x: -34, z: -66 }, 0, "billboard"),
    parcel("es-bb2", "event-square", { x: 34, z: -66 }, 0, "billboard"),
    // Event Square pop-up lot: rented by the drop's brand for the drop window only. It faces +X,
    // toward the square's centre, so a crowd in front of it is also in front of The Hall.
    {
      ...parcel(
        "es-pop1",
        "event-square",
        { x: -38, z: -92 },
        Math.PI / 2,
        "standard",
        "northline-supply",
        true,
      ),
      occupiedFrom: drop.start.toISOString(),
      occupiedUntil: drop.end.toISOString(),
      storefrontTemplate: "popup",
      interiorTemplate: "popup-gallery",
    },
    // Plaza kiosk (pop-up slot)
    parcel("cp-k1", "central-plaza", { x: 22, z: -22 }, 0, "kiosk"),
  ];
}

/** Parcels for the real clock (seed script, tests). */
export const parcels: Parcel[] = buildParcels();
