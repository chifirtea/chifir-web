"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useWorldStore } from "@/engine/store/worldStore";
import { useIsTouch } from "./useMediaQuery";

const KEY = "chifir.hint.v1";
const AUTO_DISMISS_MS = 8000;

/** First-visit controls hint. Shows once the city is ready, goes away on its own after 8 s. */
export function ControlsHint() {
  const ready = useWorldStore((s) => s.ready);
  const touch = useIsTouch();
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Private mode: the hint simply shows again next time.
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      // ignore
    }
    setVisible(true);
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [ready, dismiss]);

  if (!visible) return null;

  return (
    <div className="pointer-events-auto flex h-11 max-w-[calc(100vw-32px)] items-center gap-2 rounded-full border border-line bg-ink/92 pr-1 pl-4 text-[13px] text-fog-2 shadow-sign backdrop-blur-md">
      {touch ? (
        <span className="truncate">
          <b className="font-semibold text-fog">Left:</b> move · <b className="font-semibold text-fog">Right:</b> look · Tap
          prompts to interact
        </span>
      ) : (
        <span className="truncate">
          <Key>WASD</Key> to walk · drag to look · <Key>E</Key> to interact
        </span>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss hint"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/8 hover:text-fog"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="font-display mx-0.5 rounded border border-line bg-white/8 px-1.5 py-0.5 text-[11px] font-semibold text-fog">
      {children}
    </kbd>
  );
}
