"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DistrictTheme } from "@/types/domain";

/**
 * Sets the scene background and fog for as long as the calling component is mounted, restoring
 * the previous values on unmount. (R3F's `attach` targets the parent object, so a scene inside a
 * group cannot use `<color attach="background" />`.)
 */
export function useSceneAtmosphere(background: string, fog: { color: string; near: number; far: number } | null): void {
  const scene = useThree((s) => s.scene);
  const fogColor = fog?.color ?? null;
  const fogNear = fog?.near ?? 0;
  const fogFar = fog?.far ?? 0;
  useEffect(() => {
    const prevBackground = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color(background);
    scene.fog = fogColor ? new THREE.Fog(fogColor, fogNear, fogFar) : null;
    return () => {
      scene.background = prevBackground;
      scene.fog = prevFog;
    };
  }, [scene, background, fogColor, fogNear, fogFar]);
}

/**
 * Mood per district ambience: the fog colour the street dissolves into and a light tint for the
 * hemisphere fill. The Sky lerps between these as the player crosses a district boundary.
 */
export interface Ambience {
  fog: string;
  /** Hemisphere sky colour. */
  sky: string;
  /** Hemisphere ground bounce. */
  ground: string;
  fogNear: number;
  fogFar: number;
}

export const AMBIENCE: Record<DistrictTheme["ambience"], Ambience> = {
  warm: { fog: "#241a22", sky: "#6f7fb8", ground: "#5a3f2a", fogNear: 70, fogFar: 330 },
  cool: { fog: "#171c2a", sky: "#7b8fcf", ground: "#3e3a44", fogNear: 70, fogFar: 320 },
  neon: { fog: "#24172b", sky: "#8a7bc8", ground: "#4a2f3a", fogNear: 65, fogFar: 300 },
  daylight: { fog: "#5a6478", sky: "#b9c8e8", ground: "#6b6052", fogNear: 120, fogFar: 420 },
};

let envMap: THREE.CubeTexture | null = null;

/**
 * A 6 × 16 px dusk cube map: warm city glow at the horizon, deep blue overhead, dark ground.
 * Used as a material-level `envMap` so wet asphalt and the fountain pick up a believable sheen
 * without a real environment capture. Built once, never uploaded until a material uses it.
 */
export function getDuskEnvMap(): THREE.CubeTexture | null {
  if (envMap) return envMap;
  if (typeof document === "undefined") return null;
  const size = 16;
  const face = (draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx);
    return canvas;
  };
  const side = face((ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "#1a1e38");
    g.addColorStop(0.55, "#3a2a44");
    g.addColorStop(0.68, "#6a3c4a");
    g.addColorStop(0.75, "#2a1c22");
    g.addColorStop(1, "#0a0a0e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  const top = face((ctx) => {
    ctx.fillStyle = "#0f1226";
    ctx.fillRect(0, 0, size, size);
  });
  const bottom = face((ctx) => {
    ctx.fillStyle = "#0a0a0e";
    ctx.fillRect(0, 0, size, size);
  });
  envMap = new THREE.CubeTexture([side, side, top, bottom, side, side]);
  envMap.colorSpace = THREE.SRGBColorSpace;
  envMap.needsUpdate = true;
  return envMap;
}
