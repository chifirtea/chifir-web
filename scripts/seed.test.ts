import { describe, expect, it } from "vitest";
import { districts, parcels } from "@/data/seed/districts";
import { employees, merchants } from "@/data/seed/merchants";
import { products } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import { buildOffers } from "@/data/seed/offers";
import { buildEvents } from "@/data/seed/events";
import {
  rowToDistrict,
  rowToEmployee,
  rowToEvent,
  rowToMerchant,
  rowToOffer,
  rowToParcel,
  rowToProduct,
  rowToReward,
} from "@/lib/data/supabase";
import {
  toDistrictRow,
  toEmployeeRow,
  toEventRow,
  toMerchantRow,
  toOfferRow,
  toParcelRow,
  toProductRow,
  toRewardRow,
  type Row,
} from "./seedMappers";

const NOW = new Date("2026-09-30T20:00:00Z");
const offers = buildOffers(NOW);
const events = buildEvents(NOW);

/** Columns per table, from supabase/migrations/0001_init.sql + 0002_city_alive.sql (excluding defaults the seed never sets). */
const COLUMNS: Record<string, string[]> = {
  districts: [
    "id",
    "slug",
    "name",
    "description",
    "theme",
    "bounds",
    "spawn_point",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  parcels: [
    "id",
    "district_id",
    "slug",
    "position",
    "rotation_y",
    "size",
    "tier",
    "status",
    "merchant_id",
    "occupied_from",
    "occupied_until",
    "storefront_template",
    "interior_template",
    "sponsored",
    "created_at",
    "updated_at",
  ],
  merchants: [
    "id",
    "slug",
    "name",
    "tagline",
    "description",
    "category",
    "merchant_type",
    "status",
    "tags",
    "price_level",
    "logo_url",
    "hero_image_url",
    "images",
    "brand",
    "website_url",
    "address",
    "geo",
    "opening_hours",
    "storefront_template",
    "interior_template",
    "storefront_config",
    "fulfillment",
    "sponsored",
    "rating",
    "rating_count",
    "created_at",
    "updated_at",
  ],
  ai_employees: [
    "id",
    "merchant_id",
    "name",
    "role",
    "avatar_url",
    "personality",
    "tone",
    "greeting",
    "knowledge",
    "upsell_rules",
    "prohibited_claims",
    "brand_language",
    "escalation",
    "allowed_context",
    "created_at",
    "updated_at",
  ],
  digital_rewards: [
    "id",
    "slug",
    "name",
    "description",
    "kind",
    "avatar_slot",
    "appearance",
    "asset_url",
    "preview_image_url",
    "rarity",
    "created_at",
  ],
  products: [
    "id",
    "merchant_id",
    "slug",
    "title",
    "description",
    "category",
    "price_cents",
    "currency",
    "compare_at_price_cents",
    "image_url",
    "images",
    "model_3d_url",
    "inventory_status",
    "inventory_count",
    "variant_groups",
    "attributes",
    "tags",
    "fulfillment_types",
    "lead_time",
    "digital_reward_id",
    "available_from",
    "available_until",
    "featured",
    "sort_order",
    "active",
    "search_tsv",
    "created_at",
    "updated_at",
    "event_id",
  ],
  offers: [
    "id",
    "slug",
    "merchant_id",
    "product_id",
    "scope",
    "title",
    "description",
    "kind",
    "value",
    "code",
    "starts_at",
    "ends_at",
    "max_redemptions",
    "redemptions_count",
    "active",
    "created_at",
  ],
  events: [
    "id",
    "slug",
    "title",
    "description",
    "kind",
    "status",
    "merchant_id",
    "district_id",
    "parcel_id",
    "offer_id",
    "product_id",
    "product_ids",
    "reward_id",
    "starts_at",
    "ends_at",
    "capacity",
    "hero_image_url",
    "hero_video_url",
    "livestream_url",
    "config",
    "created_at",
    "updated_at",
  ],
};

function expectRowShape(table: string, row: Row) {
  const allowed = new Set(COLUMNS[table]);
  for (const [key, value] of Object.entries(row)) {
    expect(allowed.has(key), `${table}.${key} is not a column in the migration`).toBe(true);
    expect(
      value,
      `${table}.${key} must be null, not undefined (PostgREST drops undefined keys)`,
    ).not.toBeUndefined();
  }
  expect(row.id, `${table} row needs an id for onConflict`).toBeTypeOf("string");
}

describe("seed mappers round-trip through the Supabase row mappers", () => {
  it("districts", () => {
    for (const d of districts) {
      const row = toDistrictRow(d);
      expectRowShape("districts", row);
      expect(rowToDistrict(row)).toEqual(d);
    }
  });

  it("parcels", () => {
    for (const p of parcels) {
      const row = toParcelRow(p);
      expectRowShape("parcels", row);
      expect(rowToParcel(row)).toEqual(p);
    }
  });

  it("merchants (all columns incl. brand, storefront_config, fulfillment, hours, address, geo)", () => {
    for (const m of merchants) {
      const row = toMerchantRow(m);
      expectRowShape("merchants", row);
      expect(rowToMerchant(row)).toEqual(m);
    }
  });

  it("ai_employees", () => {
    for (const e of employees) {
      const row = toEmployeeRow(e);
      expectRowShape("ai_employees", row);
      expect(rowToEmployee(row)).toEqual(e);
    }
  });

  it("digital_rewards", () => {
    for (const r of rewards) {
      const row = toRewardRow(r);
      expectRowShape("digital_rewards", row);
      expect(rowToReward(row)).toEqual(r);
    }
  });

  it("products (including event_id and digital_reward_id)", () => {
    for (const p of products) {
      const row = toProductRow(p);
      expectRowShape("products", row);
      expect(rowToProduct(row)).toEqual(p);
    }
    expect(products.some((p) => p.eventId)).toBe(true);
    expect(products.some((p) => p.digitalRewardId)).toBe(true);
  });

  it("offers", () => {
    for (const o of offers) {
      const row = toOfferRow(o);
      expectRowShape("offers", row);
      expect(rowToOffer(row)).toEqual(o);
    }
  });

  it("events", () => {
    for (const e of events) {
      const row = toEventRow(e);
      expectRowShape("events", row);
      expect(rowToEvent(row)).toEqual(e);
    }
  });
});

describe("seed write order", () => {
  it("products reference only events that will exist after the second pass", () => {
    const eventIds = new Set(events.map((e) => e.id));
    for (const p of products) if (p.eventId) expect(eventIds.has(p.eventId), p.slug).toBe(true);
  });

  it("the first product pass carries no event_id (events are written later)", () => {
    const firstPass = products.map((p) => ({ ...toProductRow(p), event_id: null }));
    for (const row of firstPass) expect(row.event_id).toBeNull();
  });

  it("employees are unique per merchant (upsert onConflict merchant_id)", () => {
    expect(new Set(employees.map((e) => e.merchantId)).size).toBe(employees.length);
  });
});
