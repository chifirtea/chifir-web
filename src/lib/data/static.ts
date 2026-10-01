import "server-only";
import type {
  AiEmployee,
  AiEmployeePublic,
  CityEvent,
  DigitalReward,
  District,
  Merchant,
  MerchantDraft,
  Offer,
  Order,
  OrderFulfillment,
  Parcel,
  Product,
  Profile,
  UserReward,
} from "@/types/domain";
import type { AnalyticsRecord } from "@/lib/analytics/events";
import { buildCitySnapshot } from "@/data/seed";
import { randomId } from "@/lib/utils/ids";
import type {
  AiMessageRecord,
  CitySnapshot,
  CreateOrderInput,
  DataSource,
  EventListParams,
  MerchantDraftInput,
  MerchantSearchParams,
  OrderPatch,
  ProductSearchParams,
  SnapshotOptions,
} from "./types";
import { draftPublishProblem, rowsFromDraft, type PublishedMerchantRows } from "./drafts";
import { filterMerchants, filterProducts, isOpenNow } from "./search";
import { eventPhase } from "@/lib/events/status";

/**
 * In-memory DataSource over the seed data. Full parity with the Supabase implementation for
 * catalog reads; orders/profiles/rewards live in process memory (dev, demos and CI only).
 */
export class StaticDataSource implements DataSource {
  readonly kind = "static" as const;
  private snapshot: CitySnapshot;
  private orders = new Map<string, Order>();
  private profiles = new Map<string, Profile>();
  private rewards = new Map<string, UserReward[]>();
  private conversations = new Map<
    string,
    { scope: "concierge" | "employee"; merchantId?: string; messages: AiMessageRecord[] }
  >();
  private analytics: AnalyticsRecord[] = [];
  private snapshotBuiltAt = 0;
  private snapshotClock = 0;
  private readonly fixedSnapshot: boolean;
  private drafts = new Map<string, MerchantDraft>();
  /** Merchants published from drafts in this process (static mode has no database to persist to). */
  private published: PublishedMerchantRows[] = [];

  constructor(snapshot?: CitySnapshot) {
    this.fixedSnapshot = Boolean(snapshot);
    this.snapshot = snapshot ?? buildCitySnapshot();
    this.snapshotBuiltAt = Date.now();
    this.snapshotClock = Date.now();
  }

  /**
   * Events/offers are time-relative; rebuild every few minutes so statuses stay fresh, and
   * whenever a caller's clock differs from the one the snapshot was built for (demo clock).
   */
  private fresh(now: number = Date.now()): CitySnapshot {
    const stale = Date.now() - this.snapshotBuiltAt > 5 * 60_000;
    const drift = Math.abs(now - this.snapshotClock) > 60_000;
    if (!this.fixedSnapshot && (stale || drift)) {
      this.snapshot = buildCitySnapshot(new Date(now));
      this.snapshotBuiltAt = Date.now();
      this.snapshotClock = now;
    }
    return this.published.length ? this.withPublished(this.snapshot) : this.snapshot;
  }

  private withPublished(base: CitySnapshot): CitySnapshot {
    const replaced = new Set(this.published.map((r) => r.parcel.id));
    return {
      ...base,
      parcels: [
        ...base.parcels.filter((p) => !replaced.has(p.id)),
        ...this.published.map((r) => r.parcel),
      ],
      merchants: [...base.merchants, ...this.published.map((r) => r.merchant)],
      products: [...base.products, ...this.published.flatMap((r) => r.products)],
      employees: [...base.employees, ...this.published.map((r) => r.employee)],
    };
  }

