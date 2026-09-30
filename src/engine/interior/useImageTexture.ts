"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * Loads an external (untrusted) image URL as a texture with a branded fallback. Never throws and
 * never suspends: the fallback renders immediately and the real image swaps in when it arrives.
 * Loads are shared across every mesh that asks for the same URL.
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

/** Subscribes to a URL's texture; the callback fires once with the texture or null on failure. */
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
    if (typeof window === "undefined" || !/^https?:\/\//i.test(url)) {
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

/** The image as a texture once loaded; `fallback` until then and forever after a failure. */
export function useImageTexture(url: string | undefined, fallback: THREE.Texture): THREE.Texture {
  // State is keyed by the url it was loaded for, so a url change never shows a stale texture and
  // never needs a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture | null }>(() => ({
    url: url ?? "",
    texture: url ? (entries.get(url)?.texture ?? null) : null,
  }));

  useEffect(() => {
    if (!url) return;
    let active = true;
    const unsubscribe = loadImageTexture(url, (texture) => {
      if (active) setLoaded({ url, texture });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [url]);

  const current = url && loaded.url === url ? loaded.texture : url ? (entries.get(url)?.texture ?? null) : null;
  return current ?? fallback;
}
