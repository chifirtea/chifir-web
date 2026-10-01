import { describe, expect, it } from "vitest";
import type { Merchant } from "@/types/domain";
import { feeLineLabel, fulfillmentEtaLine, fulfillmentOptionLabel } from "./fulfillmentLabels";

const merchant = {
  fulfillment: {
    provider: "simulated",
    delivery: { enabled: true, feeCents: 399, minutesMin: 25, minutesMax: 40 },
    pickup: { enabled: true, minutesMin: 15, minutesMax: 20 },
    shipping: { enabled: true, feeCents: 0, daysMin: 3, daysMax: 5 },
  },
} as unknown as Merchant;

describe("fulfillmentOptionLabel", () => {
  it("formats the cart's segmented-control labels", () => {
    expect(fulfillmentOptionLabel(merchant, "delivery").label).toBe("Delivery · $3.99 · 25–40 min");
    expect(fulfillmentOptionLabel(merchant, "pickup").label).toBe("Pickup · 15–20 min");
    expect(fulfillmentOptionLabel(merchant, "shipping").label).toBe("Ship · free · 3–5 days");
    expect(fulfillmentOptionLabel(merchant, "ticket").label).toBe("Tickets · sent right away");
  });
  it("degrades without merchant configuration", () => {
    expect(fulfillmentOptionLabel(undefined, "delivery").label).toBe("Delivery · free");
    expect(fulfillmentOptionLabel(undefined, "pickup").label).toBe("Pickup");
  });
});

describe("fulfillmentEtaLine", () => {
  it("formats the product panel's ETA sentence", () => {
    expect(fulfillmentEtaLine(merchant, "delivery")).toBe("Delivery in 25–40 min · $3.99");
    expect(fulfillmentEtaLine(merchant, "pickup")).toBe("Pickup in 15–20 min");
    expect(fulfillmentEtaLine(merchant, "shipping")).toBe("Ships in 3–5 days · free");
    expect(fulfillmentEtaLine(merchant, "digital")).toBe("Delivered right away");
  });
});

describe("feeLineLabel", () => {
  it("names the fee by channel", () => {
    expect(feeLineLabel("shipping")).toBe("Shipping");
    expect(feeLineLabel("delivery")).toBe("Delivery fee");
    expect(feeLineLabel(null)).toBe("Delivery fee");
  });
});
