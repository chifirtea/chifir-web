/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiEmployee,
  AiEmployeePublic,
  CityEvent,
  DigitalReward,
  District,
  Merchant,
  Offer,
  Order,
  OrderFulfillment,
  OrderItem,
  Parcel,
  Product,
  Profile,
  UserReward,
} from "@/types/domain";
import type { AnalyticsRecord } from "@/lib/analytics/events";
import { getAdminSupabase } from "@/lib/supabase/admin";
import type {
  AiMessageRecord,
  CitySnapshot,
  CreateOrderInput,
  DataSource,
  EventListParams,
  MerchantSearchParams,
  OrderPatch,
  ProductSearchParams,
} from "./types";
import { filterMerchants, filterProducts } from "./search";

type Row = Record<string, any>;

const CATALOG_TTL_MS = 60_000;

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`[supabase] ${context}: ${error?.message ?? "unknown error"}`);
}

// ------------------------------------------------------------------ row mappers

export function rowToDistrict(r: Row): District {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    theme: r.theme ?? { accent: "#ffc46b", ambience: "warm" },
    bounds: r.bounds,
    ...(r.spawn_point ? { spawnPoint: r.spawn_point } : {}),
    sortOrder: r.sort_order ?? 0,
  };
}

export function rowToParcel(r: Row): Parcel {
  return {
    id: r.id,
    districtId: r.district_id,
    slug: r.slug,
    position: r.position,
    rotationY: Number(r.rotation_y ?? 0),
    size: r.size,
    tier: r.tier,
    status: r.status,
    ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
    ...(r.occupied_from ? { occupiedFrom: r.occupied_from } : {}),
    ...(r.occupied_until ? { occupiedUntil: r.occupied_until } : {}),
    sponsored: Boolean(r.sponsored),
  };
}

export function rowToMerchant(r: Row): Merchant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    ...(r.tagline ? { tagline: r.tagline } : {}),
    description: r.description ?? "",
    category: r.category,
    merchantType: r.merchant_type,
    status: r.status,
    tags: r.tags ?? [],
    ...(r.price_level ? { priceLevel: r.price_level } : {}),
    ...(r.logo_url ? { logoUrl: r.logo_url } : {}),
    ...(r.hero_image_url ? { heroImageUrl: r.hero_image_url } : {}),
    images: r.images ?? [],
    brand: r.brand,
    ...(r.website_url ? { websiteUrl: r.website_url } : {}),
    ...(r.address ? { address: r.address } : {}),
    ...(r.geo ? { geo: r.geo } : {}),
    ...(r.opening_hours ? { openingHours: r.opening_hours } : {}),
    storefrontTemplate: r.storefront_template,
    interiorTemplate: r.interior_template,
    storefrontConfig: r.storefront_config,
    fulfillment: r.fulfillment,
    sponsored: Boolean(r.sponsored),
    ...(r.rating !== null && r.rating !== undefined ? { rating: Number(r.rating) } : {}),
    ratingCount: r.rating_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToPublicEmployee(r: Row): AiEmployeePublic {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    name: r.name,
    role: r.role,
    ...(r.avatar_url ? { avatarUrl: r.avatar_url } : {}),
    greeting: r.greeting ?? "",
  };
}

export function rowToEmployee(r: Row): AiEmployee {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    name: r.name,
    role: r.role,
    ...(r.avatar_url ? { avatarUrl: r.avatar_url } : {}),
    personality: r.personality ?? "",
    tone: r.tone ?? "",
    greeting: r.greeting ?? "",
    knowledge: r.knowledge ?? [],
    upsellRules: r.upsell_rules ?? [],
    prohibitedClaims: r.prohibited_claims ?? [],
    brandLanguage: r.brand_language ?? [],
    escalation: r.escalation ?? { enabled: false },
    allowedContext: r.allowed_context ?? [],
  };
}

