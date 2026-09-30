"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useWorldStore } from "@/engine/store/worldStore";

/**
 * Floating "Ask the city" button that opens the concierge. Positioned bottom-right by default;
 * pass `className` to place it inside a HUD layout instead.
 */
export function ConciergeButton({ className }: { className?: string }) {
  const open = useWorldStore((s) => s.conciergeOpen);
  const setConciergeOpen = useWorldStore((s) => s.setConciergeOpen);
  return (
    <button
      data-testid="concierge-button"
      type="button"
      onClick={() => setConciergeOpen(true)}
      aria-label="Ask the city"
      aria-expanded={open}
      className={cn(
        "group font-display relative inline-flex h-12 min-w-11 select-none items-center gap-2 rounded-full border border-sodium/30 bg-ink-2/90 pr-4 pl-3 text-[15px] font-semibold tracking-tight text-fog shadow-sign backdrop-blur transition-[transform,background-color] duration-150 hover:bg-[#2c313c] active:scale-[0.98]",
        className ?? "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30",
      )}
    >
      <span
        className="pointer-events-none absolute -inset-px rounded-full opacity-70 transition-opacity group-hover:opacity-100"
        style={{ boxShadow: "0 0 0 1px rgba(255,196,107,0.25), 0 0 28px rgba(255,196,107,0.22)" }}
        aria-hidden="true"
      />
      <Sparkles className="h-5 w-5 text-sodium" aria-hidden="true" />
      <span>Ask the city</span>
    </button>
  );
}
