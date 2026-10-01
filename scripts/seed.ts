/**
 * Seeds a Supabase project with the same data the static data source serves (ADR-002).
 *
 *   pnpm db:seed
 *
 * Reads `.env.local` then `.env`. Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Upserts in dependency order (onConflict: id), so it is safe to run again. Exits non-zero on
 * the first error.
 *
 * Imports the seed modules directly: `src/data/seed/index.ts` imports "server-only", which
 * throws outside Next.js.
 */
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildParcels, districts } from "../src/data/seed/districts";
import { employees, merchants } from "../src/data/seed/merchants";
import { buildProducts } from "../src/data/seed/products";
import { rewards } from "../src/data/seed/rewards";
import { buildOffers } from "../src/data/seed/offers";
import { buildEvents } from "../src/data/seed/events";
import {
  toDistrictRow,
  toEmployeeRow,
  toEventRow,
  toMerchantRow,
  toOfferRow,
  toParcelRow,
  toProductRow,
  toRewardRow,
  type Row,
} from "./seedMappers";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ error: "SUPABASE_SERVICE_ROLE_KEY is required" })
    .min(1, { error: "SUPABASE_SERVICE_ROLE_KEY is required" }),
});

interface Summary {
  table: string;
  rows: number;
}

async function upsert(
  db: SupabaseClient,
  table: string,
  rows: Row[],
  onConflict = "id",
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) {
    const extra = [error.details, error.hint].filter(Boolean).join(" · ");
    throw new Error(`${table}: ${error.message}${extra ? ` (${extra})` : ""}`);
  }
  return rows.length;
}

async function main(): Promise<void> {
  const env = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  });
  if (!env.success) {
    console.error("Cannot seed: missing configuration.\n");
    for (const issue of env.error.issues)
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    console.error(
      "\nSet them in .env.local (see .env.example and docs/SETUP.md). The service role key is server-only.",
    );
    process.exit(1);
  }

  const db = createClient(env.data.NEXT_PUBLIC_SUPABASE_URL, env.data.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const parcels = buildParcels(now);
  const products = buildProducts(now);
  const offers = buildOffers(now);
  const events = buildEvents(now);
  const host = new URL(env.data.NEXT_PUBLIC_SUPABASE_URL).host;
  const started = Date.now();
  const summary: Summary[] = [];

  console.log(`Seeding ${host} …`);

  // Dependency order. products.event_id is set in a second pass once events exist
  // (events reference products and products reference events).
  summary.push({
    table: "districts",
    rows: await upsert(db, "districts", districts.map(toDistrictRow)),
  });
  summary.push({
    table: "merchants",
    rows: await upsert(db, "merchants", merchants.map(toMerchantRow)),
  });
  summary.push({ table: "parcels", rows: await upsert(db, "parcels", parcels.map(toParcelRow)) });
  summary.push({
    table: "ai_employees",
    rows: await upsert(db, "ai_employees", employees.map(toEmployeeRow), "merchant_id"),
  });
  summary.push({
    table: "digital_rewards",
    rows: await upsert(db, "digital_rewards", rewards.map(toRewardRow)),
  });
  summary.push({
    table: "products",
    rows: await upsert(
      db,
      "products",
      products.map((p) => ({ ...toProductRow(p), event_id: null })),
    ),
  });
  summary.push({ table: "offers", rows: await upsert(db, "offers", offers.map(toOfferRow)) });
  summary.push({ table: "events", rows: await upsert(db, "events", events.map(toEventRow)) });
  summary.push({
    table: "products.event_id",
    rows: await upsert(db, "products", products.filter((p) => p.eventId).map(toProductRow)),
  });

  console.table(summary);
  console.log(`Done in ${Date.now() - started} ms.`);
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
