import type {
  AiEmployee,
  CityEvent,
  DigitalReward,
  District,
  Merchant,
  Offer,
  Parcel,
  Product,
} from "@/types/domain";

/**
 * Pure camelCase → snake_case row mappers for the seed script. They are the inverse of the
 * `rowTo*` mappers in `src/lib/data/supabase.ts` (see scripts/seed.test.ts for the round trip).
 * Every column is present explicitly (null rather than undefined) so re-seeding resets stale
 * values instead of leaving them behind.
 */
export type Row = Record<string, unknown>;

const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

export function toDistrictRow(d: District): Row {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    description: d.description,
    theme: d.theme,
    bounds: d.bounds,
    spawn_point: orNull(d.spawnPoint),
    sort_order: d.sortOrder,
  };
}

export function toParcelRow(p: Parcel): Row {
  return {
    id: p.id,
    district_id: p.districtId,
    slug: p.slug,
    position: p.position,
    rotation_y: p.rotationY,
    size: p.size,
    tier: p.tier,
    status: p.status,
    merchant_id: orNull(p.merchantId),
    occupied_from: orNull(p.occupiedFrom),
    occupied_until: orNull(p.occupiedUntil),
    sponsored: p.sponsored,
  };
}

export function toMerchantRow(m: Merchant): Row {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    tagline: orNull(m.tagline),
    description: m.description,
    category: m.category,
    merchant_type: m.merchantType,
    status: m.status,
    tags: m.tags,
    price_level: orNull(m.priceLevel),
    logo_url: orNull(m.logoUrl),
    hero_image_url: orNull(m.heroImageUrl),
    images: m.images,
    brand: m.brand,
    website_url: orNull(m.websiteUrl),
    address: orNull(m.address),
    geo: orNull(m.geo),
    opening_hours: orNull(m.openingHours),
    storefront_template: m.storefrontTemplate,
    interior_template: m.interiorTemplate,
    storefront_config: m.storefrontConfig,
    fulfillment: m.fulfillment,
    sponsored: m.sponsored,
    rating: orNull(m.rating),
    rating_count: m.ratingCount,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

export function toEmployeeRow(e: AiEmployee): Row {
  return {
    id: e.id,
    merchant_id: e.merchantId,
    name: e.name,
    role: e.role,
    avatar_url: orNull(e.avatarUrl),
    personality: e.personality,
    tone: e.tone,
    greeting: e.greeting,
    knowledge: e.knowledge,
    upsell_rules: e.upsellRules,
    prohibited_claims: e.prohibitedClaims,
    brand_language: e.brandLanguage,
    escalation: e.escalation,
    allowed_context: e.allowedContext,
  };
}

export function toRewardRow(r: DigitalReward): Row {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    kind: r.kind,
    asset_url: orNull(r.assetUrl),
    preview_image_url: orNull(r.previewImageUrl),
    rarity: r.rarity,
  };
}

/** Full product row including `event_id`; the seed script nulls it on the first pass. */
export function toProductRow(p: Product): Row {
  return {
    id: p.id,
    merchant_id: p.merchantId,
    slug: p.slug,
    title: p.title,
    description: p.description,
    category: p.category,
    price_cents: p.priceCents,
    currency: p.currency,
    compare_at_price_cents: orNull(p.compareAtPriceCents),
    image_url: orNull(p.imageUrl),
    images: p.images,
    model_3d_url: orNull(p.model3dUrl),
    inventory_status: p.inventoryStatus,
    inventory_count: orNull(p.inventoryCount),
    variant_groups: p.variantGroups,
    attributes: p.attributes,
    tags: p.tags,
    fulfillment_types: p.fulfillmentTypes,
    lead_time: p.leadTime,
    digital_reward_id: orNull(p.digitalRewardId),
    event_id: orNull(p.eventId),
    featured: p.featured,
    sort_order: p.sortOrder,
    active: p.active,
  };
}

export function toOfferRow(o: Offer): Row {
  return {
    id: o.id,
    slug: o.slug,
    merchant_id: o.merchantId,
    product_id: orNull(o.productId),
    scope: o.scope,
    title: o.title,
    description: o.description,
    kind: o.kind,
    value: o.value,
    code: orNull(o.code),
    starts_at: o.startsAt,
    ends_at: o.endsAt,
    max_redemptions: orNull(o.maxRedemptions),
    redemptions_count: o.redemptionsCount,
    active: o.active,
  };
}

export function toEventRow(e: CityEvent): Row {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description,
    kind: e.kind,
    status: e.status,
    merchant_id: orNull(e.merchantId),
    district_id: orNull(e.districtId),
    parcel_id: orNull(e.parcelId),
    offer_id: orNull(e.offerId),
    product_id: orNull(e.productId),
    reward_id: orNull(e.rewardId),
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    hero_image_url: orNull(e.heroImageUrl),
    config: e.config,
  };
}
