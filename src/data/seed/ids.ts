import { createHash } from "node:crypto";

/**
 * Deterministic UUID (v5-style, SHA-1) from a namespace + name.
 * Seed data uses this so static mode and the database agree on ids.
 * Node-only (server / scripts).
 */
export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash("sha1").update(`${namespace}:${name}`).digest("hex");
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "5";
  const v = parseInt(bytes[16] ?? "0", 16);
  bytes[16] = ((v & 0x3) | 0x8).toString(16);
  const h = bytes.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const sid = {
  district: (slug: string) => deterministicUuid("district", slug),
  parcel: (slug: string) => deterministicUuid("parcel", slug),
  merchant: (slug: string) => deterministicUuid("merchant", slug),
  employee: (merchantSlug: string) => deterministicUuid("employee", merchantSlug),
  product: (merchantSlug: string, slug: string) =>
    deterministicUuid("product", `${merchantSlug}/${slug}`),
  reward: (slug: string) => deterministicUuid("reward", slug),
  offer: (slug: string) => deterministicUuid("offer", slug),
  event: (slug: string) => deterministicUuid("event", slug),
};
