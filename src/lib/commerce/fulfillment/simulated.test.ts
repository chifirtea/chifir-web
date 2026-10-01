import { describe, expect, it } from "vitest";
import type { Merchant, Order, OrderFulfillment } from "@/types/domain";
import { SimulatedProvider, estimateEta } from "./simulated";
import { getFulfillmentProvider, isTerminalFulfillment } from "./provider";

const T0 = new Date("2026-09-30T18:00:00.000Z");
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const merchant = {
  id: "m1",
  name: "Ember & Oak",
  fulfillment: {
    provider: "simulated",
    delivery: { enabled: true, feeCents: 399, minutesMin: 25, minutesMax: 40 },
    pickup: { enabled: true, minutesMin: 15, minutesMax: 20 },
    shipping: { enabled: true, feeCents: 0, daysMin: 3, daysMax: 5 },
  },
} as unknown as Merchant;

const order = { id: "ord_1", items: [] } as unknown as Order;

const fulfillment = (
  type: OrderFulfillment["type"],
  extra: Partial<OrderFulfillment> = {},
): OrderFulfillment => ({
  id: `ful_${type}`,
  orderId: "ord_1",
  merchantId: "m1",
  merchantNameSnapshot: "Ember & Oak",
  provider: "simulated",
  type,
  status: "pending",
  subtotalCents: 1000,
  feeCents: 0,
  events: [],
  ...extra,
});

const provider = new SimulatedProvider();
const create = (type: OrderFulfillment["type"]) =>
  provider.create({ order, fulfillment: fulfillment(type), merchant, items: [] }, T0);

describe("SimulatedProvider.create", () => {
  it("accepts delivery with pending + accepted events and an ETA from the merchant window", async () => {
    const f = await create("delivery");
    expect(f.status).toBe("accepted");
    expect(f.events.map((e) => e.status)).toEqual(["pending", "accepted"]);
    expect(f.events.every((e) => e.at === T0.toISOString())).toBe(true);
    expect(f.etaAt).toBe(new Date(T0.getTime() + 40 * 60_000).toISOString());
    expect(f.externalId).toBe("sim_ful_delivery");
  });

  it("uses pickup minutes and shipping days for ETAs, with defaults when the merchant is unknown", async () => {
    expect((await create("pickup")).etaAt).toBe(new Date(T0.getTime() + 20 * 60_000).toISOString());
    expect((await create("shipping")).etaAt).toBe(
      new Date(T0.getTime() + 5 * 86_400_000).toISOString(),
    );
    expect(estimateEta("delivery", null, T0).getTime()).toBe(T0.getTime() + 30 * 60_000);
    expect(estimateEta("shipping", null, T0).getTime()).toBe(T0.getTime() + 4 * 86_400_000);
  });

  it("delivers tickets and digital goods immediately", async () => {
    for (const type of ["ticket", "digital"] as const) {
      const f = await create(type);
      expect(f.status).toBe("delivered");
      expect(f.events.map((e) => e.status)).toEqual(["pending", "accepted", "delivered"]);
      expect(f.etaAt).toBe(T0.toISOString());
      expect(isTerminalFulfillment(f.status)).toBe(true);
    }
  });
});

describe("SimulatedProvider.getStatus", () => {
  it("advances a delivery deterministically from acceptedAt", async () => {
    const accepted = await create("delivery");

    const early = await provider.getStatus(accepted, plus(30));
    expect(early).toBe(accepted); // same reference: nothing changed

    const preparing = await provider.getStatus(accepted, plus(61));
    expect(preparing.status).toBe("preparing");
    expect(preparing.events.map((e) => e.status)).toEqual(["pending", "accepted", "preparing"]);
    expect(preparing.events[2]?.at).toBe(plus(60).toISOString());

    const out = await provider.getStatus(preparing, plus(200));
    expect(out.status).toBe("out_for_delivery");
    expect(out.events.at(-1)?.at).toBe(plus(180).toISOString());

    const done = await provider.getStatus(out, plus(400));
    expect(done.status).toBe("delivered");
    expect(done.events.map((e) => e.status)).toEqual([
      "pending",
      "accepted",
      "preparing",
      "out_for_delivery",
      "delivered",
    ]);
    expect(done.trackingUrl).toBeUndefined();
  });

  it("fills in skipped steps when polled late and never duplicates events", async () => {
    const accepted = await create("delivery");
    const late = await provider.getStatus(accepted, plus(1000));
    expect(late.status).toBe("delivered");
    expect(late.events.map((e) => e.status)).toEqual([
      "pending",
      "accepted",
      "preparing",
      "out_for_delivery",
      "delivered",
    ]);
    const again = await provider.getStatus(late, plus(2000));
    expect(again).toBe(late);
  });

  it("marks shipping as shipped with a tracking URL, then delivered", async () => {
    const accepted = await create("shipping");
    const packed = await provider.getStatus(accepted, plus(100));
    expect(packed.status).toBe("preparing");
    expect(packed.trackingUrl).toBeUndefined();
    const shipped = await provider.getStatus(packed, plus(160));
    expect(shipped.status).toBe("shipped");
    expect(shipped.trackingUrl).toBe("/orders/ord_1");
    const delivered = await provider.getStatus(shipped, plus(500));
    expect(delivered.status).toBe("delivered");
    expect(delivered.events.map((e) => e.status)).toEqual([
      "pending",
      "accepted",
      "preparing",
      "shipped",
      "delivered",
    ]);
  });

  it("uses ready for pickup", async () => {
    const accepted = await create("pickup");
    expect((await provider.getStatus(accepted, plus(200))).status).toBe("ready");
    expect((await provider.getStatus(accepted, plus(361))).status).toBe("delivered");
  });

  it("leaves pending (not yet handed off) and terminal fulfillments alone", async () => {
    const pending = fulfillment("delivery");
    expect(await provider.getStatus(pending, plus(9999))).toBe(pending);
    const cancelled = await provider.cancel(await create("delivery"), plus(10));
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events.at(-1)).toEqual({ status: "cancelled", at: plus(10).toISOString() });
    expect(await provider.getStatus(cancelled, plus(9999))).toBe(cancelled);
    expect(await provider.cancel(cancelled, plus(20))).toBe(cancelled);
  });
});

describe("registry", () => {
  it("resolves every provider id to a provider (simulated for the MVP)", () => {
    for (const id of ["simulated", "merchant_self", "doordash_drive", "shippo"] as const) {
      expect(getFulfillmentProvider(id).id).toBe("simulated");
    }
  });
});
