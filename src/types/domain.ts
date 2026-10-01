/**
 * Canonical domain types. These mirror the database rows in
 * `supabase/migrations` (camelCase here, snake_case there) and are the
 * contract between the data layer, the 3D engine, the UI and the AI tools.
 *
 * Keep this file free of runtime code and framework imports.
 */

export type Id = string;
export type IsoDateTime = string;
export type CurrencyCode = "USD" | "EUR" | "GBP";

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose2 extends Vec2 {
  /** Radians around +Y. 0 faces +Z. */
  yaw: number;
}

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface DistrictTheme {
  /** Accent color used for street lights, banners and the minimap. */
  accent: string;
  /** Short mood descriptor consumed by ambient systems (e.g. "warm", "cool"). */
  ambience: "warm" | "cool" | "neon" | "daylight";
  /** Optional street-level material key (pavement variety). */
  pavement?: "stone" | "asphalt" | "brick" | "plaza";
}

export interface District {
  id: Id;
  slug: string;
  name: string;
  description: string;
  theme: DistrictTheme;
  bounds: Bounds2;
  spawnPoint?: Pose2;
  sortOrder: number;
}

export type ParcelTier = "standard" | "corner" | "flagship" | "kiosk" | "venue" | "billboard";
export type ParcelStatus = "available" | "occupied" | "reserved";

