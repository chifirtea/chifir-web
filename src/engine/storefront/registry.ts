import type { StorefrontTemplateId } from "@/types/domain";
import type { StorefrontTemplateDef } from "./types";

/**
 * Storefront template registry. Templates register themselves here; the renderer, the
 * navigation resolver and the collider builder all resolve through this map.
 */
const REGISTRY: Partial<Record<StorefrontTemplateId, StorefrontTemplateDef>> = {};

export function registerStorefrontTemplate(def: StorefrontTemplateDef): void {
  REGISTRY[def.id] = def;
}

/** Falls back to "boutique" (the most generic template) when an id is unknown or unregistered. */
export function getStorefrontTemplate(id: StorefrontTemplateId): StorefrontTemplateDef {
  const def = REGISTRY[id] ?? REGISTRY.boutique;
  if (!def) {
    throw new Error(`No storefront templates registered (looking up "${id}"). Import "@/engine/storefront/templates" first.`);
  }
  return def;
}

export function listStorefrontTemplates(): StorefrontTemplateDef[] {
  return Object.values(REGISTRY).filter((d): d is StorefrontTemplateDef => Boolean(d));
}
