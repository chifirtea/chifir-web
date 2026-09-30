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
    .refine((msgs) => msgs[msgs.length - 1]?.role === "user", { message: "Last message must be from the user" }),
  context: z.object({
    location: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("street") }),
      z.object({ kind: z.literal("interior"), merchantId: z.string().min(1) }),
    ]),
    cart: z.object({
      lines: z
        .array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) }))
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
