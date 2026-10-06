import { z } from "zod";

export const dietaryTagSchema = z.enum([
  "vegan",
  "vegetarian",
  "gluten_free",
  "dairy_free",
  "nut_free",
  "halal",
  "kosher",
]);

export const MAX_CHAT_MESSAGES = 16;
export const MAX_CHAT_MESSAGE_CHARS = 2000;
export const MAX_CHAT_TOTAL_CHARS = 12_000;

export const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_CHAT_MESSAGES)
    .refine((msgs) => msgs.reduce((n, m) => n + m.content.length, 0) <= MAX_CHAT_TOTAL_CHARS, {
      message: "Conversation too long",
    })
    .refine((msgs) => msgs[msgs.length - 1]?.role === "user", {
      message: "Last message must be from the user",
    }),
  context: z.object({
    location: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("street") }),
      z.object({
        kind: z.literal("interior"),
        merchantId: z.string().min(1),
        parcelId: z.string().min(1).max(64).optional(),
      }),
    ]),
    cart: z.object({
      lines: z
        .array(
          z.object({
            productId: z.string().min(1).max(64),
            quantity: z.number().int().min(1).max(99),
          }),
        )
        .max(50),
    }),
    localTime: z.string().max(40).optional(),
    preferences: z
      .object({
        dietary: z.array(dietaryTagSchema).max(7).optional(),
        budgetCents: z.number().int().min(0).max(10_000_000).optional(),
        occasion: z.string().max(80).optional(),
        partySize: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  }),
  merchantId: z.string().min(1).max(64).optional(),
  /** Only honoured for signed-in users whose conversation it is. */
  conversationId: z.uuid().optional(),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

const idSchema = z.string().min(1).max(64);

const navTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("merchant"), merchantId: idSchema }),
  z.object({ kind: z.literal("district"), districtId: idSchema }),
  z.object({ kind: z.literal("parcel"), parcelId: idSchema }),
  z.object({ kind: z.literal("event"), eventId: idSchema }),
  z.object({ kind: z.literal("point"), x: z.number().finite(), z: z.number().finite() }),
]);

/**
 * Shape check for actions arriving over the stream, before the client checks every id against the
 * city index (`validateAIAction`). Ids only: the AI never sends prices, names or coordinates
 * the client would trust.
 */
export const aiActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    target: navTargetSchema,
    mode: z.enum(["teleport", "guide"]),
    label: z.string().min(1).max(80),
  }),
  z.object({
    type: z.literal("propose_cart"),
    items: z
      .array(
        z.object({
          productId: idSchema,
          quantity: z.number().int().min(1).max(10),
          variantSelection: z.record(z.string().max(40), z.string().max(40)).optional(),
        }),
      )
      .min(1)
      .max(8),
    note: z.string().max(160).optional(),
  }),
  z.object({ type: z.literal("escalate"), merchantId: idSchema, reason: z.string().max(200) }),
  z.object({
    type: z.literal("highlight_storefront"),
    merchantId: idSchema,
    parcelId: idSchema.optional(),
    label: z.string().min(1).max(80),
    reason: z.string().max(160).optional(),
  }),
  z.object({ type: z.literal("open_merchant"), merchantId: idSchema }),
  z.object({ type: z.literal("open_product"), productId: idSchema }),
  z.object({
    type: z.literal("recommend"),
    productIds: z.array(idSchema).max(8),
    merchantIds: z.array(idSchema).max(8),
    reason: z.string().max(160).optional(),
  }),
]);
