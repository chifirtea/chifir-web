import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StaticDataSource } from "@/lib/data/static";
import { sid } from "@/data/seed/ids";
import { checkoutRequestSchema, type CheckoutRequestInput } from "@/lib/validation/checkout";
import { computeTotals, lineKey } from "@/features/cart/pricing";
import {
  CheckoutError,
  XP_BASE_PER_PURCHASE,
  authorizeOrderAccess,
  completeOrder,
  createCheckoutOrder,
  grantOrderRewards,
  publicOrder,
  refreshOrderStatus,
  sha256,
} from "./service";

const BLOOM = sid.merchant("bloom-and-co");
const BOUQUET = sid.product("bloom-and-co", "date-night-bouquet");
const BOUQUET_REWARD = sid.reward("bloom-date-night-flowers");
const NORTHLINE = sid.merchant("northline-supply");
const HOODIE = sid.product("northline-supply", "meridian-hoodie");
const HOODIE_REWARD = sid.reward("northline-meridian-hoodie");
const HALL = sid.merchant("the-hall");
const TICKET = sid.product("the-hall", "friday-live-set-ga");
const DATE5 = sid.offer("bloom-date-night-5-off");

const address = { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const contact = { email: "sam@example.com", name: "Sam" };

function body(raw: Record<string, unknown>): CheckoutRequestInput {
  return checkoutRequestSchema.parse({ contact, ...raw });
}

const mixedCart = () =>
  body({
    lines: [
      { productId: BOUQUET, quantity: 2 },
      { productId: HOODIE, quantity: 1, variantSelection: { size: "m", color: "ink" } },
    ],
    fulfillment: [
      { merchantId: BLOOM, type: "delivery" },
      { merchantId: NORTHLINE, type: "shipping" },
    ],
    deliveryAddress: address,
    analytics: { sessionId: "sess_123456", anonymousId: "anon_123456" },
  });

let ds: StaticDataSource;
beforeEach(() => {
  ds = new StaticDataSource();
});

describe("createCheckoutOrder", () => {
  it("prices the order with computeTotals and snapshots every line", async () => {
    const input = mixedCart();
    const { order, totals, accessToken } = await createCheckoutOrder({ body: input, paymentProvider: "demo" }, ds);

    const products = await ds.getProducts([BOUQUET, HOODIE]);
    const merchants = await ds.listMerchants();
    const expected = computeTotals(
      input.lines.map((l) => ({
        key: lineKey(l.productId, l.variantSelection),
        productId: l.productId,
        merchantId: products.find((p) => p.id === l.productId)!.merchantId,
        quantity: l.quantity,
        variantSelection: l.variantSelection,
      })),
      Object.fromEntries(products.map((p) => [p.id, p])),
      Object.fromEntries(merchants.map((m) => [m.id, m])),
      { [BLOOM]: "delivery", [NORTHLINE]: "shipping" },
      { offers: await ds.listOffers() },
    );
    expect(expected.problems).toEqual([]);
    expect(totals.totalCents).toBe(expected.totalCents);
    expect(order.subtotalCents).toBe(expected.subtotalCents);
    expect(order.subtotalCents).toBe(7900 * 2 + 12800);
    expect(order.deliveryFeeCents).toBe(699);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(7900 * 2 + 12800 + 699);
    expect(order.status).toBe("pending_payment");
    expect(order.paymentProvider).toBe("demo");
    expect(order.sessionId).toBe("sess_123456");
    expect(order.contact).toEqual(contact);
    expect(order.deliveryAddress).toEqual(address);

    expect(order.items).toHaveLength(2);
    const hoodie = order.items.find((i) => i.productId === HOODIE)!;
    expect(hoodie.titleSnapshot).toBe("Meridian Hoodie");
    expect(hoodie.merchantNameSnapshot).toBe("Northline Supply");
    expect(hoodie.variantLabel).toBe("M · Ink");
    expect(hoodie.variantSelection).toEqual({ size: "m", color: "ink" });
    expect(hoodie.unitPriceCents).toBe(12800);
    expect(hoodie.digitalRewardId).toBe(HOODIE_REWARD);
    expect(hoodie.imageUrlSnapshot).toMatch(/^https:\/\//);

    // Guest access: a 64-hex token whose sha256 is stored, never the token itself.
    expect(accessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(order.accessTokenHash).toBe(sha256(accessToken));
    expect(JSON.stringify(order)).not.toContain(accessToken);
  });

  it("creates one fulfillment per merchant with that merchant's fee, type and address", async () => {
    const { order } = await createCheckoutOrder({ body: mixedCart() }, ds);
    expect(order.fulfillments).toHaveLength(2);
    const bloom = order.fulfillments.find((f) => f.merchantId === BLOOM)!;
    const north = order.fulfillments.find((f) => f.merchantId === NORTHLINE)!;
    expect(bloom).toMatchObject({
      type: "delivery",
      status: "pending",
      provider: "simulated",
      feeCents: 699,
      subtotalCents: 7900 * 2,
      merchantNameSnapshot: "Bloom & Co.",
      recipient: contact,
      deliveryAddress: address,
      events: [],
    });
    expect(north).toMatchObject({ type: "shipping", feeCents: 0, subtotalCents: 12800, deliveryAddress: address });
  });

  it("applies a promo code through computeTotals and records the discount on the order", async () => {
    const input = body({
      lines: [{ productId: BOUQUET, quantity: 2 }],
      fulfillment: [{ merchantId: BLOOM, type: "pickup" }],
      promoCode: "date5",
    });
    const { order, totals } = await createCheckoutOrder({ body: input }, ds);
    expect(totals.promoCodeApplied).toBe(true);
    expect(order.discountCents).toBe(500 * 2);
    expect(order.totalCents).toBe(7900 * 2 - 1000);
    expect(order.deliveryFeeCents).toBe(0);
    expect(order.promoCode).toBe("date5");
    expect(order.items[0]).toMatchObject({ offerId: DATE5, discountCents: 1000 });
  });

  it("merges duplicate lines for the same product and variant", async () => {
    const input = body({
      lines: [
        { productId: BOUQUET, quantity: 1 },
        { productId: BOUQUET, quantity: 2 },
      ],
      fulfillment: [{ merchantId: BLOOM, type: "pickup" }],
    });
    const { order } = await createCheckoutOrder({ body: input }, ds);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.quantity).toBe(3);
  });

  it("rejects carts with unpurchasable lines and never creates an order", async () => {
    const input = body({
      lines: [{ productId: HOODIE, quantity: 1 }], // required size + color missing
      fulfillment: [{ merchantId: NORTHLINE, type: "shipping" }],
      deliveryAddress: address,
    });
    const err = await createCheckoutOrder({ body: input }, ds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect((err as CheckoutError).status).toBe(400);
    expect((err as CheckoutError).problems[0]?.reason).toMatch(/Choose a size/);
  });

  it("rejects when a merchant in the cart has no fulfillment choice", async () => {
    const input = body({
      lines: [{ productId: BOUQUET, quantity: 1 }],
      fulfillment: [{ merchantId: NORTHLINE, type: "pickup" }],
    });
    const err = await createCheckoutOrder({ body: input }, ds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect((err as CheckoutError).problems).toEqual([
      { key: BOUQUET, reason: "Choose how you want this delivered." },
    ]);
  });

  it("rejects fulfillment types the merchant does not offer", async () => {
    const input = body({
      lines: [{ productId: BOUQUET, quantity: 1 }],
      fulfillment: [{ merchantId: BLOOM, type: "shipping" }],
      deliveryAddress: address,
    });
    const err = await createCheckoutOrder({ body: input }, ds).catch((e: unknown) => e);
    expect((err as CheckoutError).problems[0]?.reason).toMatch(/not available for shipping/);
  });
});

describe("payment and completion", () => {
  it("is idempotent: markOrderPaid transitions once, so completeOrder runs once", async () => {
    const { order } = await createCheckoutOrder(
      { body: body({ lines: [{ productId: BOUQUET, quantity: 1 }], fulfillment: [{ merchantId: BLOOM, type: "pickup" }], promoCode: "DATE5" }) },
      ds,
    );
    const before = (await ds.listOffers()).find((o) => o.id === DATE5)!.redemptionsCount;

    const first = await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() });
    expect(first?.status).toBe("paid");
    const completed = await completeOrder(first!, ds);

    const second = await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() });
    expect(second).toBeNull(); // webhook retry: nothing to do

    expect(completed.status).toBe("in_fulfillment");
    expect(completed.fulfillments[0]?.status).toBe("accepted");
    expect(completed.fulfillments[0]?.events.map((e) => e.status)).toEqual(["pending", "accepted"]);
    expect(completed.fulfillments[0]?.etaAt).toBeDefined();
    const after = (await ds.listOffers()).find((o) => o.id === DATE5)!.redemptionsCount;
    expect(after).toBe(before + 1);
  });

  it("does not grant rewards or XP to guests, but does for signed-in buyers (idempotently)", async () => {
    const cart = () =>
      body({ lines: [{ productId: BOUQUET, quantity: 1 }], fulfillment: [{ merchantId: BLOOM, type: "pickup" }] });

    const guest = await createCheckoutOrder({ body: cart() }, ds);
    await completeOrder((await ds.markOrderPaid(guest.order.id, { paidAt: new Date().toISOString() }))!, ds);
    expect(await ds.listUserRewards("u1")).toEqual([]);

    const member = await createCheckoutOrder({ body: cart(), userId: "u1" }, ds);
    const paid = (await ds.markOrderPaid(member.order.id, { paidAt: new Date().toISOString() }))!;
    await completeOrder(paid, ds);
    const rewards = await ds.listUserRewards("u1");
    expect(rewards.map((r) => r.rewardId)).toEqual([BOUQUET_REWARD]);
    expect(rewards[0]?.sourceOrderId).toBe(member.order.id);
    const expectedXp = XP_BASE_PER_PURCHASE + Math.floor(member.order.totalCents / 100);
    expect((await ds.getProfile("u1"))?.xp).toBe(expectedXp);

    // A later claim re-runs the grant without double counting.
    await grantOrderRewards((await ds.getOrder(member.order.id))!, "u1", ds);
    expect((await ds.getProfile("u1"))?.xp).toBe(expectedXp);
    expect(await ds.listUserRewards("u1")).toHaveLength(1);
  });

  it("never grants for an unpaid order", async () => {
    const { order } = await createCheckoutOrder(
      { body: body({ lines: [{ productId: BOUQUET, quantity: 1 }], fulfillment: [{ merchantId: BLOOM, type: "pickup" }] }), userId: "u2" },
      ds,
    );
    await grantOrderRewards(order, "u2", ds);
    expect(await ds.listUserRewards("u2")).toEqual([]);
    expect(await ds.getProfile("u2")).toBeNull();
  });

  it("advances fulfillments on refresh and completes the order once everything is delivered", async () => {
    const { order } = await createCheckoutOrder({ body: mixedCart() }, ds);
    const paid = (await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() }))!;
    const active = await completeOrder(paid, ds);
    expect(active.status).toBe("in_fulfillment");

    const acceptedAt = Date.parse(active.fulfillments[0]!.events[1]!.at);
    const midway = await refreshOrderStatus(active, new Date(acceptedAt + 200_000), ds);
    expect(midway.status).toBe("in_fulfillment");
    expect(midway.fulfillments.find((f) => f.type === "delivery")?.status).toBe("out_for_delivery");
    expect(midway.fulfillments.find((f) => f.type === "shipping")?.status).toBe("shipped");
    expect(midway.fulfillments.find((f) => f.type === "shipping")?.trackingUrl).toBe(`/orders/${order.id}`);
    // Persisted, not just returned.
    expect((await ds.getOrder(order.id))?.fulfillments.find((f) => f.type === "delivery")?.status).toBe("out_for_delivery");

    const done = await refreshOrderStatus(midway, new Date(acceptedAt + 1_000_000), ds);
    expect(done.status).toBe("completed");
    expect(done.fulfillments.every((f) => f.status === "delivered")).toBe(true);
    expect((await ds.getOrder(order.id))?.status).toBe("completed");
  });

  it("completes ticket orders immediately", async () => {
    const { order, totals } = await createCheckoutOrder(
      { body: body({ lines: [{ productId: TICKET, quantity: 2 }], fulfillment: [{ merchantId: HALL, type: "ticket" }] }) },
      ds,
    );
    expect(totals.totalCents).toBe(5000);
    expect(order.fulfillments[0]).toMatchObject({ type: "ticket", feeCents: 0 });
    const paid = (await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() }))!;
    const done = await completeOrder(paid, ds);
    expect(done.status).toBe("completed");
    expect(done.fulfillments[0]?.status).toBe("delivered");
  });

  it("leaves unpaid orders untouched on refresh", async () => {
    const { order } = await createCheckoutOrder({ body: mixedCart() }, ds);
    expect(await refreshOrderStatus(order, new Date(Date.now() + 10_000_000), ds)).toBe(order);
  });
});

