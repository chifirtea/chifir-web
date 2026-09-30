import * as THREE from "three";
import type { BrandPalette, StorefrontConfig } from "@/types/domain";
import { mulberry32, hashString } from "@/engine/environment/prng";

/**
 * Canvas-rendered signage. Every storefront sign, label, poster and fallback card in the city is
 * drawn here from merchant data, so a new merchant needs zero image assets. Textures are cached
 * by their full input key and shared between meshes.
 */

export type SignStyle = StorefrontConfig["signStyle"];

const BASE_FONT_STACK = `"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif`;
let resolvedFontStack: string | null = null;

/**
 * next/font registers the display fonts under generated family names. We look them up once from
 * `document.fonts` and prepend them; when they are unavailable the CSS names fall back to the
 * system stack, which still renders legible signs.
 */
export function signageFontFamily(): string {
  if (resolvedFontStack) return resolvedFontStack;
  let prefix = "";
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      const seen = new Set<string>();
      for (const face of Array.from(document.fonts)) {
        const family = face.family.replace(/^['"]|['"]$/g, "");
        if (/bricolage|instrument/i.test(family) && !seen.has(family)) {
          seen.add(family);
          prefix += `"${family}", `;
        }
      }
    } catch {
      prefix = "";
    }
  }
  resolvedFontStack = `${prefix}${BASE_FONT_STACK}`;
  return resolvedFontStack;
}

/**
 * Largest integer font size in [minSize, maxSize] whose measured width fits `maxWidth`.
 * `measure` returns the width of `text` at a given size. Pure; unit-tested with a fake measurer.
 */
export function fitFontSize(
  measure: (text: string, fontSize: number) => number,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize = 8,
): number {
  const max = Math.max(Math.floor(maxSize), 1);
  const min = Math.max(Math.min(Math.floor(minSize), max), 1);
  if (!text || measure(text, max) <= maxWidth) return max;
  let lo = min;
  let hi = max;
  // Binary search assumes width grows with size (true for any sane measurer).
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text, mid) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Canvas plumbing
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

function createSurface(width: number, height: number): Surface | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

const cache = new Map<string, THREE.CanvasTexture>();

/** Number of cached signage textures (exposed for diagnostics). */
export function signageCacheSize(): number {
  return cache.size;
}

