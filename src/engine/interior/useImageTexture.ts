"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { isTextureUrl, resolveImage, textureImageWidth } from "@/lib/media/images";

/**
 * Loads an external (untrusted) image URL as a texture with a branded fallback. Never throws and
 * never suspends: the fallback renders immediately and the real image swaps in when it arrives.
 * URLs go through the image pipeline (`resolveImage`) so a CDN prefix or optimizer applies to
 * textures exactly as it does to `<img>`; the requested width follows the quality tier. Loads are
 * shared across every mesh that asks for the same resolved URL.
 */

type Listener = (texture: THREE.Texture | null) => void;

interface Entry {
  status: "loading" | "ready" | "error";
  texture: THREE.Texture | null;
  listeners: Set<Listener>;
}

const entries = new Map<string, Entry>();
let loader: THREE.TextureLoader | null = null;

function getLoader(): THREE.TextureLoader {
  if (!loader) {
    loader = new THREE.TextureLoader();
    // Merchant imagery lives on other origins; without CORS headers the browser taints the
    // canvas and WebGL refuses the upload, so the host must allow it (docs/MEDIA.md).
    loader.setCrossOrigin("anonymous");
  }
  return loader;
}

function prepare(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Subscribes to a resolved URL's texture; the callback fires once with the texture or null on failure. */
export function loadImageTexture(url: string, listener: Listener): () => void {
  let entry = entries.get(url);
  if (entry && entry.status !== "loading") {
    listener(entry.texture);
    return () => undefined;
  }
  if (!entry) {
    entry = { status: "loading", texture: null, listeners: new Set() };
    entries.set(url, entry);
    const current = entry;
    const settle = (texture: THREE.Texture | null) => {
      current.status = texture ? "ready" : "error";
      current.texture = texture;
      for (const l of current.listeners) l(texture);
      current.listeners.clear();
    };
    if (typeof window === "undefined" || !isTextureUrl(url)) {
      settle(null);
    } else {
      try {
        getLoader().load(
          url,
          (texture) => settle(prepare(texture)),
          undefined,
          () => settle(null),
        );
      } catch {
        settle(null);
      }
    }
  }
  entry.listeners.add(listener);
  const e = entry;
  return () => {
    e.listeners.delete(listener);
  };
}

/** The URL a texture will actually be fetched from for the current quality tier ("" when none). */
export function textureUrlFor(url: string | undefined, maxTextureSize: number): string {
  if (!url) return "";
  return resolveImage(url, { width: textureImageWidth(maxTextureSize), quality: 80 });
}

/** The image as a texture once loaded; `fallback` until then and forever after a failure. */
export function useImageTexture(url: string | undefined, fallback: THREE.Texture): THREE.Texture {
  const maxTex = useQualityStore((s) => s.settings.maxTextureSize);
  const resolved = textureUrlFor(url, maxTex);
  // State is keyed by the url it was loaded for, so a url change never shows a stale texture and
  // never needs a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture | null }>(() => ({
    url: resolved,
    texture: resolved ? (entries.get(resolved)?.texture ?? null) : null,
  }));

  useEffect(() => {
    if (!resolved) return;
    let active = true;
    const unsubscribe = loadImageTexture(resolved, (texture) => {
      if (active) setLoaded({ url: resolved, texture });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [resolved]);

  const current = resolved && loaded.url === resolved ? loaded.texture : resolved ? (entries.get(resolved)?.texture ?? null) : null;
  return current ?? fallback;
}
