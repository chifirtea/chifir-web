import { describe, expect, it } from "vitest";
import { districts, buildParcels } from "@/data/seed/districts";
import { storefrontTemplates } from "@/engine/storefront/templates";
import { interiorTemplates } from "@/engine/interior/templates";
import { validatePlacement } from "@/engine/storefront/types";
import type { Merchant, MerchantType, Parcel } from "@/types/domain";
import {
  INTERIOR_RULES,
  INTERIOR_RULE_LIST,
  STOREFRONT_RULES,
  STOREFRONT_RULE_LIST,
  defaultTemplates,
  freeParcels,
  interiorTemplatesFor,
  isFreeParcel,
  placementOptions,
  placementProblem,
  storefrontTemplatesFor,
  suggestDistrict,
} from "./placement";

const TYPES: MerchantType[] = ["restaurant", "retail", "service", "venue", "popup"];
const parcels = buildParcels(new Date("2026-10-06T12:00:00Z"));
const districtId = (slug: string) => districts.find((d) => d.slug === slug)!.id;

describe("template rule mirror", () => {
  it("matches the storefront registry (labels, types, tiers)", () => {
    expect(STOREFRONT_RULE_LIST.map((r) => r.id).sort()).toEqual(storefrontTemplates.map((t) => t.id).sort());
    for (const def of storefrontTemplates) {
      const rule = STOREFRONT_RULES[def.id];
      expect(rule.label, def.id).toBe(def.label);
      expect([...rule.suitableFor].sort(), def.id).toEqual([...def.suitableFor].sort());
      expect([...rule.suitableTiers].sort(), def.id).toEqual([...def.suitableTiers].sort());
    }
  });

  it("matches the interior registry", () => {
    expect(INTERIOR_RULE_LIST.map((r) => r.id).sort()).toEqual(interiorTemplates.map((t) => t.id).sort());
    for (const def of interiorTemplates) {
      expect(INTERIOR_RULES[def.id].label, def.id).toBe(def.label);
      expect([...INTERIOR_RULES[def.id].suitableFor].sort(), def.id).toEqual([...def.suitableFor].sort());
    }
  });

  it("agrees with validatePlacement for every template × type × seed parcel (footprints included)", () => {
    const stores = parcels.filter((p) => p.tier !== "billboard");
    for (const def of storefrontTemplates) {
      for (const merchantType of TYPES) {
        for (const parcel of stores) {
          const merchant = { merchantType } as Merchant;
          expect(placementProblem(def.id, merchantType, parcel), `${def.id}/${merchantType}/${parcel.slug}`).toBe(
            validatePlacement(def, merchant, parcel),
          );
        }
      }
    }
  });

  it("defaults are valid for their type", () => {
    for (const type of TYPES) {
      const { storefront, interior } = defaultTemplates(type);
      expect(STOREFRONT_RULES[storefront].suitableFor).toContain(type);
      expect(INTERIOR_RULES[interior].suitableFor).toContain(type);
      expect(storefrontTemplatesFor(type).map((r) => r.id)).toContain(storefront);
      expect(interiorTemplatesFor(type).map((r) => r.id)).toContain(interior);
    }
    expect(storefrontTemplatesFor("restaurant").map((r) => r.id)).toEqual(["bistro", "fast-casual", "cafe", "kiosk"]);
  });
});

describe("free parcels", () => {
  it("lists only available, untenanted, non-billboard lots", () => {
    const free = freeParcels(parcels);
    expect(free.length).toBeGreaterThan(0);
    for (const p of free) {
      expect(p.status).toBe("available");
      expect(p.merchantId).toBeUndefined();
      expect(p.tier).not.toBe("billboard");
    }
    expect(free.map((p) => p.slug)).not.toContain("es-pop1"); // the pop-up lot is rented
    expect(free.map((p) => p.slug)).not.toContain("es-bb1");
    expect(freeParcels(parcels, districtId("food-street")).every((p) => p.districtId === districtId("food-street"))).toBe(true);
  });

  it("treats reserved and tenanted lots as taken", () => {
    const base = parcels.find((p) => p.slug === "fs-n3")!;
    expect(isFreeParcel(base)).toBe(true);
    expect(isFreeParcel({ ...base, status: "reserved" })).toBe(false);
    expect(isFreeParcel({ ...base, merchantId: "mer_x" })).toBe(false);
  });

  it("flags which free lots fit the chosen template", () => {
    const options = placementOptions(parcels, { merchantType: "retail", storefrontTemplate: "boutique" }, districtId("fashion-street"));
    const bySlug = Object.fromEntries(options.map((o) => [o.parcel.slug, o]));
    expect(bySlug["fa-n3"]?.fits).toBe(true);
    expect(bySlug["fa-s3"]?.fits).toBe(false); // kiosk lot
    expect(bySlug["fa-s3"]?.problem).toMatch(/kiosk/);
    const kiosk = placementOptions(parcels, { merchantType: "retail", storefrontTemplate: "kiosk" });
    expect(kiosk.filter((o) => o.fits).every((o) => o.parcel.tier === "kiosk")).toBe(true);
  });
});

describe("suggestDistrict", () => {
  it("routes by category namespace", () => {
    expect(suggestDistrict("food.ramen", districts, parcels)?.slug).toBe("food-street");
    expect(suggestDistrict("fashion.apparel", districts, parcels)?.slug).toBe("fashion-street");
    expect(suggestDistrict("beauty.skincare", districts, parcels)?.slug).toBe("fashion-street");
    expect(suggestDistrict("gifts.prints", districts, parcels)?.slug).toBe("central-plaza");
  });

  it("falls back when the preferred district is full", () => {
    const foodFull: Parcel[] = parcels.map((p) =>
      p.districtId === districtId("food-street") ? { ...p, status: "occupied", merchantId: "mer_x" } : p,
    );
    expect(suggestDistrict("food.ramen", districts, foodFull)?.slug).toBe("central-plaza");
    const allFull = parcels.map((p) => ({ ...p, status: "occupied" as const, merchantId: "mer_x" }));
    expect(suggestDistrict("food.ramen", districts, allFull)).toBeUndefined();
  });
});
