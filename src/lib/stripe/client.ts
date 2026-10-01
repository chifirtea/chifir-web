import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env.server";

/**
 * Pinned to the version the installed SDK's types reflect (`stripe/esm/apiVersion`). Bump the SDK
 * and this constant together so request/response types stay truthful.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

let instance: Stripe | null = null;

/** Lazy process-wide Stripe client. Throws when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe {
  if (!instance) {
    const key = serverEnv.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Stripe requested but STRIPE_SECRET_KEY is not configured.");
    instance = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
      appInfo: { name: "chifir-web", version: "0.1.0" },
    });
  }
  return instance;
}