export function rowToProduct(r: Row): Product {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? "",
    category: r.category,
    priceCents: r.price_cents,
    currency: r.currency,
    ...(r.compare_at_price_cents !== null && r.compare_at_price_cents !== undefined
      ? { compareAtPriceCents: r.compare_at_price_cents }
      : {}),
    ...(r.image_url ? { imageUrl: r.image_url } : {}),
    images: r.images ?? [],
    ...(r.model_3d_url ? { model3dUrl: r.model_3d_url } : {}),
    inventoryStatus: r.inventory_status,
    ...(r.inventory_count !== null && r.inventory_count !== undefined ? { inventoryCount: r.inventory_count } : {}),
    variantGroups: r.variant_groups ?? [],
    attributes: r.attributes ?? {},
    tags: r.tags ?? [],
    fulfillmentTypes: r.fulfillment_types ?? [],
    leadTime: r.lead_time ?? {},
    ...(r.digital_reward_id ? { digitalRewardId: r.digital_reward_id } : {}),
    ...(r.event_id ? { eventId: r.event_id } : {}),
    featured: Boolean(r.featured),
    sortOrder: r.sort_order ?? 0,
    active: Boolean(r.active),
  };
}

export function rowToReward(r: Row): DigitalReward {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    ...(r.asset_url ? { assetUrl: r.asset_url } : {}),
    ...(r.preview_image_url ? { previewImageUrl: r.preview_image_url } : {}),
    rarity: r.rarity,
  };
}

export function rowToOffer(r: Row): Offer {
  return {
    id: r.id,
    slug: r.slug,
    merchantId: r.merchant_id,
    ...(r.product_id ? { productId: r.product_id } : {}),
    scope: r.scope ?? {},
    title: r.title,
    description: r.description ?? "",
    kind: r.kind,
    value: r.value ?? 0,
    ...(r.code ? { code: r.code } : {}),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    ...(r.max_redemptions ? { maxRedemptions: r.max_redemptions } : {}),
    redemptionsCount: r.redemptions_count ?? 0,
    active: Boolean(r.active),
  };
}

export function rowToEvent(r: Row): CityEvent {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? "",
    kind: r.kind,
    status: r.status,
    ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
    ...(r.district_id ? { districtId: r.district_id } : {}),
    ...(r.parcel_id ? { parcelId: r.parcel_id } : {}),
    ...(r.offer_id ? { offerId: r.offer_id } : {}),
    ...(r.product_id ? { productId: r.product_id } : {}),
    ...(r.reward_id ? { rewardId: r.reward_id } : {}),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    ...(r.hero_image_url ? { heroImageUrl: r.hero_image_url } : {}),
    config: r.config ?? {},
  };
}

export function rowToOrderItem(r: Row): OrderItem {
  return {
    id: r.id,
    orderId: r.order_id,
    ...(r.product_id ? { productId: r.product_id } : {}),
    ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
    merchantNameSnapshot: r.merchant_name_snapshot ?? "",
    titleSnapshot: r.title_snapshot,
    ...(r.image_url_snapshot ? { imageUrlSnapshot: r.image_url_snapshot } : {}),
    unitPriceCents: r.unit_price_cents,
    discountCents: r.discount_cents ?? 0,
    ...(r.offer_id ? { offerId: r.offer_id } : {}),
    quantity: r.quantity,
    variantSelection: r.variant_selection ?? {},
    ...(r.variant_label ? { variantLabel: r.variant_label } : {}),
    ...(r.digital_reward_id ? { digitalRewardId: r.digital_reward_id } : {}),
  };
}

export function rowToFulfillment(r: Row): OrderFulfillment {
  return {
    id: r.id,
    orderId: r.order_id,
    ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
    merchantNameSnapshot: r.merchant_name_snapshot ?? "",
    provider: r.provider,
    type: r.type,
    status: r.status,
    subtotalCents: r.subtotal_cents ?? 0,
    feeCents: r.fee_cents ?? 0,
    ...(r.recipient ? { recipient: r.recipient } : {}),
    ...(r.delivery_address ? { deliveryAddress: r.delivery_address } : {}),
    ...(r.external_id ? { externalId: r.external_id } : {}),
    ...(r.eta_at ? { etaAt: r.eta_at } : {}),
    ...(r.tracking_url ? { trackingUrl: r.tracking_url } : {}),
    events: r.events ?? [],
  };
}

