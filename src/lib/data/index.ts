import "server-only";
import { features } from "@/lib/env.server";
import { StaticDataSource } from "./static";
import { SupabaseDataSource } from "./supabase";
import type { DataSource } from "./types";

export type { DataSource } from "./types";

let instance: DataSource | null = null;

/**
 * Process-wide DataSource. Supabase when fully configured, otherwise the in-memory static source
 * over the seed data (see ADR-002).
 */
export function getDataSource(): DataSource {
  if (!instance) {
    instance = features.supabase ? new SupabaseDataSource() : new StaticDataSource();
  }
  return instance;
}
