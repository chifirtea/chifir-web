import * as THREE from "three";
import type { DistrictTheme } from "@/types/domain";
import { signageFontFamily, mixHex } from "@/engine/storefront/signage";
import { mulberry32, hashString } from "./prng";

/**
 * Procedural canvas textures for everything between the buildings: pavement per district theme,
 * light pools, lamp banners, street ironwork. Cached by key so every surface with the same look
 * shares one texture; a null result means "no document" (SSR) and callers fall back to flat colour.
 */

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, THREE.CanvasTexture>();

function pattern(
  key: string,
  width: number,
  height: number,
  draw: (ctx: Ctx, w: number, h: number) => void,
  opts: { repeat?: boolean; alpha?: boolean } = {},
): THREE.CanvasTexture | null {
  const cached = cache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (opts.alpha) ctx.clearRect(0, 0, canvas.width, canvas.height);
  draw(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const wrap = opts.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

function speckle(ctx: Ctx, w: number, h: number, seed: number, density: number, alpha: number): void {
  const rand = mulberry32(seed);
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
}

function shade(base: string, t: number): string {
  return mixHex(base, t > 0 ? "#ffffff" : "#000000", Math.abs(t));
}

export type PavementKind = NonNullable<DistrictTheme["pavement"]>;

/** Base tone of a pavement kind before the district accent is mixed in. */
const PAVEMENT_BASE: Record<PavementKind, string> = {
  stone: "#6f6d6a",
  asphalt: "#3b3c42",
  brick: "#6a4a3e",
  plaza: "#7a7268",
};

/**
 * Pavement for sidewalks: stone flags, brick pavers in a running bond, poured asphalt with
 * expansion seams, or the plaza's large pale slabs. The district accent tints the grout and a few
 * random stones so a street reads as "its" colour even in the dark.
 */
export function pavementTexture(kind: PavementKind, accent: string, size: number): THREE.CanvasTexture | null {
  const base = mixHex(PAVEMENT_BASE[kind], accent, kind === "asphalt" ? 0.04 : 0.1);
  return pattern(`pave|${kind}|${accent}|${size}`, size, size, (ctx, s) => {
    const rand = mulberry32(hashString(`${kind}:${accent}`));
    ctx.fillStyle = shade(base, -0.45);
    ctx.fillRect(0, 0, s, s);
    if (kind === "brick") {
      const cols = 6;
      const rows = 12;
      const bw = s / cols;
      const bh = s / rows;
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 0 ? 0 : bw / 2;
        for (let c = -1; c <= cols; c++) {
          const t = (rand() - 0.5) * 0.3;
          ctx.fillStyle = rand() > 0.93 ? mixHex(base, accent, 0.3) : shade(base, t);
          ctx.fillRect(c * bw + offset + 1.2, r * bh + 1.2, bw - 2.4, bh - 2.4);
        }
      }
    } else if (kind === "asphalt") {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, s / 2 - 1, s, 2);
      ctx.fillRect(s / 2 - 1, 0, 2, s);
      speckle(ctx, s, s, 71, 0.25, 0.06);
      return;
    } else {
      const n = kind === "plaza" ? 4 : 5;
      const t = s / n;
      for (let r = 0; r < n; r++) {
        const offset = kind === "stone" && r % 2 === 1 ? t / 2 : 0;
        for (let c = -1; c <= n; c++) {
          const tone = (rand() - 0.5) * (kind === "plaza" ? 0.1 : 0.2);
          ctx.fillStyle = rand() > 0.94 ? mixHex(base, accent, 0.22) : shade(base, tone);
          const w = kind === "stone" ? t * (0.7 + rand() * 0.6) : t;
          ctx.fillRect(c * t + offset + 1.5, r * t + 1.5, Math.min(w, t) - 3, t - 3);
        }
      }
    }
    speckle(ctx, s, s, 73, 0.08, 0.05);
  });
}

/** Soft white radial falloff; tint it with the material colour (light pools, particle sprites). */
export function radialGlowTexture(size = 128, hardness = 0): THREE.CanvasTexture | null {
  return pattern(
    `glow|${size}|${hardness}`,
    size,
    size,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25 + hardness * 0.4, "rgba(255,255,255,0.55)");
      g.addColorStop(0.7, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { repeat: false, alpha: true },
  );
}