export function rowToOrder(r: Row, items: Row[], fulfillments: Row[]): Order {
  return {
    id: r.id,
    ...(r.user_id ? { userId: r.user_id } : {}),
    status: r.status,
    currency: r.currency,
    subtotalCents: r.subtotal_cents,
    discountCents: r.discount_cents ?? 0,
    deliveryFeeCents: r.delivery_fee_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    ...(r.delivery_address ? { deliveryAddress: r.delivery_address } : {}),
    contact: r.contact,
    ...(r.promo_code ? { promoCode: r.promo_code } : {}),
    ...(r.access_token_hash ? { accessTokenHash: r.access_token_hash } : {}),
    ...(r.session_id ? { sessionId: r.session_id } : {}),
    ...(r.anonymous_id ? { anonymousId: r.anonymous_id } : {}),
    paymentProvider: r.payment_provider,
    ...(r.stripe_checkout_session_id ? { stripeCheckoutSessionId: r.stripe_checkout_session_id } : {}),
    ...(r.stripe_payment_intent_id ? { stripePaymentIntentId: r.stripe_payment_intent_id } : {}),
    items: items.map(rowToOrderItem),
    fulfillments: fulfillments.map(rowToFulfillment),
    placedAt: r.placed_at,
    ...(r.paid_at ? { paidAt: r.paid_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToProfile(r: Row): Profile {
  return {
    id: r.id,
    displayName: r.display_name,
    avatar: r.avatar,
    cityLevel: r.city_level,
    xp: r.xp,
    dietaryPreferences: r.dietary_preferences ?? [],
    ...(r.default_address ? { defaultAddress: r.default_address } : {}),
    createdAt: r.created_at,
  };
}

// ------------------------------------------------------------------ implementation
export class SupabaseDataSource implements DataSource {
  readonly kind = "supabase" as const;
  private catalog: { at: number; snapshot: CitySnapshot } | null = null;

  private get db(): SupabaseClient {
    return getAdminSupabase();
  }

  private async loadCatalog(): Promise<CitySnapshot> {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) return this.catalog.snapshot;
    const db = this.db;
    const [districts, parcels, merchants, employees, products, events, offers, rewards] = await Promise.all([
      db.from("districts").select("*").order("sort_order"),
      db.from("parcels").select("*"),
      db.from("merchants").select("*").eq("status", "published"),
      db.from("ai_employees").select("*"),
      db.from("products").select("*").eq("active", true).order("sort_order"),
      db.from("events").select("*").neq("status", "cancelled").order("starts_at"),
      db.from("offers").select("*").eq("active", true),
      db.from("digital_rewards").select("*"),
    ]);
    for (const [name, res] of Object.entries({ districts, parcels, merchants, employees, products, events, offers, rewards })) {
      if (res.error) fail(`load ${name}`, res.error);
    }
    const publishedIds = new Set((merchants.data ?? []).map((m: Row) => m.id));
    const snapshot: CitySnapshot = {
      districts: (districts.data ?? []).map(rowToDistrict),
      parcels: (parcels.data ?? []).map(rowToParcel),
      merchants: (merchants.data ?? []).map(rowToMerchant),
      products: (products.data ?? []).filter((p: Row) => publishedIds.has(p.merchant_id)).map(rowToProduct),
      employees: (employees.data ?? []).filter((e: Row) => publishedIds.has(e.merchant_id)).map(rowToPublicEmployee),
      events: (events.data ?? []).map(rowToEvent),
      offers: (offers.data ?? []).map(rowToOffer),
      rewards: (rewards.data ?? []).map(rowToReward),
      generatedAt: new Date().toISOString(),
    };
    this.catalog = { at: Date.now(), snapshot };
    return snapshot;
  }

  invalidateCatalog(): void {
    this.catalog = null;
  }

  async getCitySnapshot(): Promise<CitySnapshot> {
    return this.loadCatalog();
  }
  async listDistricts(): Promise<District[]> {
    return (await this.loadCatalog()).districts;
  }
  async listParcels(districtId?: string): Promise<Parcel[]> {
    return (await this.loadCatalog()).parcels.filter((p) => !districtId || p.districtId === districtId);
  }
  async listMerchants(): Promise<Merchant[]> {
    return (await this.loadCatalog()).merchants;
  }
  async getMerchant(id: string): Promise<Merchant | null> {
    return (await this.loadCatalog()).merchants.find((m) => m.id === id) ?? null;
  }
  async getMerchantBySlug(slug: string): Promise<Merchant | null> {
    return (await this.loadCatalog()).merchants.find((m) => m.slug === slug) ?? null;
  }
  async searchMerchants(params: MerchantSearchParams): Promise<Merchant[]> {
    const s = await this.loadCatalog();
    return filterMerchants(s.merchants, s.parcels, params);
  }
  async listProducts(merchantId: string): Promise<Product[]> {
    return (await this.loadCatalog()).products.filter((p) => p.merchantId === merchantId);
  }
  async getProduct(id: string): Promise<Product | null> {
    return (await this.loadCatalog()).products.find((p) => p.id === id) ?? null;
  }
  async getProducts(ids: string[]): Promise<Product[]> {
    const set = new Set(ids);
    return (await this.loadCatalog()).products.filter((p) => set.has(p.id));
  }
  async searchProducts(params: ProductSearchParams): Promise<Product[]> {
    const { data, error } = await this.db.rpc("search_products", {
      p_query: params.query ?? null,
      p_max_price_cents: params.maxPriceCents ?? null,
      p_min_price_cents: params.minPriceCents ?? null,
      p_merchant_ids: params.merchantIds ?? null,
      p_merchant_type: params.merchantType ?? null,
      p_dietary: params.dietary ?? null,
      p_min_spice: params.minSpiceLevel ?? null,
      p_fulfillment_type: params.fulfillmentType ?? null,
      p_tags: params.tags ?? null,
      p_category: params.category ?? null,
      p_occasion: params.occasion ?? null,
      p_in_stock_only: params.inStockOnly ?? true,
      p_limit: Math.min(params.limit ?? 20, 50),
    });
    if (error) fail("search_products", error);
    const merchants = (await this.loadCatalog()).merchants;
    // Re-apply the same semantics for the params the RPC does not cover (occasion, category)
    // and to get identical ranking to static mode.
    return filterProducts((data ?? []).map(rowToProduct), merchants, params);
  }
  /** Full employee config: server-only, read fresh (never cached in the public snapshot). */
  async getEmployee(merchantId: string): Promise<AiEmployee | null> {
    const { data, error } = await this.db.from("ai_employees").select("*").eq("merchant_id", merchantId).maybeSingle();
    if (error) fail("getEmployee", error);
    return data ? rowToEmployee(data) : null;
  }
  async listEvents(params: EventListParams = {}): Promise<CityEvent[]> {
    const from = params.from ? Date.parse(params.from) : null;
    const to = params.to ? Date.parse(params.to) : null;
    return (await this.loadCatalog()).events
      .filter((e) => !params.status || params.status.includes(e.status))
      .filter((e) => from === null || Date.parse(e.endsAt) >= from)
      .filter((e) => to === null || Date.parse(e.startsAt) <= to)
      .slice(0, params.limit ?? 50);
  }
  async getEvent(id: string): Promise<CityEvent | null> {
    return (await this.loadCatalog()).events.find((e) => e.id === id) ?? null;
  }
  async listOffers(merchantId?: string): Promise<Offer[]> {
    const now = Date.now();
    return (await this.loadCatalog()).offers.filter(
      (o) => (!merchantId || o.merchantId === merchantId) && Date.parse(o.startsAt) <= now && Date.parse(o.endsAt) >= now,
    );
  }
  async getRewards(ids: string[]): Promise<DigitalReward[]> {
    const set = new Set(ids);
    return (await this.loadCatalog()).rewards.filter((r) => set.has(r.id));
  }

  // ------------------------------------------------------------------ commerce
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const db = this.db;
    const { data: order, error } = await db
      .from("orders")
      .insert({
        user_id: input.userId ?? null,
        status: input.status,
        currency: input.currency,
        subtotal_cents: input.subtotalCents,
        discount_cents: input.discountCents,
        delivery_fee_cents: input.deliveryFeeCents,
        tax_cents: input.taxCents,
        total_cents: input.totalCents,
        delivery_address: input.deliveryAddress ?? null,
        contact: input.contact,
        promo_code: input.promoCode ?? null,
        access_token_hash: input.accessTokenHash ?? null,
        session_id: input.sessionId ?? null,
        anonymous_id: input.anonymousId ?? null,
        payment_provider: input.paymentProvider,
        stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
        stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
        paid_at: input.paidAt ?? null,
      })
      .select("*")
      .single();
    if (error || !order) fail("createOrder", error);
    const { error: itemsError } = await db.from("order_items").insert(
      input.items.map((i) => ({
        order_id: order.id,
        product_id: i.productId ?? null,
        merchant_id: i.merchantId ?? null,
        merchant_name_snapshot: i.merchantNameSnapshot,
        title_snapshot: i.titleSnapshot,
        image_url_snapshot: i.imageUrlSnapshot ?? null,
        unit_price_cents: i.unitPriceCents,
        discount_cents: i.discountCents,
        offer_id: i.offerId ?? null,
        quantity: i.quantity,
        variant_selection: i.variantSelection,
        variant_label: i.variantLabel ?? null,
        digital_reward_id: i.digitalRewardId ?? null,
      })),
    );
    if (itemsError) fail("createOrder items", itemsError);
    const created = await this.getOrder(order.id);
    if (!created) throw new Error("[supabase] createOrder: order vanished after insert");
    return created;
  }
  async getOrder(id: string): Promise<Order | null> {
    const db = this.db;
    const { data: order, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
    if (error) fail("getOrder", error);
    if (!order) return null;
    return this.hydrateOrder(order);
  }
  private async hydrateOrder(order: Row): Promise<Order> {
    const db = this.db;
    const [items, fulfillments] = await Promise.all([
      db.from("order_items").select("*").eq("order_id", order.id),
      db.from("order_fulfillments").select("*").eq("order_id", order.id).order("created_at"),
    ]);
    if (items.error) fail("order_items", items.error);
    if (fulfillments.error) fail("order_fulfillments", fulfillments.error);
    return rowToOrder(order, items.data ?? [], fulfillments.data ?? []);
  }
  async getOrderByCheckoutSession(sessionId: string): Promise<Order | null> {
    const { data, error } = await this.db
      .from("orders")
      .select("*")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (error) fail("getOrderByCheckoutSession", error);
    return data ? this.hydrateOrder(data) : null;
  }
  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const update: Row = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.stripeCheckoutSessionId !== undefined) update.stripe_checkout_session_id = patch.stripeCheckoutSessionId;
    if (patch.stripePaymentIntentId !== undefined) update.stripe_payment_intent_id = patch.stripePaymentIntentId;
    if (patch.paidAt !== undefined) update.paid_at = patch.paidAt;
    if (patch.userId !== undefined) update.user_id = patch.userId;
    if (patch.deliveryAddress !== undefined) update.delivery_address = patch.deliveryAddress;
    if (patch.contact !== undefined) update.contact = patch.contact;
    const { error } = await this.db.from("orders").update(update).eq("id", id);
    if (error) fail("updateOrder", error);
    const order = await this.getOrder(id);
    if (!order) throw new Error(`[supabase] updateOrder: order ${id} not found`);
    return order;
  }
  async markOrderPaid(id: string, patch: { stripePaymentIntentId?: string; paidAt: string }): Promise<Order | null> {
    const { data, error } = await this.db.rpc("mark_order_paid", {
      p_order_id: id,
      p_payment_intent_id: patch.stripePaymentIntentId ?? null,
      p_paid_at: patch.paidAt,
    });
    if (error) fail("mark_order_paid", error);
    const row = Array.isArray(data) ? data[0] : data;
    return row ? this.hydrateOrder(row) : null;
  }
  async claimOrder(id: string, accessTokenHash: string, userId: string): Promise<boolean> {
    // Service role: enforce the same predicate the RPC uses for clients.
    const { data, error } = await this.db
      .from("orders")
      .update({ user_id: userId })
      .eq("id", id)
      .is("user_id", null)
      .eq("access_token_hash", accessTokenHash)
      .select("id");
    if (error) fail("claimOrder", error);
    return (data ?? []).length > 0;
  }
  async listOrdersForUser(userId: string): Promise<Order[]> {
    const { data, error } = await this.db
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) fail("listOrdersForUser", error);
    return Promise.all((data ?? []).map((o: Row) => this.hydrateOrder(o)));
  }
  async upsertFulfillment(f: Omit<OrderFulfillment, "id"> & { id?: string }): Promise<OrderFulfillment> {
    const row: Row = {
      ...(f.id ? { id: f.id } : {}),
      order_id: f.orderId,
      merchant_id: f.merchantId ?? null,
      merchant_name_snapshot: f.merchantNameSnapshot,
      provider: f.provider,
      type: f.type,
      status: f.status,
      subtotal_cents: f.subtotalCents,
      fee_cents: f.feeCents,
      recipient: f.recipient ?? null,
      delivery_address: f.deliveryAddress ?? null,
      external_id: f.externalId ?? null,
      eta_at: f.etaAt ?? null,
      tracking_url: f.trackingUrl ?? null,
      events: f.events,
    };
    const { data, error } = await this.db
      .from("order_fulfillments")
      .upsert(row, { onConflict: "order_id,merchant_id" })
      .select("*")
      .single();
    if (error || !data) fail("upsertFulfillment", error);
    return rowToFulfillment(data);
  }
  async grantReward(userId: string, rewardId: string, sourceOrderId?: string): Promise<UserReward> {
    const { data, error } = await this.db
      .from("user_rewards")
      .upsert(
        { user_id: userId, reward_id: rewardId, source_order_id: sourceOrderId ?? null },
        { onConflict: "user_id,reward_id", ignoreDuplicates: true },
      )
      .select("*")
      .maybeSingle();
    if (error) fail("grantReward", error);
    if (data) {
      return { userId: data.user_id, rewardId: data.reward_id, grantedAt: data.granted_at, ...(data.source_order_id ? { sourceOrderId: data.source_order_id } : {}) };
    }
    const existing = await this.db.from("user_rewards").select("*").eq("user_id", userId).eq("reward_id", rewardId).single();
    if (existing.error || !existing.data) fail("grantReward read", existing.error);
    const r = existing.data;
    return { userId: r.user_id, rewardId: r.reward_id, grantedAt: r.granted_at, ...(r.source_order_id ? { sourceOrderId: r.source_order_id } : {}) };
  }
  async listUserRewards(userId: string): Promise<UserReward[]> {
    const { data, error } = await this.db.from("user_rewards").select("*").eq("user_id", userId);
    if (error) fail("listUserRewards", error);
    return (data ?? []).map((r: Row) => ({
      userId: r.user_id,
      rewardId: r.reward_id,
      grantedAt: r.granted_at,
      ...(r.source_order_id ? { sourceOrderId: r.source_order_id } : {}),
    }));
  }
  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.db.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) fail("getProfile", error);
    return data ? rowToProfile(data) : null;
  }
  async updateProfile(userId: string, patch: Partial<Omit<Profile, "id" | "createdAt">>): Promise<Profile> {
    const update: Row = {};
    if (patch.displayName !== undefined) update.display_name = patch.displayName;
    if (patch.avatar !== undefined) update.avatar = patch.avatar;
    if (patch.dietaryPreferences !== undefined) update.dietary_preferences = patch.dietaryPreferences;
    if (patch.defaultAddress !== undefined) update.default_address = patch.defaultAddress;
    if (patch.xp !== undefined) update.xp = patch.xp;
    if (patch.cityLevel !== undefined) update.city_level = patch.cityLevel;
    const { data, error } = await this.db.from("profiles").update(update).eq("id", userId).select("*").single();
    if (error || !data) fail("updateProfile", error);
    return rowToProfile(data);
  }
  async addXp(userId: string, amount: number, reason: string, sourceOrderId?: string): Promise<Profile> {
    const { data, error } = await this.db.rpc("add_xp", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_source_order_id: sourceOrderId ?? null,
    });
    if (error || !data) fail("add_xp", error);
    return rowToProfile(Array.isArray(data) ? data[0] : data);
  }
  async redeemOffer(offerId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc("redeem_offer", { p_offer_id: offerId });
    if (error) fail("redeem_offer", error);
    this.invalidateCatalog();
    return Boolean(data);
  }
  async recordAnalytics(records: AnalyticsRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await this.db.from("analytics_events").insert(
      records.map((r) => ({
        name: r.name,
        props: r.props,
        ts: new Date(r.ts).toISOString(),
        session_id: r.sessionId,
        anonymous_id: r.anonymousId,
        user_id: r.userId ?? null,
        device: r.device ?? null,
      })),
    );
    if (error) fail("recordAnalytics", error);
  }
  async appendAiMessages(input: {
    conversationId?: string;
    userId?: string;
    scope: "concierge" | "employee";
    merchantId?: string;
    messages: AiMessageRecord[];
  }): Promise<{ conversationId: string }> {
    const db = this.db;
    let conversationId = input.conversationId;
    if (!conversationId) {
      const { data, error } = await db
        .from("ai_conversations")
        .insert({ user_id: input.userId ?? null, scope: input.scope, merchant_id: input.merchantId ?? null })
        .select("id")
        .single();
      if (error || !data) fail("ai_conversations insert", error);
      conversationId = data.id as string;
    }
    if (input.messages.length) {
      const { error } = await db.from("ai_messages").insert(
        input.messages.map((m) => ({
          conversation_id: conversationId,
          role: m.role,
          content: m.content,
          tool_calls: m.toolCalls ?? null,
        })),
      );
      if (error) fail("ai_messages insert", error);
    }
    return { conversationId };
  }
}
