import type {
  AiEmployee,
  AiEmployeePublic,
  CityEvent,
  DietaryTag,
  DigitalReward,
  District,
  FulfillmentType,
  Id,
  Merchant,
  MerchantDraft,
  MerchantType,
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

/**
 * Everything the client needs to render the whole city in one payload.
 * Small enough for the MVP (tens of merchants). Paginate by district when it is not.
 */
export interface CitySnapshot {
  districts: District[];
  parcels: Parcel[];
  merchants: Merchant[];
  products: Product[];
  employees: AiEmployeePublic[];
  events: CityEvent[];
  offers: Offer[];
  rewards: DigitalReward[];
  generatedAt: string;
}

export interface ProductSearchParams {
  query?: string;
  maxPriceCents?: number;
  minPriceCents?: number;
  merchantIds?: Id[];
  merchantType?: MerchantType;
  category?: string;
  dietary?: DietaryTag[];
  minSpiceLevel?: number;
  occasion?: string;
  fulfillmentType?: FulfillmentType;
  tags?: string[];
  inStockOnly?: boolean;
  limit?: number;
}

export interface MerchantSearchParams {
  query?: string;
  merchantType?: MerchantType;
  category?: string;
  districtId?: Id;
  openNow?: boolean;
  /** Only merchants whose priceLevel is <= this value. */
  maxPriceLevel?: number;
  tags?: string[];
  limit?: number;
}

export interface EventListParams {
  from?: string;
  to?: string;
  status?: CityEvent["status"][];
  limit?: number;
}

export interface SnapshotOptions {
  /**
   * The clock to build time-relative seed data for (static mode only: the seed schedules its
   * demo events "tonight"). Production data is absolute and ignores this.
   */
  now?: Date;
}

export type MerchantDraftInput = Omit<MerchantDraft, "id" | "createdAt" | "updatedAt"> & {
  id?: Id;
};

export type CreateOrderInput = Omit<
  Order,
  "id" | "items" | "fulfillments" | "createdAt" | "updatedAt" | "placedAt"
> & {
  items: Array<Omit<OrderItem, "id" | "orderId">>;
};

export type OrderPatch = Partial<
  Pick<
    Order,
    | "status"
    | "stripeCheckoutSessionId"
    | "stripePaymentIntentId"
    | "paidAt"
    | "userId"
    | "deliveryAddress"
    | "contact"
  >
>;

export interface AiMessageRecord {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: unknown;
}

/** Public catalog reads. Safe to expose through server components and AI tools. */
export interface CatalogSource {
  getCitySnapshot(options?: SnapshotOptions): Promise<CitySnapshot>;
  listDistricts(): Promise<District[]>;
  listParcels(districtId?: Id): Promise<Parcel[]>;
  listMerchants(): Promise<Merchant[]>;
  getMerchant(id: Id): Promise<Merchant | null>;
  getMerchantBySlug(slug: string): Promise<Merchant | null>;
  searchMerchants(params: MerchantSearchParams): Promise<Merchant[]>;
  listProducts(merchantId: Id): Promise<Product[]>;
  getProduct(id: Id): Promise<Product | null>;
  getProducts(ids: Id[]): Promise<Product[]>;
  searchProducts(params: ProductSearchParams): Promise<Product[]>;
  getEmployee(merchantId: Id): Promise<AiEmployee | null>;
  listEvents(params?: EventListParams): Promise<CityEvent[]>;
  getEvent(id: Id): Promise<CityEvent | null>;
  listOffers(merchantId?: Id): Promise<Offer[]>;
  getRewards(ids: Id[]): Promise<DigitalReward[]>;
}

/** Server-only writes and per-user reads. */
export interface CommerceSource {
  createOrder(input: CreateOrderInput): Promise<Order>;
  getOrder(id: Id): Promise<Order | null>;
  getOrderByCheckoutSession(sessionId: string): Promise<Order | null>;
  updateOrder(id: Id, patch: OrderPatch): Promise<Order>;
  /**
   * Atomic pending_payment -> paid transition. Returns the order when this call performed the
   * transition, null when it was already paid/cancelled (webhook retries must then do nothing).
   */
  markOrderPaid(
    id: Id,
    patch: { stripePaymentIntentId?: string; paidAt: string },
  ): Promise<Order | null>;
  /** Attaches a guest order to a user when the access token hash matches. */
  claimOrder(id: Id, accessTokenHash: string, userId: Id): Promise<boolean>;
  listOrdersForUser(userId: Id): Promise<Order[]>;
  upsertFulfillment(
    fulfillment: Omit<OrderFulfillment, "id"> & { id?: Id },
  ): Promise<OrderFulfillment>;
  grantReward(userId: Id, rewardId: Id, sourceOrderId?: Id): Promise<UserReward>;
  listUserRewards(userId: Id): Promise<UserReward[]>;
  getProfile(userId: Id): Promise<Profile | null>;
  updateProfile(userId: Id, patch: Partial<Omit<Profile, "id" | "createdAt">>): Promise<Profile>;
  /** Idempotent per (userId, sourceOrderId, reason). */
  addXp(userId: Id, amount: number, reason: string, sourceOrderId?: Id): Promise<Profile>;
  /** Atomically counts a redemption; false when the offer is exhausted or inactive. */
  redeemOffer(offerId: Id): Promise<boolean>;
  recordAnalytics(records: AnalyticsRecord[]): Promise<void>;
  appendAiMessages(input: {
    conversationId?: Id;
    userId?: Id;
    scope: "concierge" | "employee";
    merchantId?: Id;
    messages: AiMessageRecord[];
  }): Promise<{ conversationId: Id }>;
}

/**
 * Admin-only onboarding writes (merchant generator). A draft never affects the city until
 * `publishMerchantDraft` runs, which requires `status: "approved"` and a placement: the human
 * review step is enforced at the data layer, not just in the UI.
 */
export interface AdminSource {
  saveMerchantDraft(input: MerchantDraftInput): Promise<MerchantDraft>;
  getMerchantDraft(id: Id): Promise<MerchantDraft | null>;
  listMerchantDrafts(): Promise<MerchantDraft[]>;
  /** Creates merchant + products + employee, occupies the parcel, marks the draft published. */
  publishMerchantDraft(id: Id): Promise<{ merchantId: Id }>;
}

export interface DataSource extends CatalogSource, CommerceSource, AdminSource {
  readonly kind: "static" | "supabase";
}
