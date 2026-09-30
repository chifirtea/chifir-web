/* eslint-disable no-restricted-imports -- test only: seed modules never reach the client bundle */
import { describe, expect, it } from "vitest";
import { buildParcels, districts } from "@/data/seed/districts";
import { buildEvents } from "@/data/seed/events";
import { sid } from "@/data/seed/ids";
import { employees, merchants } from "@/data/seed/merchants";
import { buildOffers } from "@/data/seed/offers";
import { buildProducts } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import { dropWindow } from "@/data/seed/time";
import type { CitySnapshot } from "@/lib/data/types";
import { buildCityIndex, merchantsInDistrict, productsAtParcel } from "./cityIndex";

const NOW = new Date("2026-09-30T18:00:00Z");

function snapshot(now: Date): CitySnapshot {
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

const northline = sid.merchant("northline-supply");
const popup = sid.parcel("es-pop1");
const flagship = sid.parcel("fa-n2");

describe("city index tenancy", () => {
  const snap = snapshot(NOW);
  const { start, end } = dropWindow(NOW);

  it("keeps the flagship as the merchant's storefront parcel before, during and after the drop", () => {
    for (const t of [start.getTime() - 1, start.getTime(), end.getTime()]) {
      expect(buildCityIndex(snap, t).parcelByMerchant[northline]?.id).toBe(flagship);
    }
  });

  it("lists the pop-up among occupied parcels only while its tenancy is open", () => {
    const before = buildCityIndex(snap, start.getTime() - 1);
    const during = buildCityIndex(snap, start.getTime() + 60_000);
    const after = buildCityIndex(snap, end.getTime());
    expect(before.occupiedParcels.some((p) => p.id === popup)).toBe(false);
    expect(during.occupiedParcels.some((p) => p.id === popup)).toBe(true);
    expect(after.occupiedParcels.some((p) => p.id === popup)).toBe(false);
    expect(during.occupiedParcels.filter((p) => p.tier === "billboard")).toHaveLength(0);
  });

  it("attaches the drop event to the pop-up parcel until it ends", () => {
    const before = buildCityIndex(snap, start.getTime() - 1);
    const after = buildCityIndex(snap, end.getTime());
    expect(before.eventByParcel[popup]?.slug).toBe("northline-night-shift");
    expect(after.eventByParcel[popup]).toBeUndefined();
  });

  it("shows the collection inside the pop-up and the full catalog inside the flagship", () => {
    const during = buildCityIndex(snap, start.getTime() + 60_000);
    const inPopup = productsAtParcel(during, during.parcelsById[popup]!);
    const inFlagship = productsAtParcel(during, during.parcelsById[flagship]!);
    expect(inPopup.map((p) => p.slug).sort()).toEqual([
      "night-shift-hoodie-bone",
      "night-shift-hoodie-ink",
      "night-shift-hoodie-signal",
      "night-shift-zip-hoodie",
    ]);
    expect(inFlagship.length).toBeGreaterThan(inPopup.length);
  });

  it("counts Northline in Event Square only while the pop-up is open", () => {
    const eventSquare = sid.district("event-square");
    const before = merchantsInDistrict(buildCityIndex(snap, start.getTime() - 1), eventSquare).map(
      (m) => m.slug,
    );
    const during = merchantsInDistrict(buildCityIndex(snap, start.getTime() + 1), eventSquare).map(
      (m) => m.slug,
    );
    expect(before).not.toContain("northline-supply");
    expect(during).toContain("northline-supply");
    expect(during).toContain("the-hall");
  });
});