export interface Parcel {
  id: Id;
  districtId: Id;
  slug: string;
  /** Centre of the footprint in world metres. */
  position: Vec2;
  /** Radians around +Y. 0 means the storefront faces +Z. */
  rotationY: number;
  size: { width: number; depth: number };
  tier: ParcelTier;
  status: ParcelStatus;
  merchantId?: Id;
  /** Time-boxed tenancy (pop-ups, billboard campaigns). Absent = open-ended. */
  occupiedFrom?: IsoDateTime;
  occupiedUntil?: IsoDateTime;
  /**
   * What is built on the lot when it differs from the tenant's default (a brand's flagship
   * building versus the pop-up structure it rents for one night). Absent = the merchant's own.
   */
  storefrontTemplate?: StorefrontTemplateId;
  interiorTemplate?: InteriorTemplateId;
  sponsored: boolean;
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

export type MerchantType = "restaurant" | "retail" | "service" | "venue" | "popup";
export type MerchantStatus = "draft" | "published" | "paused";

export type StorefrontTemplateId =
  "bistro" | "fast-casual" | "cafe" | "boutique" | "flagship" | "kiosk" | "popup";

export type InteriorTemplateId =
  "restaurant-counter" | "restaurant-dining" | "retail-racks" | "retail-gallery" | "popup-gallery";

export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  /** Text color that is legible on `primary`. */
  onPrimary: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface OpeningInterval {
  /** "HH:MM" 24h local time. */
  open: string;
  close: string;
}

export interface OpeningHours {
  timezone: string;
  weekly: Partial<Record<Weekday, OpeningInterval[]>>;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type FulfillmentProviderId = "simulated" | "merchant_self" | "doordash_drive" | "shippo";

export interface FulfillmentOptions {
  provider: FulfillmentProviderId;
  delivery?: {
    enabled: boolean;
    feeCents: number;
    minutesMin: number;
    minutesMax: number;
    radiusKm?: number;
  };
  pickup?: { enabled: boolean; minutesMin: number; minutesMax: number };
  shipping?: { enabled: boolean; feeCents: number; daysMin: number; daysMax: number };
  booking?: { enabled: boolean; slotMinutes: number };
}

export interface StorefrontConfig {
  /** Overrides `merchant.name` on the sign. */
  signText?: string;
  signStyle: "neon" | "backlit" | "painted" | "marquee";
  facade: "brick" | "plaster" | "glass" | "concrete" | "wood" | "tile";
  awning: boolean;
  floors: 1 | 2 | 3;
  windowDisplay: "products" | "menu" | "none";
  accentLights: boolean;
}

export interface Merchant {
  id: Id;
  slug: string;
  name: string;
  tagline?: string;
  description: string;
  /** Dot-namespaced category slug, e.g. "food.ramen", "fashion.streetwear". */
  category: string;
  merchantType: MerchantType;
  status: MerchantStatus;
  tags: string[];
  /** 1 = budget … 4 = premium. */
  priceLevel?: 1 | 2 | 3 | 4;
  logoUrl?: string;
  heroImageUrl?: string;
  images: string[];
  brand: BrandPalette;
  websiteUrl?: string;
  address?: Address;
  geo?: GeoPoint;
  openingHours?: OpeningHours;
  storefrontTemplate: StorefrontTemplateId;
  interiorTemplate: InteriorTemplateId;
  storefrontConfig: StorefrontConfig;
  fulfillment: FulfillmentOptions;
  sponsored: boolean;
  rating?: number;
  ratingCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type EmployeeContextKey = "cart" | "dietary" | "budget" | "location" | "occasion";

/** The only employee fields that ever reach the browser. The full config is server-only. */
export type AiEmployeePublic = Pick<
  AiEmployee,
  "id" | "merchantId" | "name" | "role" | "avatarUrl" | "greeting"
>;

export interface AiEmployee {
  id: Id;
  merchantId: Id;
  name: string;
  /** e.g. "host", "stylist", "florist". Shown in the UI. */
  role: string;
  avatarUrl?: string;
  personality: string;
  tone: string;
  greeting: string;
  /** Plain facts the employee may state (hours, sourcing, policies). */
  knowledge: string[];
  upsellRules: string[];
  prohibitedClaims: string[];
  brandLanguage: string[];
  escalation: { enabled: boolean; contact?: string };
  allowedContext: EmployeeContextKey[];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type FulfillmentType =
  "delivery" | "pickup" | "shipping" | "booking" | "ticket" | "digital" | "lead";

export type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock" | "preorder";

export type DietaryTag =
  "vegan" | "vegetarian" | "gluten_free" | "dairy_free" | "nut_free" | "halal" | "kosher";

export interface VariantOption {
  id: string;
  name: string;
  priceDeltaCents: number;
  inventoryStatus?: InventoryStatus;
}

export interface VariantGroup {
  id: string;
  name: string;
  required: boolean;
  options: VariantOption[];
}

export interface ProductAttributes {
  /** 0 = none … 4 = extreme. */
  spiceLevel?: 0 | 1 | 2 | 3 | 4;
  dietary?: DietaryTag[];
  allergens?: string[];
  calories?: number;
  sizes?: string[];
  colors?: string[];
  material?: string;
  /** e.g. "date-night", "gift", "birthday". */
  occasion?: string[];
  gender?: "men" | "women" | "unisex";
  /** Suitable number of people for a dish or bundle. */
  serves?: number;
}

export interface LeadTime {
  minutesMin?: number;
  minutesMax?: number;
  daysMin?: number;
  daysMax?: number;
}

export interface Product {
  id: Id;
  merchantId: Id;
  slug: string;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  currency: CurrencyCode;
  compareAtPriceCents?: number;
  imageUrl?: string;
  images: string[];
  model3dUrl?: string;
  inventoryStatus: InventoryStatus;
  inventoryCount?: number;
  variantGroups: VariantGroup[];
  attributes: ProductAttributes;
  tags: string[];
  fulfillmentTypes: FulfillmentType[];
  leadTime: LeadTime;
  digitalRewardId?: Id;
  /** The event this product belongs to: the one a ticket admits to, or the drop that launches it. */
  eventId?: Id;
  /**
   * Purchasability window. Outside it the product is visible (so people can look forward to it)
   * but cannot be added to a cart or priced. Absent = always purchasable while `active`.
   */
  availableFrom?: IsoDateTime;
  availableUntil?: IsoDateTime;
  featured: boolean;
  sortOrder: number;
  active: boolean;
}

/**
 * Every kind of digital entitlement a purchase (or an event) can grant. `apartment_item` is
 * furniture; `food_prop` is a dish that lives on a table; `access_pass` opens gated places.
 */
export type RewardKind =
  "avatar_item" | "apartment_item" | "food_prop" | "vehicle" | "badge" | "emote" | "access_pass";

export type AvatarSlot = "outfit" | "headwear" | "footwear" | "accessory";

/** Data-driven look of an avatar item; the engine renders from these colours, never from ids. */
export interface RewardAppearance {
  /** Silhouette family the engine knows how to draw, e.g. "hoodie", "cap", "sneaker". */
  style?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  /** Short text printed on the item (chest print, cap front), rendered as a texture. */
  print?: string;
}

export interface DigitalReward {
  id: Id;
  slug: string;
  name: string;
  description: string;
  kind: RewardKind;
  /** For avatar items: where it is worn. One item per slot is equipped at a time. */
  avatarSlot?: AvatarSlot;
  appearance?: RewardAppearance;
  assetUrl?: string;
  previewImageUrl?: string;
  rarity: "common" | "rare" | "epic" | "legendary";
}

export interface OfferScope {
  productIds?: Id[];
  categories?: string[];
  tags?: string[];
}

export interface Offer {
  id: Id;
  slug: string;
  merchantId: Id;
  /** Convenience for single-product offers; equivalent to scope.productIds = [productId]. */
  productId?: Id;
  /** Which of the merchant's products the offer applies to. Empty scope = all of them. */
  scope: OfferScope;
  title: string;
  description: string;
  kind: "percent_off" | "amount_off" | "free_item" | "bundle";
  /** Percent (0-100) for percent_off, cents for amount_off, ignored otherwise. */
  value: number;
  code?: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  maxRedemptions?: number;
  redemptionsCount: number;
  active: boolean;
}

export type CityEventKind = "launch" | "live" | "promo" | "concert" | "opening" | "flash_deal";
export type CityEventStatus = "scheduled" | "live" | "ended" | "cancelled";

export interface CityEvent {
  id: Id;
  slug: string;
  title: string;
  description: string;
  kind: CityEventKind;
  status: CityEventStatus;
  merchantId?: Id;
  districtId?: Id;
  parcelId?: Id;
  /** Hard references (nullable) instead of soft slugs in config. */
  offerId?: Id;
  /** Single hero product (a ticket, or the headline item of a drop). */
  productId?: Id;
  /** The collection a drop launches. Products carry `availableFrom` = `startsAt`. */
  productIds: Id[];
  /** Granted to everyone who buys from the collection while the event is live. */
  rewardId?: Id;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  /**
   * Informational room size for the physical or virtual venue. Displayed as context
   * ("300 spots"), never used to pressure ("only 3 left!").
   */
  capacity?: number;
  heroImageUrl?: string;
  /** Optional looping clip for the venue screens while the event is live. */
  heroVideoUrl?: string;
  /** HLS/WebRTC/embed URL for a livestream surface. Placeholder until a provider is wired. */
  livestreamUrl?: string;
  config: Record<string, unknown>;
}

/** Derived from the clock; only `cancelled` is ever stored. */
export type CityEventPhase = "scheduled" | "live" | "ended";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AvatarConfig {
  bodyColor: string;
  hairColor: string;
  outfitId?: string;
  accessories: string[];
}

export interface Profile {
  id: Id;
  displayName: string;
  avatar: AvatarConfig;
  cityLevel: number;
  xp: number;
  dietaryPreferences: DietaryTag[];
  defaultAddress?: Address;
  createdAt: IsoDateTime;
}

export interface UserReward {
  userId: Id;
  rewardId: Id;
  sourceOrderId?: Id;
  grantedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Cart (client-side; prices are never stored here)
// ---------------------------------------------------------------------------

export interface CartLine {
  /** Stable key: productId + sorted variant selection. */
  key: string;
  productId: Id;
  merchantId: Id;
  quantity: number;
  /** variantGroupId -> variantOptionId */
  variantSelection: Record<string, string>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "pending_payment"
  | "payment_failed"
  | "paid"
  | "in_fulfillment"
  | "completed"
  | "cancelled"
  | "refunded";

export type PaymentProvider = "stripe" | "demo";

export interface OrderContact {
  email: string;
  name?: string;
  phone?: string;
}

/** merchantId -> chosen fulfillment type for that merchant's lines. */
export type FulfillmentSelection = Record<Id, FulfillmentType>;

export interface OrderItem {
  id: Id;
  orderId: Id;
  /** Nullable: products/merchants may be deleted later; snapshots keep the record readable. */
  productId?: Id;
  merchantId?: Id;
  merchantNameSnapshot: string;
  titleSnapshot: string;
  imageUrlSnapshot?: string;
  unitPriceCents: number;
  /** Total discount on this line (all units), already reflected in the order total. */
  discountCents: number;
  offerId?: Id;
  quantity: number;
  variantSelection: Record<string, string>;
  variantLabel?: string;
  digitalRewardId?: Id;
  /** Snapshot of `product.eventId` so drop purchases can be attributed after the event ends. */
  eventId?: Id;
}

export type FulfillmentStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed";

export interface FulfillmentEvent {
  status: FulfillmentStatus;
  at: IsoDateTime;
  note?: string;
}

/**
 * One per merchant per order. Carries its own type, recipient and address so group orders
 * (different people, different doors) fit without a schema change.
 */
export interface OrderFulfillment {
  id: Id;
  orderId: Id;
  merchantId?: Id;
  merchantNameSnapshot: string;
  provider: FulfillmentProviderId;
  type: FulfillmentType;
  status: FulfillmentStatus;
  subtotalCents: number;
  feeCents: number;
  recipient?: OrderContact;
  deliveryAddress?: Address;
  externalId?: string;
  etaAt?: IsoDateTime;
  trackingUrl?: string;
  events: FulfillmentEvent[];
}

export interface Order {
  id: Id;
  userId?: Id;
  status: OrderStatus;
  currency: CurrencyCode;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  /** Default address for this order (the payer's). Per-merchant overrides live on fulfillments. */
  deliveryAddress?: Address;
  /** The payer. */
  contact: OrderContact;
  promoCode?: string;
  /** sha256 of the guest access token issued at checkout. Server-only; strip before responding. */
  accessTokenHash?: string;
  /** Analytics attribution captured at checkout so purchase_completed joins the funnel. */
  sessionId?: string;
  anonymousId?: string;
  paymentProvider: PaymentProvider;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  items: OrderItem[];
  fulfillments: OrderFulfillment[];
  placedAt: IsoDateTime;
  paidAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Merchant onboarding drafts (admin-only generator)
// ---------------------------------------------------------------------------

export type MerchantDraftStatus = "extracted" | "in_review" | "approved" | "published" | "rejected";

/** What the AI proposes from an extraction. Every field is editable by the reviewer. */
export interface MerchantProposal {
  merchant: Omit<Merchant, "id" | "status" | "rating" | "ratingCount" | "createdAt" | "updatedAt">;
  products: Array<Omit<Product, "id" | "merchantId">>;
  employee: Omit<AiEmployee, "id" | "merchantId">;
}

export interface MerchantDraft {
  id: Id;
  sourceUrl: string;
  status: MerchantDraftStatus;
  /** What the extractor found, verbatim (titles, prices, image URLs, colours). Kept for the reviewer. */
  extraction: Record<string, unknown>;
  proposal: MerchantProposal;
  /** Chosen at review time; publishing requires it. */
  placement?: { districtId: Id; parcelId: Id };
  reviewerNotes?: string;
  publishedMerchantId?: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Navigation (shared by AI actions, HUD and deep links)
// ---------------------------------------------------------------------------

export type NavTarget =
  | { kind: "merchant"; merchantId: Id }
  | { kind: "district"; districtId: Id }
  | { kind: "parcel"; parcelId: Id }
  | { kind: "event"; eventId: Id }
  | { kind: "point"; x: number; z: number };

/** Lightweight cards the AI returns for rendering; never carry more than the UI needs. */
export interface MerchantCard {
  id: Id;
  slug: string;
  name: string;
  tagline?: string;
  category: string;
  merchantType: MerchantType;
  priceLevel?: number;
  rating?: number;
  logoUrl?: string;
  brand: BrandPalette;
  openNow?: boolean;
  etaLabel?: string;
}

/**
 * What AI tools return to the model: everything needed to quote a correct price (variants) and a
 * correct channel (fulfillment). The UI renders the `ProductCard` subset.
 */
export interface ProductFact extends ProductCard {
  description: string;
  category: string;
  variantGroups: VariantGroup[];
  fulfillmentTypes: FulfillmentType[];
  leadTime: LeadTime;
  tags: string[];
  occasion?: string[];
  serves?: number;
  /** Present when the product is not purchasable right now (drop not started / window closed). */
  availableFrom?: IsoDateTime;
  availableUntil?: IsoDateTime;
  eventId?: Id;
}

export interface ProductCard {
  id: Id;
  merchantId: Id;
  merchantName: string;
  title: string;
  priceCents: number;
  currency: CurrencyCode;
  imageUrl?: string;
  inventoryStatus: InventoryStatus;
  /** Set when the card should read "Drops at 8 PM" instead of "Add". */
  availableFrom?: IsoDateTime;
  spiceLevel?: number;
  dietary?: DietaryTag[];
  etaLabel?: string;
}