/** A puff of steam: blotchy, soft-edged, white on transparent. */
export function puffTexture(size = 64): THREE.CanvasTexture | null {
  return pattern(
    `puff|${size}`,
    size,
    size,
    (ctx, s) => {
      const rand = mulberry32(99);
      for (let i = 0; i < 7; i++) {
        const x = s / 2 + (rand() - 0.5) * s * 0.4;
        const y = s / 2 + (rand() - 0.5) * s * 0.4;
        const r = s * (0.18 + rand() * 0.16);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    },
    { repeat: false, alpha: true },
  );
}

/**
 * A vertical lamp-post banner in the district accent: a pale band, the district name running
 * up the banner and a small mark at the foot. Same texture on both faces.
 */
export function bannerTexture(name: string, accent: string, size: number): THREE.CanvasTexture | null {
  const w = Math.max(64, Math.round(size / 4));
  const h = Math.max(128, Math.round(size / 2));
  return pattern(
    `banner|${name}|${accent}|${size}`,
    w,
    h,
    (ctx, cw, ch) => {
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, cw, ch);
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, "rgba(255,255,255,0.08)");
      g.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(cw * 0.12, ch * 0.08, cw * 0.76, ch * 0.012);
      ctx.fillRect(cw * 0.12, ch * 0.9, cw * 0.76, ch * 0.012);
      ctx.save();
      ctx.translate(cw / 2, ch * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `800 ${Math.round(cw * 0.42)}px ${signageFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      const text = name.toUpperCase();
      const maxW = ch * 0.74;
      let fontSize = Math.round(cw * 0.42);
      while (fontSize > 8 && ctx.measureText(text).width > maxW) {
        fontSize -= 1;
        ctx.font = `800 ${fontSize}px ${signageFontFamily()}`;
      }
      ctx.fillText(text, 0, 0);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cw / 2, ch * 0.955, cw * 0.05, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
    },
    { repeat: false },
  );
}

/** Round cast-iron manhole cover with a ring and a diamond grid. */
export function manholeTexture(size = 128): THREE.CanvasTexture | null {
  return pattern(
    `manhole|${size}`,
    size,
    size,
    (ctx, s) => {
      const c = s / 2;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.96, 0, Math.PI * 2);
      ctx.fillStyle = "#2a2b2f";
      ctx.fill();
      ctx.lineWidth = s * 0.03;
      ctx.strokeStyle = "#45474d";
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c * 0.74, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(90,92,100,0.9)";
      ctx.lineWidth = s * 0.02;
      for (let i = -s; i < s * 2; i += s * 0.11) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + s, s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i, s);
        ctx.lineTo(i + s, 0);
        ctx.stroke();
      }
      ctx.restore();
      speckle(ctx, s, s, 81, 0.06, 0.08);
    },
    { repeat: false, alpha: true },
  );
}

/** Rectangular gutter grate: dark slots in a steel frame. */
export function drainTexture(size = 128): THREE.CanvasTexture | null {
  return pattern(
    `drain|${size}`,
    size,
    Math.round(size / 2),
    (ctx, w, h) => {
      ctx.fillStyle = "#3a3c42";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#0d0e11";
      const slots = 7;
      const sw = (w * 0.86) / slots;
      for (let i = 0; i < slots; i++) ctx.fillRect(w * 0.07 + i * sw + sw * 0.25, h * 0.18, sw * 0.5, h * 0.64);
      ctx.strokeStyle = "#55575e";
      ctx.lineWidth = Math.max(2, w * 0.03);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    },
    { repeat: false },
  );
}

/** Dark skyline windows: warm dots on near-black, tiling across distant silhouettes. */
export function skylineWindowsTexture(size = 64): THREE.CanvasTexture | null {
  return pattern(`skyline|${size}`, size, size, (ctx, s) => {
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, s, s);
    const rand = mulberry32(123);
    const cols = 6;
    const rows = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = rand();
        if (v < 0.45) continue;
        ctx.fillStyle = v > 0.85 ? "rgba(255,214,160,0.95)" : v > 0.65 ? "rgba(255,196,120,0.65)" : "rgba(160,190,255,0.5)";
        ctx.fillRect(c * (s / cols) + 2, r * (s / rows) + 2, s / cols - 4, s / rows - 4);
      }
    }
  });
}

/** Ripple normal-ish detail for the fountain: concentric rings with noise, tiling. */
export function rippleTexture(size = 128): THREE.CanvasTexture | null {
  return pattern(`ripple|${size}`, size, size, (ctx, s) => {
    ctx.fillStyle = "#1a3a52";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(200, 230, 255, 0.18)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * s + Math.sin(i * 1.7) * 3;
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin(x / 11 + i) * 2.5);
      ctx.stroke();
    }
  });
}

/** Lamp-post disc under a lamp: a hard inner core and a wide soft halo (for additive pools). */
export function lightPoolTexture(size = 128): THREE.CanvasTexture | null {
  return pattern(
    `pool|${size}`,
    size,
    size,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.18, "rgba(255,255,255,0.5)");
      g.addColorStop(0.5, "rgba(255,255,255,0.14)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    { repeat: false, alpha: true },
  );
}