  async getCitySnapshot(options: SnapshotOptions = {}): Promise<CitySnapshot> {
    const s = structuredClone(this.fresh(options.now?.getTime()));
    return { ...s, employees: s.employees.map(toPublicEmployee) };
  }
  async listDistricts(): Promise<District[]> {
    return [...this.fresh().districts].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async listParcels(districtId?: string): Promise<Parcel[]> {
    return this.fresh().parcels.filter((p) => !districtId || p.districtId === districtId);
  }
  async listMerchants(): Promise<Merchant[]> {
    return this.fresh().merchants.filter((m) => m.status === "published");
  }
  async getMerchant(id: string): Promise<Merchant | null> {
    return this.fresh().merchants.find((m) => m.id === id && m.status === "published") ?? null;
  }
  async getMerchantBySlug(slug: string): Promise<Merchant | null> {
    return this.fresh().merchants.find((m) => m.slug === slug && m.status === "published") ?? null;
  }
  async searchMerchants(params: MerchantSearchParams): Promise<Merchant[]> {
    const s = this.fresh();
    return filterMerchants(
      s.merchants.filter((m) => m.status === "published"),
      s.parcels,
      params,
    );
  }
  async listProducts(merchantId: string, options: SnapshotOptions = {}): Promise<Product[]> {
    return this.fresh(options.now?.getTime())
      .products.filter((p) => p.merchantId === merchantId && p.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async getProduct(id: string, options: SnapshotOptions = {}): Promise<Product | null> {
    return this.fresh(options.now?.getTime()).products.find((p) => p.id === id && p.active) ?? null;
  }
  async getProducts(ids: string[], options: SnapshotOptions = {}): Promise<Product[]> {
    const set = new Set(ids);
    return this.fresh(options.now?.getTime()).products.filter((p) => set.has(p.id) && p.active);
  }
  async searchProducts(params: ProductSearchParams): Promise<Product[]> {
    const s = this.fresh();
    const published = new Set(s.merchants.filter((m) => m.status === "published").map((m) => m.id));
    return filterProducts(
      s.products.filter((p) => p.active && published.has(p.merchantId)),
      s.merchants,
      params,
    );
  }
  /** Full employee config: server-only (system prompts). */
  async getEmployee(merchantId: string): Promise<AiEmployee | null> {
    return this.fullEmployees().find((e) => e.merchantId === merchantId) ?? null;
  }
  private fullEmployees(): AiEmployee[] {
    return this.fresh().employees as AiEmployee[];
  }
  async listEvents(params: EventListParams = {}): Promise<CityEvent[]> {
    const from = params.from ? Date.parse(params.from) : null;
    const to = params.to ? Date.parse(params.to) : null;
    const now = from ?? Date.now();
    return this.fresh(now)
      .events.filter((e) => e.status !== "cancelled")
      .filter((e) => !params.status || params.status.includes(eventPhase(e, now)))
      .filter((e) => from === null || Date.parse(e.endsAt) >= from)
      .filter((e) => to === null || Date.parse(e.startsAt) <= to)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .slice(0, params.limit ?? 50);
  }
  async getEvent(id: string, options: SnapshotOptions = {}): Promise<CityEvent | null> {
    return this.fresh(options.now?.getTime()).events.find((e) => e.id === id) ?? null;
  }
  async listOffers(merchantId?: string, options: SnapshotOptions = {}): Promise<Offer[]> {
    const now = options.now?.getTime() ?? Date.now();
    return this.fresh(now).offers.filter(
      (o) =>
        o.active &&
        (!merchantId || o.merchantId === merchantId) &&
        Date.parse(o.startsAt) <= now &&
        Date.parse(o.endsAt) >= now,
    );
  }
  async getRewards(ids: string[]): Promise<DigitalReward[]> {
    const set = new Set(ids);
    return this.fresh().rewards.filter((r) => set.has(r.id));
  }

  // ------------------------------------------------------------------ commerce
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const id = randomId("ord");
    const now = new Date().toISOString();
    const order: Order = {
      ...input,
      id,
      items: input.items.map((item) => ({ ...item, id: randomId("oi"), orderId: id })),
      fulfillments: [],
      placedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(id, order);
    return structuredClone(order);
  }
  async getOrder(id: string): Promise<Order | null> {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : null;
  }
  async getOrderByCheckoutSession(sessionId: string): Promise<Order | null> {
    for (const o of this.orders.values()) {
      if (o.stripeCheckoutSessionId === sessionId) return structuredClone(o);
    }
    return null;
  }
  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const o = this.orders.get(id);
    if (!o) throw new Error(`Order ${id} not found`);
    const next: Order = { ...o, ...patch, updatedAt: new Date().toISOString() };
    this.orders.set(id, next);
    return structuredClone(next);
  }
  async markOrderPaid(
    id: string,
    patch: { stripePaymentIntentId?: string; paidAt: string },
  ): Promise<Order | null> {
    const o = this.orders.get(id);
    if (!o || o.status !== "pending_payment") return null;
    const next: Order = {
      ...o,
      status: "paid",
      paidAt: patch.paidAt,
      ...(patch.stripePaymentIntentId
        ? { stripePaymentIntentId: patch.stripePaymentIntentId }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(id, next);
    return structuredClone(next);
  }
  async claimOrder(id: string, accessTokenHash: string, userId: string): Promise<boolean> {
    const o = this.orders.get(id);
    if (!o || o.userId || !o.accessTokenHash || o.accessTokenHash !== accessTokenHash) return false;
    o.userId = userId;
    return true;
  }
  async listOrdersForUser(userId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.userId === userId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((o) => structuredClone(o));
  }
  async upsertFulfillment(
    f: Omit<OrderFulfillment, "id"> & { id?: string },
  ): Promise<OrderFulfillment> {
    const o = this.orders.get(f.orderId);
    if (!o) throw new Error(`Order ${f.orderId} not found`);
    const id = f.id ?? randomId("ful");
    const full: OrderFulfillment = { ...f, id };
    const idx = o.fulfillments.findIndex((x) => x.id === id);
    if (idx >= 0) o.fulfillments[idx] = full;
    else o.fulfillments.push(full);
    o.updatedAt = new Date().toISOString();
    return structuredClone(full);
  }
  async grantReward(userId: string, rewardId: string, sourceOrderId?: string): Promise<UserReward> {
    const list = this.rewards.get(userId) ?? [];
    const existing = list.find((r) => r.rewardId === rewardId);
    if (existing) return existing;
    const reward: UserReward = {
      userId,
      rewardId,
      grantedAt: new Date().toISOString(),
      ...(sourceOrderId ? { sourceOrderId } : {}),
    };
    list.push(reward);
    this.rewards.set(userId, list);
    return reward;
  }
  async listUserRewards(userId: string): Promise<UserReward[]> {
    return [...(this.rewards.get(userId) ?? [])];
  }
  async getProfile(userId: string): Promise<Profile | null> {
    return this.profiles.get(userId) ?? null;
  }
  async updateProfile(
    userId: string,
    patch: Partial<Omit<Profile, "id" | "createdAt">>,
  ): Promise<Profile> {
    const current = this.profiles.get(userId) ?? defaultProfile(userId);
    const next = { ...current, ...patch };
    this.profiles.set(userId, next);
    return next;
  }
  private xpKeys = new Set<string>();
  async addXp(
    userId: string,
    amount: number,
    reason: string,
    sourceOrderId?: string,
  ): Promise<Profile> {
    const current = this.profiles.get(userId) ?? defaultProfile(userId);
    if (sourceOrderId) {
      const key = `${userId}:${reason}:${sourceOrderId}`;
      if (this.xpKeys.has(key)) return current;
      this.xpKeys.add(key);
    }
    const xp = current.xp + Math.max(0, amount);
    const next = { ...current, xp, cityLevel: levelForXp(xp) };
    this.profiles.set(userId, next);
    return next;
  }
  async redeemOffer(offerId: string): Promise<boolean> {
    const offer = this.fresh().offers.find((o) => o.id === offerId);
    if (!offer || !offer.active) return false;
    const now = Date.now();
    if (Date.parse(offer.startsAt) > now || Date.parse(offer.endsAt) < now) return false;
    if (offer.maxRedemptions !== undefined && offer.redemptionsCount >= offer.maxRedemptions)
      return false;
    offer.redemptionsCount += 1;
    return true;
  }
  async recordAnalytics(records: AnalyticsRecord[]): Promise<void> {
    this.analytics.push(...records);
    if (this.analytics.length > 5000) this.analytics.splice(0, this.analytics.length - 5000);
  }
  async appendAiMessages(input: {
    conversationId?: string;
    userId?: string;
    scope: "concierge" | "employee";
    merchantId?: string;
    messages: AiMessageRecord[];
  }): Promise<{ conversationId: string }> {
    const id = input.conversationId ?? randomId("conv");
    const conv = this.conversations.get(id) ?? {
      scope: input.scope,
      messages: [],
      ...(input.merchantId ? { merchantId: input.merchantId } : {}),
    };
    conv.messages.push(...input.messages);
    this.conversations.set(id, conv);
    return { conversationId: id };
  }

  // ------------------------------------------------------------------ admin (merchant generator)
  async saveMerchantDraft(input: MerchantDraftInput): Promise<MerchantDraft> {
    const now = new Date().toISOString();
    const existing = input.id ? this.drafts.get(input.id) : undefined;
    if (existing?.status === "published") throw new Error("A published draft cannot be edited.");
    const draft: MerchantDraft = {
      ...input,
      id: input.id ?? randomId("draft"),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.drafts.set(draft.id, structuredClone(draft));
    return structuredClone(draft);
  }
  async getMerchantDraft(id: string): Promise<MerchantDraft | null> {
    const d = this.drafts.get(id);
    return d ? structuredClone(d) : null;
  }
  async listMerchantDrafts(): Promise<MerchantDraft[]> {
    return [...this.drafts.values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((d) => structuredClone(d));
  }
  async publishMerchantDraft(id: string): Promise<{ merchantId: string }> {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`Draft ${id} not found`);
    const parcel = this.fresh().parcels.find((p) => p.id === draft.placement?.parcelId);
    const problem = draftPublishProblem(draft, parcel);
    if (problem || !parcel) throw new Error(problem ?? "Cannot publish this draft.");
    const merchantId = randomId("mer");
    const rows = rowsFromDraft(
      draft,
      parcel,
      { merchantId, employeeId: randomId("emp"), productId: () => randomId("prd") },
      new Date().toISOString(),
    );
    this.published.push(rows);
    draft.status = "published";
    draft.publishedMerchantId = merchantId;
    draft.updatedAt = new Date().toISOString();
    return { merchantId };
  }
}

export function toPublicEmployee(e: AiEmployee | AiEmployeePublic): AiEmployeePublic {
  return {
    id: e.id,
    merchantId: e.merchantId,
    name: e.name,
    role: e.role,
    ...(e.avatarUrl ? { avatarUrl: e.avatarUrl } : {}),
    greeting: e.greeting,
  };
}

export function levelForXp(xp: number): number {
  return Math.max(1, 1 + Math.floor(Math.sqrt(xp / 100)));
}

function defaultProfile(userId: string): Profile {
  return {
    id: userId,
    displayName: "Citizen",
    avatar: { bodyColor: "#4F86F7", hairColor: "#2B2118", accessories: [] },
    cityLevel: 1,
    xp: 0,
    dietaryPreferences: [],
    createdAt: new Date().toISOString(),
  };
}

export { isOpenNow };