function finishTexture(key: string, canvas: HTMLCanvasElement | null): THREE.CanvasTexture {
  // Server render / no 2D context: a 2×2 placeholder that never touches WebGL.
  const source = canvas ?? ({ width: 2, height: 2 } as unknown as HTMLCanvasElement);
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

function cappedSize(width: number, height: number, maxTextureSize: number): [number, number] {
  const cap = Math.max(64, maxTextureSize);
  const scale = Math.min(1, cap / Math.max(width, height));
  return [Math.round(width * scale), Math.round(height * scale)];
}

function font(weight: number | string, size: number): string {
  return `${weight} ${size}px ${signageFontFamily()}`;
}

function measurer(ctx: Ctx, weight: number | string): (text: string, size: number) => number {
  return (text, size) => {
    ctx.font = font(weight, size);
    return ctx.measureText(text).width;
  };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [128, 128, 128];
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Relative luminance (0..1) of a hex colour; used to keep text legible on any brand panel. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mixes two hex colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const v = ca.map((x, i) => Math.round(x + ((cb[i] ?? x) - x) * t));
  return `#${v.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** The brand colour that glows best against a dark night sky. */
export function glowColor(brand: BrandPalette): string {
  const candidates = [brand.accent, brand.secondary, brand.onPrimary, brand.primary];
  return candidates.find((c) => luminance(c) > 0.18) ?? "#ffc46b";
}

function grain(ctx: Ctx, w: number, h: number, seed: number, amount: number, alpha: number): void {
  const rand = mulberry32(seed);
  const n = Math.floor(w * h * amount);
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const light = rand() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}

function drawFittedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  weight: number | string,
  fill: string,
  letterSpacing = 0,
): number {
  const size = fitFontSize(measurer(ctx, weight), text, maxWidth, maxSize);
  ctx.font = font(weight, size);
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) {
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
  }
  ctx.fillText(text, x, y);
  return size;
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export interface SignTextureOptions {
  text: string;
  style: SignStyle;
  brand: BrandPalette;
  /** Canvas width in px (default 1024). Height defaults to width / 4. */
  width?: number;
  height?: number;
  /** Hard cap from the quality tier. */
  maxTextureSize?: number;
}

/** A storefront sign: neon tubes, backlit panel, hand-painted board or bulb marquee. */
export function makeSignTexture(opts: SignTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 1024;
  const height = opts.height ?? Math.round(width / 4);
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand, style } = opts;
  const text = opts.text.trim() || "•";
  const key = `sign|${style}|${text}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const pad = h * 0.16;
  const maxTextWidth = w - pad * 2;

  switch (style) {
    case "neon": {
      ctx.fillStyle = "#0a0b10";
      ctx.fillRect(0, 0, w, h);
      const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.6);
      vignette.addColorStop(0, "rgba(255,255,255,0.05)");
      vignette.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
      const tube = glowColor(brand);
      const size = fitFontSize(measurer(ctx, 700), text, maxTextWidth, h * 0.62);
      ctx.font = font(700, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      // Outer glow: two blurred strokes.
      ctx.shadowColor = tube;
      ctx.shadowBlur = h * 0.28;
      ctx.strokeStyle = rgba(tube, 0.85);
      ctx.lineWidth = Math.max(2, size * 0.09);
      ctx.strokeText(text, w / 2, h / 2 + size * 0.04);
      ctx.shadowBlur = h * 0.12;
      ctx.strokeText(text, w / 2, h / 2 + size * 0.04);
      // Tube core: near-white.
      ctx.shadowBlur = h * 0.04;
      ctx.strokeStyle = mixHex(tube, "#ffffff", 0.7);
      ctx.lineWidth = Math.max(1.5, size * 0.045);
      ctx.strokeText(text, w / 2, h / 2 + size * 0.04);
      ctx.shadowBlur = 0;
      // Mounting rail.
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(pad, h - pad * 0.55, w - pad * 2, h * 0.02);
      break;
    }
    case "backlit": {
      ctx.fillStyle = brand.primary;
      ctx.fillRect(0, 0, w, h);
      const sheen = ctx.createLinearGradient(0, 0, 0, h);
      sheen.addColorStop(0, "rgba(255,255,255,0.14)");
      sheen.addColorStop(0.5, "rgba(255,255,255,0.02)");
      sheen.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = rgba(brand.onPrimary, 0.22);
      ctx.lineWidth = Math.max(2, h * 0.012);
      roundRect(ctx, pad * 0.5, pad * 0.5, w - pad, h - pad, h * 0.08);
      ctx.stroke();
      ctx.shadowColor = rgba(brand.onPrimary, 0.55);
      ctx.shadowBlur = h * 0.08;
      drawFittedText(ctx, text.toUpperCase(), w / 2, h / 2 + h * 0.02, maxTextWidth, h * 0.5, 800, brand.onPrimary, h * 0.02);
      ctx.shadowBlur = 0;
      break;
    }
    case "painted": {
      const panel = mixHex(brand.primary, "#000000", 0.08);
      ctx.fillStyle = panel;
      ctx.fillRect(0, 0, w, h);
      grain(ctx, w, h, hashString(key), 0.06, 0.06);
      const ink = luminance(panel) > 0.5 ? brand.secondary : brand.accent;
      // Hand-painted double border.
      ctx.strokeStyle = rgba(ink, 0.7);
      ctx.lineWidth = Math.max(2, h * 0.016);
      roundRect(ctx, pad * 0.45, pad * 0.45, w - pad * 0.9, h - pad * 0.9, h * 0.03);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, h * 0.006);
      roundRect(ctx, pad * 0.7, pad * 0.7, w - pad * 1.4, h - pad * 1.4, h * 0.02);
      ctx.stroke();
      // Slight brush offset gives the letters a hand-lettered edge.
      ctx.globalAlpha = 0.35;
      drawFittedText(ctx, text, w / 2 + h * 0.012, h / 2 + h * 0.03, maxTextWidth * 0.9, h * 0.5, 600, mixHex(ink, "#000000", 0.4));
      ctx.globalAlpha = 1;
      drawFittedText(ctx, text, w / 2, h / 2 + h * 0.02, maxTextWidth * 0.9, h * 0.5, 600, ink);
      // Thin underline flourish.
      const underlineW = Math.min(maxTextWidth * 0.5, w * 0.4);
      ctx.fillStyle = rgba(ink, 0.8);
      ctx.fillRect(w / 2 - underlineW / 2, h * 0.8, underlineW, Math.max(1, h * 0.008));
      break;
    }
    case "marquee": {
      ctx.fillStyle = brand.primary;
      ctx.fillRect(0, 0, w, h);
      const inner = mixHex(brand.primary, "#000000", 0.25);
      ctx.fillStyle = inner;
      roundRect(ctx, pad * 0.9, pad * 0.9, w - pad * 1.8, h - pad * 1.8, h * 0.05);
      ctx.fill();
      ctx.shadowColor = rgba(brand.onPrimary, 0.4);
      ctx.shadowBlur = h * 0.05;
      drawFittedText(ctx, text.toUpperCase(), w / 2, h / 2 + h * 0.02, maxTextWidth * 0.82, h * 0.46, 800, brand.onPrimary, h * 0.025);
      ctx.shadowBlur = 0;
      // Bulb row around the perimeter.
      const r = h * 0.035;
      const step = r * 3.2;
      const bulb = (x: number, y: number, bright: boolean) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
        g.addColorStop(0, bright ? "#fff6d6" : "#ffd58a");
        g.addColorStop(0.45, bright ? "#ffcd6b" : "#e6a24a");
        g.addColorStop(1, "rgba(255,180,80,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      };
      const inset = pad * 0.45;
      let i = 0;
      for (let x = inset; x <= w - inset + 0.01; x += step, i++) {
        bulb(x, inset, i % 2 === 0);
        bulb(x, h - inset, i % 2 === 1);
      }
      for (let y = inset + step; y < h - inset - step * 0.5; y += step, i++) {
        bulb(inset, y, i % 2 === 0);
        bulb(w - inset, y, i % 2 === 1);
      }
      break;
    }
  }
  return finishTexture(key, canvas);
}

// ---------------------------------------------------------------------------
// Labels, menus, posters, fallback cards
// ---------------------------------------------------------------------------

export interface LabelTextureOptions {
  bg: string;
  fg: string;
  /** Smaller second line. */
  subtext?: string;
  width?: number;
  height?: number;
  maxTextureSize?: number;
  /** Corner radius as a fraction of height (default 0.2). */
  radius?: number;
  /** Optional accent stripe on the left edge. */
  accent?: string;
}

/** A compact tag: name tags, price cards, lot signs. */
export function makeLabelTexture(text: string, opts: LabelTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 160;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const key = `label|${text}|${opts.subtext ?? ""}|${opts.bg}|${opts.fg}|${opts.accent ?? ""}|${opts.radius ?? ""}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = opts.bg;
  roundRect(ctx, 0, 0, w, h, h * (opts.radius ?? 0.2));
  ctx.fill();
  if (opts.accent) {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(0, h * 0.2, Math.max(3, w * 0.012), h * 0.6);
  }
  const pad = w * 0.06;
  if (opts.subtext) {
    drawFittedText(ctx, text, w / 2, h * 0.38, w - pad * 2, h * 0.42, 700, opts.fg);
    drawFittedText(ctx, opts.subtext, w / 2, h * 0.76, w - pad * 2, h * 0.24, 500, rgba(opts.fg, 0.75));
  } else {
    drawFittedText(ctx, text, w / 2, h / 2 + h * 0.02, w - pad * 2, h * 0.56, 700, opts.fg);
  }
  return finishTexture(key, canvas);
}

export interface PosterTextureOptions {
  title: string;
  subtitle?: string;
  brand: BrandPalette;
  /** Small caption in the corner (e.g. "EVENT SQUARE"). */
  eyebrow?: string;
  width?: number;
  height?: number;
  maxTextureSize?: number;
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }
  return lines;
}

/** A billboard or venue-screen poster: brand gradient, big title, subtitle, eyebrow. */
export function makePosterTexture(opts: PosterTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 1024;
  const height = opts.height ?? 512;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const key = `poster|${opts.title}|${opts.subtitle ?? ""}|${opts.eyebrow ?? ""}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, brand.primary);
  g.addColorStop(1, mixHex(brand.primary, brand.secondary, 0.75));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft glow blob in the accent colour.
  const glow = ctx.createRadialGradient(w * 0.82, h * 0.2, 0, w * 0.82, h * 0.2, w * 0.45);
  glow.addColorStop(0, rgba(brand.accent, 0.35));
  glow.addColorStop(1, rgba(brand.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, hashString(key), 0.02, 0.05);
  const pad = w * 0.07;
  const fg = luminance(brand.primary) > 0.5 ? brand.secondary : brand.onPrimary;
  if (opts.eyebrow) {
    ctx.font = font(700, h * 0.055);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = brand.accent;
    ctx.fillText(opts.eyebrow.toUpperCase(), pad, pad * 0.9);
    ctx.fillRect(pad, pad * 0.9 + h * 0.075, w * 0.08, Math.max(2, h * 0.008));
  }
  const titleSize = h * 0.19;
  ctx.font = font(800, titleSize);
  const lines = wrapLines(ctx, opts.title, w - pad * 2, 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fg;
  const baseY = h * (opts.subtitle ? 0.58 : 0.66);
  lines.forEach((line, i) => {
    const size = fitFontSize(measurer(ctx, 800), line, w - pad * 2, titleSize);
    ctx.font = font(800, size);
    ctx.fillText(line, pad, baseY + (i - (lines.length - 1)) * titleSize * 1.05);
  });
  if (opts.subtitle) {
    ctx.font = font(500, h * 0.085);
    const subSize = fitFontSize(measurer(ctx, 500), opts.subtitle, w - pad * 2, h * 0.085);
    ctx.font = font(500, subSize);
    ctx.fillStyle = rgba(fg, 0.85);
    ctx.fillText(opts.subtitle, pad, h * 0.8);
  }
  return finishTexture(key, canvas);
}

export interface MenuTextureOptions {
  title: string;
  /** Up to ~6 lines; each may be `[label, price]`. */
  lines: Array<[string, string] | string>;
  brand: BrandPalette;
  width?: number;
  height?: number;
  maxTextureSize?: number;
}

/** A menu board: brand panel with a title and a short list of items and prices. */
export function makeMenuTexture(opts: MenuTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 640;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const flat = opts.lines.map((l) => (Array.isArray(l) ? l.join("=") : l)).join("|");
  const key = `menu|${opts.title}|${flat}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const panel = mixHex(brand.primary, "#000000", 0.2);
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, hashString(key), 0.03, 0.05);
  const fg = luminance(panel) > 0.5 ? brand.secondary : brand.onPrimary;
  const pad = w * 0.08;
  ctx.strokeStyle = rgba(brand.accent, 0.6);
  ctx.lineWidth = Math.max(2, w * 0.006);
  roundRect(ctx, pad * 0.5, pad * 0.5, w - pad, h - pad, w * 0.02);
  ctx.stroke();
  drawFittedText(ctx, opts.title.toUpperCase(), w / 2, pad * 1.6, w - pad * 2, h * 0.07, 800, brand.accent, w * 0.006);
  ctx.fillStyle = rgba(brand.accent, 0.7);
  ctx.fillRect(pad, pad * 2.5, w - pad * 2, Math.max(1, h * 0.003));
  const rows = opts.lines.slice(0, 7);
  const rowH = (h - pad * 3.6) / Math.max(rows.length, 4);
  const lineSize = Math.min(rowH * 0.42, h * 0.052);
  rows.forEach((row, i) => {
    const y = pad * 3.2 + rowH * i + rowH / 2;
    const label = Array.isArray(row) ? row[0] : row;
    const price = Array.isArray(row) ? row[1] : "";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fg;
    const priceW = price ? (ctx.font = font(700, lineSize), ctx.measureText(price).width) : 0;
    const labelMax = w - pad * 2 - priceW - (price ? w * 0.04 : 0);
    const size = fitFontSize(measurer(ctx, 500), label, labelMax, lineSize);
    ctx.font = font(500, size);
    ctx.textAlign = "left";
    ctx.fillText(label, pad, y);
    if (price) {
      ctx.font = font(700, lineSize);
      ctx.textAlign = "right";
      ctx.fillStyle = brand.accent;
      ctx.fillText(price, w - pad, y);
    }
    ctx.fillStyle = rgba(fg, 0.12);
    ctx.fillRect(pad, y + rowH * 0.45, w - pad * 2, 1);
  });
  return finishTexture(key, canvas);
}

export interface InitialTextureOptions {
  /** Label whose first character becomes the big initial. */
  label: string;
  brand: BrandPalette;
  size?: number;
  maxTextureSize?: number;
  /** Small caption under the initial (e.g. a product title). */
  caption?: string;
}

/**
 * Branded fallback card (gradient + big initial), mirroring the UI's ProductImage fallback.
 * Used for missing logos and product images that fail to load.
 */
export function makeInitialTexture(opts: InitialTextureOptions): THREE.CanvasTexture {
  const size = Math.min(opts.size ?? 256, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const initial = opts.label.trim().charAt(0).toUpperCase() || "•";
  const key = `initial|${initial}|${opts.caption ?? ""}|${brand.primary}|${brand.secondary}|${brand.accent}|${size}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size, size);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, brand.primary);
  g.addColorStop(1, brand.secondary);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.font = font(700, size * 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(brand.accent, 0.92);
  ctx.fillText(initial, size * 0.1, size * 0.86);
  if (opts.caption) {
    const capSize = fitFontSize(measurer(ctx, 500), opts.caption, size * 0.8, size * 0.09);
    ctx.font = font(500, capSize);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(luminance(brand.primary) > 0.5 ? brand.secondary : brand.onPrimary, 0.85);
    ctx.fillText(opts.caption, size * 0.92, size * 0.16);
  }
  return finishTexture(key, canvas);
}

/** Frees every cached canvas texture (used when the WebGL context is torn down). */
export function disposeSignageCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
