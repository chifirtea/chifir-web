import type { InteriorTemplateId } from "@/types/domain";
import type { InteriorTemplateDef } from "./types";

const REGISTRY: Partial<Record<InteriorTemplateId, InteriorTemplateDef>> = {};

export function registerInteriorTemplate(def: InteriorTemplateDef): void {
  REGISTRY[def.id] = def;
}

/** Falls back to "retail-racks" when an id is unknown or unregistered. */
export function getInteriorTemplate(id: InteriorTemplateId): InteriorTemplateDef {
  const def = REGISTRY[id] ?? REGISTRY["retail-racks"];
  if (!def) {
    throw new Error(`No interior templates registered (looking up "${id}"). Import "@/engine/interior/templates" first.`);
  }
  return def;
}

export function listInteriorTemplates(): InteriorTemplateDef[] {
  return Object.values(REGISTRY).filter((d): d is InteriorTemplateDef => Boolean(d));
}
