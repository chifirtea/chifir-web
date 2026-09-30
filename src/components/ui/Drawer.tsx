"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  side?: "right" | "left" | "bottom";
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Keep the world visible behind the drawer (no dark scrim). */
  transparentScrim?: boolean;
}

/**
 * Slide-in panel styled as a physical sign. Right/left on desktop; bottom sheet on phones when
 * side="bottom". Escape closes. Clicking the scrim closes.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  side = "right",
  width = "min(440px, 100vw)",
  children,
  footer,
  transparentScrim = false,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isBottom = side === "bottom";
  return (
    <div
      className={cn("fixed inset-0 z-40 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")}
      aria-hidden={!open}
    >
      <div
        className={cn("absolute inset-0", transparentScrim ? "bg-transparent" : "bg-night/55")}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        className={cn(
          "sign absolute flex flex-col overflow-hidden transition-transform duration-250 ease-out",
          isBottom
            ? "inset-x-2 bottom-2 max-h-[86dvh] rounded-t-2xl"
            : side === "right"
              ? "top-3 right-3 bottom-3"
              : "top-3 left-3 bottom-3",
          open ? "translate-x-0 translate-y-0" : isBottom ? "translate-y-full" : side === "right" ? "translate-x-[calc(100%+24px)]" : "-translate-x-[calc(100%+24px)]",
        )}
        style={isBottom ? undefined : { width }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
            {title ? <h2 className="font-display truncate text-lg font-semibold tracking-tight">{title}</h2> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fog-2 hover:bg-white/5 hover:text-fog"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <footer className="border-t border-line px-5 py-4">{footer}</footer> : null}
      </section>
    </div>
  );
}
