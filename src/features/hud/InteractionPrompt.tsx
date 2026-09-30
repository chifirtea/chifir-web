"use client";

import { useEffect, useRef } from "react";
import { interactWithHotspot } from "@/city/cityActions";
import { useInputStore } from "@/engine/input/inputStore";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { useIsTouch } from "./useMediaQuery";

/**
 * Bottom-centre pill naming the nearest interactable ("Enter Ember & Oak") with the key that
 * triggers it. Executes the hotspot on tap, or when the engine reports an E press.
 */
export function InteractionPrompt() {
  const hotspot = useWorldStore((s) => s.activeHotspot);
  const locked = useWorldStore(selectInputLocked);
  const interactCount = useInputStore((s) => s.interactCount);
  const touch = useIsTouch();
  const seen = useRef(interactCount);

  useEffect(() => {
    if (interactCount === seen.current) return;
    seen.current = interactCount;
    if (!hotspot || locked) return;
    interactWithHotspot(hotspot);
  }, [interactCount, hotspot, locked]);

  if (!hotspot || locked) return null;

  return (
    <button
      type="button"
      onClick={() => interactWithHotspot(hotspot)}
      className="pointer-events-auto flex h-12 min-w-[44px] items-center gap-3 rounded-full border border-line bg-ink/92 pr-2 pl-4 text-fog shadow-sign backdrop-blur-md transition-transform active:scale-[0.98]"
    >
      <span className="font-display max-w-[60vw] truncate text-[15px] font-semibold tracking-tight">{hotspot.label}</span>
      <kbd className="font-display flex h-8 min-w-8 items-center justify-center rounded-md border border-line bg-white/8 px-2 text-[12px] font-semibold tracking-wide text-sodium shadow-[inset_0_-2px_0_rgba(0,0,0,0.4)]">
        {touch ? "Tap" : "E"}
      </kbd>
    </button>
  );
}
