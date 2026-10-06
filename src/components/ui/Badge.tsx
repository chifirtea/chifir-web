import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "signal" | "mint" | "sodium" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-white/6 text-fog-2 border-line",
    signal: "bg-signal/12 text-signal border-signal/30",
    mint: "bg-mint/12 text-mint border-mint/30",
    sodium: "bg-sodium/12 text-sodium border-sodium/30",
    danger: "bg-danger/12 text-danger border-danger/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
