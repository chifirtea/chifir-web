import "server-only";
import { z } from "zod";
import { publicEnv } from "./env";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  STRIPE_SECRET_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  STRIPE_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  AI_MODEL: z.preprocess(blankToUndefined, z.string().min(1).default("claude-opus-5-5")),
  COMMERCE_MODE: z.preprocess(blankToUndefined, z.enum(["demo", "live"]).default("demo")),
  ALLOW_CLOCK_OVERRIDE: z.preprocess(blankToUndefined, z.enum(["0", "1"]).default("0")),
  ADMIN_ACCESS_TOKEN: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  PRESENCE_ROOM_PREFIX: z.preprocess(blankToUndefined, z.string().min(1).max(32).default("city")),
});

export const serverEnv = serverSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  COMMERCE_MODE: process.env.COMMERCE_MODE,
  ALLOW_CLOCK_OVERRIDE: process.env.ALLOW_CLOCK_OVERRIDE,
  ADMIN_ACCESS_TOKEN: process.env.ADMIN_ACCESS_TOKEN,
  PRESENCE_ROOM_PREFIX: process.env.PRESENCE_ROOM_PREFIX,
});

const supabaseConfigured = Boolean(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL &&
  publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  serverEnv.SUPABASE_SERVICE_ROLE_KEY,
);
const isProduction = serverEnv.NODE_ENV === "production";
const stripeKey = serverEnv.STRIPE_SECRET_KEY;
const stripeIsLive = Boolean(stripeKey?.startsWith("sk_live_"));

// Boot-time invariants: real money never runs against in-memory storage or in demo mode.
if (stripeKey && !supabaseConfigured && isProduction) {
  throw new Error(
    "STRIPE_SECRET_KEY is set but Supabase is not configured. Orders need durable storage in production.",
  );
}
if (stripeIsLive && !(serverEnv.COMMERCE_MODE === "live" && isProduction)) {
  throw new Error("A live Stripe key requires COMMERCE_MODE=live and NODE_ENV=production.");
}

/** Feature flags derived from configuration. Every consumer degrades gracefully when false. */
export const features = {
  /** Supabase is fully configured for server use (data + auth). */
  supabase: supabaseConfigured,
  /** Stripe Checkout is available. Requires durable order storage. */
  stripe: Boolean(stripeKey) && supabaseConfigured,
  stripeWebhooks: Boolean(stripeKey && serverEnv.STRIPE_WEBHOOK_SECRET) && supabaseConfigured,
  ai: Boolean(serverEnv.ANTHROPIC_API_KEY),
  /** Simulated payment path. Never available in production. */
  demoPayments: serverEnv.COMMERCE_MODE === "demo" && !isProduction,
  /**
   * `?clock=` / clock-offset header honoured. On by default outside production; a staging
   * deployment sets ALLOW_CLOCK_OVERRIDE=1 to rehearse a drop. Never on a real store.
   */
  demoClock: !isProduction || serverEnv.ALLOW_CLOCK_OVERRIDE === "1",
  /**
   * Admin surfaces (merchant generator). Require the token in production; open on localhost so
   * the prototype is usable without setup.
   */
  admin: Boolean(serverEnv.ADMIN_ACCESS_TOKEN) || !isProduction,
} as const;
