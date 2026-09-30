"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

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