describe("access", () => {
  it("authorizes the owner or the token bearer, and strips the hash from public orders", async () => {
    const { order, accessToken } = await createCheckoutOrder({ body: mixedCart(), userId: "owner" }, ds);
    expect(authorizeOrderAccess(order, { token: accessToken })).toBe(true);
    expect(authorizeOrderAccess(order, { userId: "owner" })).toBe(true);
    expect(authorizeOrderAccess(order, { userId: "someone-else" })).toBe(false);
    expect(authorizeOrderAccess(order, { token: "f".repeat(64) })).toBe(false);
    expect(authorizeOrderAccess(order, {})).toBe(false);
    expect(authorizeOrderAccess({ status: "paid" } as never, { userId: "owner", token: accessToken })).toBe(false);

    const pub = publicOrder(order);
    expect("accessTokenHash" in pub).toBe(false);
    expect(pub.id).toBe(order.id);
    expect(pub.items).toHaveLength(2);
  });

  it("claims guest orders by token hash and then grants rewards", async () => {
    const { order, accessToken } = await createCheckoutOrder({ body: mixedCart() }, ds);
    await completeOrder((await ds.markOrderPaid(order.id, { paidAt: new Date().toISOString() }))!, ds);
    expect(await ds.claimOrder(order.id, sha256("nope"), "u3")).toBe(false);
    expect(await ds.claimOrder(order.id, sha256(accessToken), "u3")).toBe(true);
    await grantOrderRewards((await ds.getOrder(order.id))!, "u3", ds);
    expect((await ds.listUserRewards("u3")).map((r) => r.rewardId).sort()).toEqual([BOUQUET_REWARD, HOODIE_REWARD].sort());
    expect(await ds.claimOrder(order.id, sha256(accessToken), "u4")).toBe(false); // already owned
  });
});
