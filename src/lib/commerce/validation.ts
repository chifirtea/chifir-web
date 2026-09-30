import { z } from "zod";

/** Guest access token: 32 random bytes, hex. */
export const orderTokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "Invalid token");

/** Order ids are uuids (Supabase) or `ord_<uuid>` (static mode). */
export const orderIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const demoPaymentSchema = z.object({
  orderId: orderIdSchema,
  token: orderTokenSchema,
});

export const orderTokenBodySchema = z.object({
  token: orderTokenSchema.optional(),
});

export const claimOrderSchema = z.object({
  token: orderTokenSchema,
});
