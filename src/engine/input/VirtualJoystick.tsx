"use client";

import { Footprints } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { useInputStore } from "./inputStore";

/** Knob travel in px. */
const RADIUS = 56;
/** Ignore jitter around the touch origin. */
const DEAD_ZONE = 8;
/** Knob pushed this far out (0..1) toggles running for the duration of the push. */
const RUN_THRESHOLD = 0.9;
const BASE_SIZE = RADIUS * 2;
const KNOB_SIZE = 48;

const NO_POINTER = -1;

// Decided once: a tablet that gains a mouse mid-session should keep its touch controls.
const noop = () => () => {};
const readCoarsePointer = () =>
  (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) ||
  navigator.maxTouchPoints > 0;
const serverSnapshot = () => false;

function useCoarsePointer(): boolean {
  return useSyncExternalStore(noop, readCoarsePointer, serverSnapshot);
}

interface StickState {
  id: number;
  originX: number;
  originY: number;
  /** Knob beyond RUN_THRESHOLD. */
  out: boolean;
}

interface LookState {
  id: number;
  lastX: number;
  lastY: number;
}

const layerStyle = (locked: boolean): CSSProperties => ({
  position: "fixed",
  inset: 0,
  zIndex: 10,
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTapHighlightColor: "transparent",
  pointerEvents: locked ? "none" : "auto",
});

const baseStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: BASE_SIZE,
  height: BASE_SIZE,
  marginLeft: -BASE_SIZE / 2,
  marginTop: -BASE_SIZE / 2,
  borderRadius: "50%",
  border: "2px solid var(--color-fog-3)",
  background: "rgba(233, 230, 223, 0.06)",
  boxShadow: "inset 0 0 0 1px rgba(15, 17, 22, 0.35)",
  opacity: 0,
  transition: "opacity 120ms ease-out",
  pointerEvents: "none",
  willChange: "transform, opacity",
};

const knobStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: KNOB_SIZE,
  height: KNOB_SIZE,
  marginLeft: -KNOB_SIZE / 2,
  marginTop: -KNOB_SIZE / 2,
  borderRadius: "50%",
  background: "var(--color-sodium)",
  boxShadow: "0 4px 18px rgba(255, 196, 107, 0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
  willChange: "transform",
};

const runButtonStyle = (latched: boolean): CSSProperties => ({
  position: "absolute",
  right: 16,
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)",
  width: 44,
  height: 44,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1.5px solid ${latched ? "var(--color-sodium)" : "var(--color-fog-3)"}`,
  background: latched ? "var(--color-sodium)" : "rgba(15, 17, 22, 0.6)",
  color: latched ? "var(--color-night)" : "var(--color-fog)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  touchAction: "manipulation",
  cursor: "pointer",
});

/**
 * Touch controls: a floating joystick spawns wherever a finger lands in the left half, the right
 * half is drag-to-look. One finger per side works simultaneously (pointer ids are tracked
 * separately). Renders nothing on devices without a coarse pointer.
 *
 * Sits at z-index 10 under the HUD (which must use z-index 20+) and switches to
 * `pointer-events: none` while an overlay owns input, so panels and buttons always win.
 */
export function VirtualJoystick() {
  const touch = useCoarsePointer();
  const [runLatched, setRunLatched] = useState(false);
  const locked = useWorldStore(selectInputLocked);

  const layerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stick = useRef<StickState>({ id: NO_POINTER, originX: 0, originY: 0, out: false });
  const look = useRef<LookState>({ id: NO_POINTER, lastX: 0, lastY: 0 });
  const latchedRef = useRef(false);

  useEffect(() => {
    useInputStore.getState().setTouch(touch);
  }, [touch]);

  const syncRun = useCallback(() => {
    useInputStore.getState().setRun(latchedRef.current || stick.current.out);
  }, []);

  const releaseStick = useCallback(() => {
    stick.current.id = NO_POINTER;
    stick.current.out = false;
    useInputStore.getState().setMove(0, 0);
    syncRun();
    const base = baseRef.current;
    const knob = knobRef.current;
    if (base) base.style.opacity = "0";
    if (knob) knob.style.transform = "translate(0px, 0px)";
  }, [syncRun]);

  const releaseLook = useCallback(() => {
    look.current.id = NO_POINTER;
  }, []);

  // Dropping input the moment a panel opens avoids a player who keeps walking under a drawer.
  useEffect(() => {
    if (!locked) return;
    releaseStick();
    releaseLook();
  }, [locked, releaseStick, releaseLook]);

  // The latch is read from pointer handlers, so mirror it into a ref and re-derive `run`.
  useEffect(() => {
    latchedRef.current = runLatched;
    syncRun();
  }, [runLatched, syncRun]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return;
    // A mouse on a touch laptop should still just look around.
    const leftHalf = e.pointerType !== "mouse" && e.clientX < window.innerWidth / 2;
    if (leftHalf && stick.current.id === NO_POINTER) {
      stick.current.id = e.pointerId;
      stick.current.originX = e.clientX;
      stick.current.originY = e.clientY;
      stick.current.out = false;
      const base = baseRef.current;
      if (base) {
        base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        base.style.opacity = "1";
      }
    } else if (look.current.id === NO_POINTER) {
      look.current.id = e.pointerId;
      look.current.lastX = e.clientX;
      look.current.lastY = e.clientY;
    } else {
      return;
    }
    layerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (e.pointerId === s.id) {
      let dx = e.clientX - s.originX;
      let dy = e.clientY - s.originY;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx *= RADIUS / len;
        dy *= RADIUS / len;
      }
      const knob = knobRef.current;
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;

      // Dead zone, then rescale so the first usable input starts at 0 rather than jumping.
      const clamped = Math.min(len, RADIUS);
      const mag = clamped <= DEAD_ZONE ? 0 : (clamped - DEAD_ZONE) / (RADIUS - DEAD_ZONE);
      const nx = len > 0 ? dx / Math.min(len, RADIUS) : 0;
      const ny = len > 0 ? dy / Math.min(len, RADIUS) : 0;
      // Screen up (negative dy) is forward.
      useInputStore.getState().setMove(nx * mag, -ny * mag);
      const out = mag > RUN_THRESHOLD;
      if (out !== s.out) {
        s.out = out;
        syncRun();
      }
      return;
    }
    const l = look.current;
    if (e.pointerId === l.id) {
      useInputStore.getState().addLook(e.clientX - l.lastX, e.clientY - l.lastY);
      l.lastX = e.clientX;
      l.lastY = e.clientY;
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === stick.current.id) releaseStick();
    else if (e.pointerId === look.current.id) releaseLook();
  };

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!locked) useInputStore.getState().addZoom(e.deltaY);
  };

  if (!touch) return null;

  return (
    <div
      ref={layerRef}
      style={layerStyle(locked)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
      aria-hidden="true"
    >
      <div ref={baseRef} style={baseStyle}>
        <div ref={knobRef} style={knobStyle} />
      </div>
      <button
        type="button"
        aria-label="Toggle run"
        aria-pressed={runLatched}
        style={runButtonStyle(runLatched)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setRunLatched((v) => !v)}
      >
        <Footprints size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
