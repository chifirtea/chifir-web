import "server-only";
import { features } from "@/lib/env.server";
import { StaticDataSource } from "./static";
import { SupabaseDataSource } from "./supabase";
import type { DataSource } from "./types";

export type { DataSource } from "./types";

/**
 * Process-wide DataSource. Supabase when fully configured, otherwise the in-memory static source
 * over the seed data (see ADR-002). Held on `globalThis` because `next dev` may evaluate this
 * module once per route bundle, and the static source keeps demo orders in memory.
 */
const KEY = "__chifir_data_source__";
type Holder = { [KEY]?: DataSource };

export function getDataSource(): DataSource {
  const holder = globalThis as unknown as Holder;
  if (!holder[KEY]) {
    holder[KEY] = features.supabase ? new SupabaseDataSource() : new StaticDataSource();
  }
  return holder[KEY];
}
