"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { getCityIndex } from "@/city/cityStore";
import { useWorldStore } from "@/engine/store/worldStore";

const OUT_MS = 260;
const IN_MS = 360;
/** If the fade-out has not committed by now (throttled tab, lost rAF), force it through. */
const WATCHDOG_MS = 1500;

const style: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "var(--color-night)",
  pointerEvents: "none",
  opacity: 0,
  willChange: "opacity",
};

const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const markStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "0 24px",
  fontFamily: "var(--font-display, inherit)",
  letterSpacing: "-0.02em",
  opacity: 0,
  transition: "opacity 160ms ease-out",
};

/** The brand the pending transition walks into, if it is a room: its colours dress the fade. */
function pendingBrand(): { color: string; name: string; onColor: string } | null {
  const pending = useWorldStore.getState().pending;
  const index = getCityIndex();
  if (!pending?.location || pending.location.kind !== "interior" || !index) return null;
  const merchant = index.merchantsById[pending.location.merchantId];
  if (!merchant) return null;
  return { color: merchant.brand.primary, name: merchant.name, onColor: merchant.brand.onPrimary };
}

/**
 * Full-screen fade that drives the world store's transition state machine: fade to black,
 * commit (move the player / switch location), fade back in. Opacity is written straight to the
 * DOM; nothing re-renders per frame.
 */
export function Fade() {
  const ref = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const opacity = useRef(0);
  const transitionId = useWorldStore((s) => s.transitionId);

  // A stale "in" from a previous mount would keep input locked forever.
  useEffect(() => {
    const world = useWorldStore.getState();
    if (world.transition === "in") world.endTransition();
    return () => useWorldStore.getState().resetTransition();
  }, []);

  useEffect(() => {
    // Keyed on the id only: `beginTransition` always bumps it, and depending on the phase too
    // would cancel our own fade-in when we flip the phase to "in".
    if (useWorldStore.getState().transition !== "out") return;
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let finished = false;
    // Walking into a store fades through the brand colour with its name; everything else is night.
    const brand = pendingBrand();
    el.style.background = brand ? brand.color : "var(--color-night)";
    const m = mark.current;
    if (m) {
      m.textContent = brand ? brand.name : "";
      m.style.color = brand ? brand.onColor : "transparent";
      m.style.opacity = "0";
    }
    const setOpacity = (o: number) => {
      opacity.current = o;
      el.style.opacity = String(o);
      if (m) m.style.opacity = brand && o > 0.6 ? String(Math.min(1, (o - 0.6) / 0.4)) : "0";
    };
    const commit = () => {
      const pending = useWorldStore.getState().commitTransition();
      pending?.onCommit?.();
    };
    const finish = () => {
      finished = true;
      useWorldStore.getState().endTransition();
    };

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // One black frame still hides the pop.
      setOpacity(1);
      commit();
      raf = requestAnimationFrame(() => {
        setOpacity(0);
        finish();
      });
    } else {
      // A transition requested mid fade-in starts from the current opacity, so it reverses
      // rather than jumping to clear and fading again.
      const from = opacity.current;
      const outMs = OUT_MS * (1 - from);
      let t0 = 0;
      let t1 = 0;

      const fadeIn = (now: number) => {
        const t = Math.min(1, (now - t1) / IN_MS);
        setOpacity(1 - easeOut(t));
        if (t < 1) raf = requestAnimationFrame(fadeIn);
        else finish();
      };
      const startIn = (now: number) => {
        t1 = now;
        raf = requestAnimationFrame(fadeIn);
      };
      const fadeOut = (now: number) => {
        if (t0 === 0) t0 = now;
        const t = outMs <= 0 ? 1 : Math.min(1, (now - t0) / outMs);
        setOpacity(from + (1 - from) * easeIn(t));
        if (t < 1) {
          raf = requestAnimationFrame(fadeOut);
        } else {
          commit();
          // Give the scene one frame at full black to mount the new location before revealing.
          raf = requestAnimationFrame(startIn);
        }
      };
      raf = requestAnimationFrame(fadeOut);
    }

    const watchdog = setTimeout(() => {
      if (finished) return;
      cancelAnimationFrame(raf);
      if (useWorldStore.getState().transition === "out") commit();
      setOpacity(0);
      finish();
    }, WATCHDOG_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(watchdog);
    };
  }, [transitionId]);

  return (
    <div ref={ref} style={style} aria-hidden="true">
      <div ref={mark} style={markStyle} className="text-3xl font-semibold" />
    </div>
  );
}
