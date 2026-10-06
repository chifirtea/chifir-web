import { z } from "zod";

export const fulfillmentTypeSchema = z.enum([
  "delivery",
  "pickup",
  "shipping",
  "booking",
  "ticket",
  "digital",
  "lead",
]);

export const addressSchema = z.object({
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).optional(),
  city: z.string().min(1).max(80),
  region: z.string().min(1).max(80),
  postalCode: z.string().min(2).max(20),
  country: z.string().length(2),
});

export const cartLineInputSchema = z.object({
  productId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(99),
  variantSelection: z.record(z.string().max(64), z.string().max(64)).default({}),
  notes: z.string().max(280).optional(),
});

const NEEDS_ADDRESS = new Set(["delivery", "shipping"]);

export const checkoutRequestSchema = z
  .object({
    lines: z.array(cartLineInputSchema).min(1).max(50),
    /** One entry per merchant present in `lines`. */
    fulfillment: z
      .array(z.object({ merchantId: z.string().min(1).max(64), type: fulfillmentTypeSchema }))
      .min(1)
      .max(20),
    contact: z.object({
      email: z.email().max(200),
      name: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
    }),
    deliveryAddress: addressSchema.optional(),
    promoCode: z
      .string()
      .trim()
      .max(32)
      .regex(/^[A-Za-z0-9_-]*$/)
      .optional(),
    /** Funnel attribution (from the analytics client). Optional; never trusted for anything else. */
    analytics: z
      .object({
        sessionId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
        anonymousId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const f of body.fulfillment) {
      if (seen.has(f.merchantId)) {
        ctx.addIssue({ code: "custom", message: `Duplicate fulfillment entry for merchant ${f.merchantId}`, path: ["fulfillment"] });
      }
      seen.add(f.merchantId);
    }
    const needsAddress = body.fulfillment.some((f) => NEEDS_ADDRESS.has(f.type));
    if (needsAddress && !body.deliveryAddress) {
      ctx.addIssue({ code: "custom", message: "A delivery address is required for delivery or shipping.", path: ["deliveryAddress"] });
    }
  });

export type CheckoutRequestInput = z.infer<typeof checkoutRequestSchema>;
