"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export interface ToastProps {
  message: string;
  action?: { label: string; onClick: () => void };
  onClose: () => void;
  /** Auto-dismiss delay; 0 keeps it until closed. */
  durationMs?: number;
}

/** A small sign-styled notice at the bottom of the screen. */
export function Toast({ message, action, onClose, durationMs = 6000 }: ToastProps) {
  useEffect(() => {
    if (!durationMs) return;
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onClose]);

  return (
    <div
      role="status"
      className="pointer-events-auto fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-sign border border-line bg-ink/95 py-2.5 pr-1.5 pl-4 text-[14px] text-fog shadow-sign backdrop-blur-md"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="font-display h-9 shrink-0 rounded-full bg-white/8 px-3 text-[13px] font-semibold tracking-tight hover:bg-white/14"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fog-2 hover:bg-white/8 hover:text-fog"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
