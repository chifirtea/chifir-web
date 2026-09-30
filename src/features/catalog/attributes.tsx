"use client";

import { Flame } from "lucide-react";
import type { DietaryTag, InventoryStatus, Product } from "@/types/domain";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/** Shared chips for product attributes (panel, lists, AI cards). */

export const DIETARY_LABEL: Record<DietaryTag, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  nut_free: "Nut-free",
  halal: "Halal",
  kosher: "Kosher",
};

const SPICE_NAME = ["No heat", "Mild", "Medium", "Hot", "Extreme"] as const;

/** "food.smokehouse" -> "Smokehouse", "date-night" -> "Date night". */
export function humanize(slug: string): string {
  const last = slug.split(".").pop() ?? slug;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export function SpiceFlames({
  level,
  showLabel = false,
  className,
}: {
  level: number;
  showLabel?: boolean;
  className?: string;
}) {
  if (level <= 0) return null;
  const n = Math.min(4, Math.max(1, Math.round(level)));
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-signal", className)}
      role="img"
      aria-label={`Spice level ${n} of 4, ${SPICE_NAME[n]?.toLowerCase()}`}
    >
      {Array.from({ length: n }, (_, i) => (
        <Flame key={i} className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      ))}
      {showLabel ? <span className="ml-1 text-xs font-medium">{SPICE_NAME[n]}</span> : null}
    </span>
  );
}

export function DietaryChips({
  tags,
  compact = false,
}: {
  tags: DietaryTag[] | undefined;
  compact?: boolean;
}) {
  if (!tags?.length) return null;
  const shown = compact ? tags.slice(0, 2) : tags;
  return (
    <>
      {shown.map((t) => (
        <Badge key={t} tone="mint">
          {DIETARY_LABEL[t]}
        </Badge>
      ))}
      {compact && tags.length > shown.length ? (
        <Badge tone="neutral">+{tags.length - shown.length}</Badge>
      ) : null}
    </>
  );
}

/** Real inventory state only; never invented scarcity. */
export function inventoryNote(
  status: InventoryStatus,
  count?: number,
): { text: string; tone: "sodium" | "danger" | "neutral" } | null {
  switch (status) {
    case "out_of_stock":
      return { text: "Sold out", tone: "danger" };
    case "low_stock":
      return { text: count !== undefined ? `Only ${count} left` : "Low stock", tone: "sodium" };
    case "preorder":
      return { text: "Preorder", tone: "neutral" };
    case "in_stock":
      return null;
  }
}

export function leadTimeLabel(p: Product): string | null {
  const lt = p.leadTime;
  if (lt.daysMin !== undefined || lt.daysMax !== undefined) {
    const a = lt.daysMin ?? lt.daysMax;
    const b = lt.daysMax ?? lt.daysMin;
    return a === b ? `${a} days` : `${a}–${b} days`;
  }
  return null;
}
