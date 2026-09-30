import * as THREE from "three";
import type { BrandPalette, StorefrontConfig } from "@/types/domain";
import { mulberry32, hashString } from "@/engine/environment/prng";
import { mixHex } from "./signage";

/**
 * Façade materials per `storefrontConfig.facade`, tinted by the brand palette and cached by key
 * so every building with the same look shares one material and one small procedural texture.
 */
export type Facade = StorefrontConfig["facade"];

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const textureCache = new Map<string, THREE.CanvasTexture>();

function patternTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture | null {
  const cached = textureCache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

function noise(ctx: CanvasRenderingContext2D, size: number, seed: number, density: number, alpha: number): void {
  const rand = mulberry32(seed);
  const n = Math.floor(size * size * density);
  for (let i = 0; i < n; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
}

function brickTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`brick|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(hashString(base));
    const cols = 22;
    const rows = 26;
    const bw = s / cols;
    const bh = s / rows;
    ctx.fillStyle = mixHex(base, "#2a211c", 0.65); // mortar
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : bw / 2;
      for (let c = -1; c <= cols; c++) {
        const shade = (rand() - 0.5) * 0.22;
        ctx.fillStyle = mixHex(base, shade > 0 ? "#ffffff" : "#000000", Math.abs(shade));
        ctx.fillRect(c * bw + offset + 1, r * bh + 1, bw - 2, bh - 2);
      }
    }
    noise(ctx, s, 7, 0.05, 0.06);
  });
}

function plasterTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`plaster|${base}|${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 11, 0.12, 0.045);
    // A few faint trowel sweeps.
    const rand = mulberry32(13);
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = s * 0.03;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(rand() * s, rand() * s);
      ctx.quadraticCurveTo(rand() * s, rand() * s, rand() * s, rand() * s);
      ctx.stroke();
    }
  });
}

function concreteTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`concrete|${base}|${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 17, 0.2, 0.05);
    // Formwork panel seams.
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((s / 4) * i, 0);
      ctx.lineTo((s / 4) * i, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (s / 3) * i);
      ctx.lineTo(s, (s / 3) * i);
      ctx.stroke();
    }
    // Tie holes.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc((s / 4) * i + s / 8, (s / 3) * j + s / 6, s * 0.006, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function woodTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`wood|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(23);
    const slats = 18;
    const w = s / slats;
    for (let i = 0; i < slats; i++) {
      const tone = (rand() - 0.5) * 0.3;
      ctx.fillStyle = mixHex(base, tone > 0 ? "#ffffff" : "#000000", Math.abs(tone));
      ctx.fillRect(i * w, 0, w, s);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(i * w, 0, 2, s);
      // Grain lines.
      ctx.strokeStyle = "rgba(0,0,0,0.10)";
      ctx.lineWidth = 1;
      for (let g = 0; g < 4; g++) {
        const x = i * w + 3 + rand() * (w - 6);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (rand() - 0.5) * 6, s * 0.33, x + (rand() - 0.5) * 6, s * 0.66, x + (rand() - 0.5) * 4, s);
        ctx.stroke();
      }
    }
  });
}

function tileTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`tile|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(29);
    const n = 16;
    const t = s / n;
    ctx.fillStyle = mixHex(base, "#000000", 0.55); // grout
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = (rand() - 0.5) * 0.16;
        ctx.fillStyle = mixHex(base, tone > 0 ? "#ffffff" : "#000000", Math.abs(tone));
        ctx.fillRect(c * t + 1.5, r * t + 1.5, t - 3, t - 3);
        // Glaze highlight.
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(c * t + 2, r * t + 2, t - 4, (t - 4) * 0.3);
      }
    }
  });
}

/** Tinted, cached façade material. Texture size is capped by the quality tier. */
export function getFacadeMaterial(facade: Facade, brand: BrandPalette, maxTextureSize: number): THREE.MeshStandardMaterial {
  const size = Math.min(512, maxTextureSize);
  const key = `${facade}|${brand.primary}|${brand.secondary}|${size}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  let material: THREE.MeshStandardMaterial;
  switch (facade) {
    case "brick": {
      const base = mixHex("#8a4a38", brand.secondary, 0.18);
      material = new THREE.MeshStandardMaterial({ color: "#d9c9c0", map: brickTexture(base, size), roughness: 0.92, metalness: 0 });
      if (!material.map) material.color.set(base);
      break;
    }
    case "plaster": {
      const base = mixHex(brand.primary, "#d8cec1", 0.5);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: plasterTexture(base, size), roughness: 0.95, metalness: 0 });
      if (!material.map) material.color.set(base);
      break;
    }
    case "glass":
      material = new THREE.MeshStandardMaterial({
        color: "#0c1622",
        roughness: 0.18,
        metalness: 0.75,
        emissive: new THREE.Color("#3b2a16"),
        emissiveIntensity: 0.45,
      });
      break;
    case "concrete": {
      const base = mixHex("#8d9096", brand.primary, 0.12);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: concreteTexture(base, size), roughness: 0.88, metalness: 0.02 });
      if (!material.map) material.color.set(base);
      break;
    }
    case "wood": {
      const base = mixHex("#6e4628", brand.secondary, 0.12);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: woodTexture(base, size), roughness: 0.72, metalness: 0 });
      if (!material.map) material.color.set(base);
      break;
    }
    case "tile": {
      const base = brand.secondary;
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tileTexture(base, size), roughness: 0.32, metalness: 0.05 });
      if (!material.map) material.color.set(base);
      break;
    }
  }
  materialCache.set(key, material);
  return material;
}

/** Ground-side pavement texture (used by the plaza and forecourts). */
export function stoneTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`stone|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(31);
    const n = 8;
    const t = s / n;
    ctx.fillStyle = mixHex(base, "#000000", 0.4);
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < n; r++) {
      const offset = r % 2 === 0 ? 0 : t / 2;
      for (let c = -1; c <= n; c++) {
        const tone = (rand() - 0.5) * 0.14;
        ctx.fillStyle = mixHex(base, tone > 0 ? "#ffffff" : "#000000", Math.abs(tone));
        ctx.fillRect(c * t + offset + 1.5, r * t + 1.5, t - 3, t - 3);
      }
    }
    noise(ctx, s, 37, 0.08, 0.05);
  });
}

/** Dark asphalt with faint aggregate speckle. */
export function asphaltTexture(size: number): THREE.CanvasTexture | null {
  return patternTexture(`asphalt|${size}`, size, (ctx, s) => {
    ctx.fillStyle = "#1c1d21";
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 41, 0.25, 0.07);
  });
}

/** Asphalt with lane markings: dashed centre line and solid edge lines, tiling along U. */
export function roadTexture(size: number): THREE.CanvasTexture | null {
  return patternTexture(`road|${size}`, size, (ctx, s) => {
    ctx.fillStyle = "#1e1f24";
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 43, 0.25, 0.06);
    // Centre dashes (U runs along the road, V across it).
    ctx.fillStyle = "rgba(236, 222, 170, 0.55)";
    const dash = s / 4;
    for (let x = 0; x < s; x += dash) ctx.fillRect(x + dash * 0.15, s / 2 - s * 0.01, dash * 0.45, s * 0.02);
    // Edge lines.
    ctx.fillStyle = "rgba(236, 236, 236, 0.35)";
    ctx.fillRect(0, s * 0.045, s, s * 0.012);
    ctx.fillRect(0, s * 0.943, s, s * 0.012);
  });
}

/** Zebra stripes running across the road (V axis). */
export function crosswalkTexture(size: number): THREE.CanvasTexture | null {
  return patternTexture(`crosswalk|${size}`, size, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "rgba(240, 240, 232, 0.8)";
    const stripes = 8;
    const h = s / stripes;
    for (let i = 0; i < stripes; i++) ctx.fillRect(s * 0.05, i * h + h * 0.2, s * 0.9, h * 0.6);
  });
}

/** Lighter concrete pavers for sidewalks. */
export function pavementTexture(size: number): THREE.CanvasTexture | null {
  return patternTexture(`pavement|${size}`, size, (ctx, s) => {
    const n = 6;
    const t = s / n;
    ctx.fillStyle = "#33343a";
    ctx.fillRect(0, 0, s, s);
    const rand = mulberry32(47);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = 0.45 + (rand() - 0.5) * 0.08;
        ctx.fillStyle = mixHex("#000000", "#bfb9ad", tone);
        ctx.fillRect(c * t + 1, r * t + 1, t - 2, t - 2);
      }
    }
    noise(ctx, s, 53, 0.1, 0.05);
  });
}
