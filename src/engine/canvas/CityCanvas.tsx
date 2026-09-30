"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, useFrame, type RootState } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from "three";
import { setAnalyticsDevice } from "@/lib/analytics/client";
import { useWorldStore } from "@/engine/store/worldStore";
import { detectInitialQuality, type DetectedQuality } from "./detectQuality";
import { higherTier, lowerTier, QUALITY_TIERS, type QualityTier } from "./quality";
import { setQualityTier, useQuality, useQualityStore } from "./qualityStore";

const canvasStyle: CSSProperties = { position: "absolute", inset: 0, touchAction: "none" };

const CAMERA = { fov: 50, near: 0.1, far: 350, position: [0, 3, -6] as [number, number, number] };

const rank = (tier: QualityTier) => QUALITY_TIERS.indexOf(tier);

function onCreated({ gl }: RootState) {
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  gl.outputColorSpace = SRGBColorSpace;
  gl.shadowMap.type = PCFSoftShadowMap;
}

/** Flags the world ready once the first frame is on screen; never leaves a transition stuck. */
function ReadySignal() {
  const frames = useRef(0);

  useEffect(() => {
    useWorldStore.getState().resetTransition();
    return () => {
      const world = useWorldStore.getState();
      world.resetTransition();
      world.setReady(false);
    };
  }, []);

  // useFrame runs before the render of its frame, so the second call is the first moment the
  // first frame has actually been presented.
  useFrame(() => {
    if (frames.current > 1) return;
    frames.current += 1;
    if (frames.current === 2) useWorldStore.getState().setReady(true);
  });

  return null;
}

/**
 * The one R3F canvas. Detects the device on the first client render, configures the quality
 * store and the analytics device context, then hosts the scene. Context-creation attributes
 * come from the detected tier; everything else follows `useQuality()` and can step down at
 * runtime through drei's PerformanceMonitor.
 */
export function CityCanvas({ children }: { children: ReactNode }) {
  const [detected, setDetected] = useState<DetectedQuality | null>(null);
  const settings = useQuality();

  // Layout effect (not a render-phase side effect): the quality store may already have HUD
  // subscribers, and React forbids updating them from another component's render.
  useLayoutEffect(() => {
    const d = detectInitialQuality();
    useQualityStore.getState().configure(d.tier, d.mobile);
    setAnalyticsDevice(d.gpu ? { mobile: d.mobile, tier: d.tier, gpu: d.gpu } : { mobile: d.mobile, tier: d.tier });
    setDetected(d);
  }, []);

  const handleDecline = useCallback(() => {
    setQualityTier(lowerTier(useQualityStore.getState().settings.tier));
  }, []);

  const handleIncline = useCallback(() => {
    if (!detected) return;
    const next = higherTier(useQualityStore.getState().settings.tier);
    // Never climb above what the device was judged capable of at start.
    if (rank(next) <= rank(detected.tier)) setQualityTier(next);
  }, [detected]);

  if (!detected) return null;

  const gl = {
    antialias: !(detected.mobile && detected.tier === "low"),
    powerPreference: "high-performance" as const,
    alpha: false,
    stencil: false,
  };

  return (
    <Canvas
      dpr={settings.dpr}
      shadows={settings.shadows ? "soft" : false}
      gl={gl}
      camera={CAMERA}
      frameloop="always"
      style={canvasStyle}
      onCreated={onCreated}
    >
      <Suspense fallback={null}>
        <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline} />
        {children}
        <Preload all />
      </Suspense>
      <ReadySignal />
    </Canvas>
  );
}
