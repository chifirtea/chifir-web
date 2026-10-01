"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MAX_LINE_QUANTITY } from "./cartStore";

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  /** Minimum allowed. With `min={0}` the decrement at 1 becomes a remove (trash icon). */
  min?: number;
  max?: number;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** 44px-target stepper. Plain buttons, no input to fat-finger on phones. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = MAX_LINE_QUANTITY,
  label = "Quantity",
  size = "md",
  className,
}: QuantityStepperProps) {
  const dim = size === "sm" ? "h-10 w-10" : "h-11 w-11";
  const willRemove = min === 0 && value <= 1;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center rounded-xl border border-line bg-ink-2", className)}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={willRemove ? "Remove" : "Decrease quantity"}
        className={cn(
          dim,
          "flex items-center justify-center rounded-l-xl text-fog-2 transition-colors hover:bg-white/6 hover:text-fog disabled:opacity-40",
        )}
      >
        {willRemove ? (
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Minus className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <output aria-live="polite" className="tabular min-w-8 text-center text-[15px] font-semibold">
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase quantity"
        className={cn(
          dim,
          "flex items-center justify-center rounded-r-xl text-fog-2 transition-colors hover:bg-white/6 hover:text-fog disabled:opacity-40",
        )}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
