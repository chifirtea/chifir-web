import * as THREE from "three";
import type { BrandPalette, StorefrontConfig } from "@/types/domain";
import { mulberry32, hashString } from "@/engine/environment/prng";
import { monogram } from "@/lib/media/monogram";

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

function setTracking(ctx: Ctx, px: number): void {
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Measures with tracking applied, so fitted text accounts for its letter spacing. */
function measurer(ctx: Ctx, weight: number | string, trackingEm = 0): (text: string, size: number) => number {
  return (text, size) => {
    ctx.font = font(weight, size);
    setTracking(ctx, size * trackingEm);
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

export function hexToRgb(hex: string): [number, number, number] {
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

export function rgba(hex: string, alpha: number): string {
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

/** Ink that reads on a panel of `bg`: the brand's own dark/light colour, never grey. */
export function inkOn(bg: string, brand: BrandPalette): string {
  if (luminance(bg) > 0.45) {
    return [brand.secondary, brand.primary, brand.onPrimary, "#1a1d24"].find((c) => luminance(c) < 0.25) ?? "#1a1d24";
  }
  return [brand.onPrimary, brand.accent, brand.secondary, "#f4f1ea"].find((c) => luminance(c) > 0.45) ?? "#f4f1ea";
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
  trackingEm = 0,
  align: CanvasTextAlign = "center",
): number {
  const size = fitFontSize(measurer(ctx, weight, trackingEm), text, maxWidth, maxSize);
  ctx.font = font(weight, size);
  setTracking(ctx, size * trackingEm);
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  // With tracking, Canvas adds the spacing after every glyph including the last; recentre.
  const shift = align === "center" ? (size * trackingEm) / 2 : 0;
  ctx.fillText(text, x + shift, y);
  setTracking(ctx, 0);
  return size;
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

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export interface SignTextureOptions {
  text: string;
  style: SignStyle;
  brand: BrandPalette;
  /** Small second line (tagline, category) on painted and backlit boards. */
  subtext?: string;
  /** Canvas width in px (default 1024). Height defaults to width / 4. */
  width?: number;
  height?: number;
  /** Hard cap from the quality tier. */
  maxTextureSize?: number;
}

/** Typography per sign style: real signage is set wide and heavy, not like body copy. */
export const SIGN_TYPE: Record<SignStyle, { weight: number; tracking: number; upper: boolean }> = {
  neon: { weight: 600, tracking: 0.05, upper: false },
  backlit: { weight: 800, tracking: 0.09, upper: true },
  painted: { weight: 800, tracking: 0.14, upper: true },
  marquee: { weight: 900, tracking: 0.07, upper: true },
};

/** A storefront sign: neon tubes on a dark backer, a lightbox, a stencilled board or a bulb marquee. */
export function makeSignTexture(opts: SignTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 1024;
  const height = opts.height ?? Math.round(width / 4);
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand, style } = opts;
  const text = opts.text.trim() || "•";
  const sub = opts.subtext?.trim() ?? "";
  const key = `sign|${style}|${text}|${sub}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const pad = h * 0.16;
  const maxTextWidth = w - pad * 2;
  const type = SIGN_TYPE[style];
  const shown = type.upper ? text.toUpperCase() : text;

  switch (style) {
    case "neon": {
      // Acrylic backer: near-black with a faint reflected halo of the tube colour.
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, w, h);
      const tube = glowColor(brand);
      const halo = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.55);
      halo.addColorStop(0, rgba(tube, 0.16));
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      const size = fitFontSize(measurer(ctx, type.weight, type.tracking), shown, maxTextWidth * 0.92, h * 0.6);
      ctx.font = font(type.weight, size);
      setTracking(ctx, size * type.tracking);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const cx = w / 2 + (size * type.tracking) / 2;
      const cy = h / 2 + size * 0.04;
      // Wide bloom, tight bloom, then the tube core: three strokes read as lit glass.
      ctx.shadowColor = tube;
      ctx.shadowBlur = h * 0.36;
      ctx.strokeStyle = rgba(tube, 0.55);
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.strokeText(shown, cx, cy);
      ctx.shadowBlur = h * 0.14;
      ctx.strokeStyle = rgba(tube, 0.95);
      ctx.lineWidth = Math.max(2, size * 0.075);
      ctx.strokeText(shown, cx, cy);
      ctx.shadowBlur = h * 0.03;
      ctx.strokeStyle = mixHex(tube, "#ffffff", 0.78);
      ctx.lineWidth = Math.max(1.5, size * 0.038);
      ctx.strokeText(shown, cx, cy);
      ctx.shadowBlur = 0;
      setTracking(ctx, 0);
      // A thin second tube frames short names in the secondary colour, like a real sign shop would.
      const measured = ctx.measureText(shown).width;
      if (measured < maxTextWidth * 0.72) {
        const second = luminance(brand.secondary) > 0.18 ? brand.secondary : tube;
        ctx.shadowColor = second;
        ctx.shadowBlur = h * 0.1;
        ctx.strokeStyle = rgba(mixHex(second, "#ffffff", 0.35), 0.9);
        ctx.lineWidth = Math.max(1.5, h * 0.014);
        roundRect(ctx, pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1, h * 0.12);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Mounting standoffs.
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (const x of [pad * 0.35, w - pad * 0.35]) {
        for (const y of [pad * 0.35, h - pad * 0.35]) {
          ctx.beginPath();
          ctx.arc(x, y, h * 0.012, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "backlit": {
      // Lightbox: a lit acrylic face with a brighter centre and a slim bezel.
      ctx.fillStyle = brand.primary;
      ctx.fillRect(0, 0, w, h);
      const lit = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.1, w / 2, h * 0.5, w * 0.6);
      lit.addColorStop(0, "rgba(255,255,255,0.2)");
      lit.addColorStop(0.6, "rgba(255,255,255,0.05)");
      lit.addColorStop(1, "rgba(0,0,0,0.1)");
      ctx.fillStyle = lit;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = Math.max(3, h * 0.03);
      ctx.strokeRect(0, 0, w, h);
      ctx.strokeStyle = rgba(brand.onPrimary, 0.16);
      ctx.lineWidth = Math.max(1, h * 0.006);
      roundRect(ctx, pad * 0.45, pad * 0.45, w - pad * 0.9, h - pad * 0.9, h * 0.06);
      ctx.stroke();
      const ink = inkOn(brand.primary, brand);
      ctx.shadowColor = rgba(ink, 0.45);
      ctx.shadowBlur = h * 0.06;
      const titleY = sub ? h * 0.44 : h * 0.5;
      const size = drawFittedText(ctx, shown, w / 2, titleY, maxTextWidth, h * (sub ? 0.42 : 0.5), type.weight, ink, type.tracking);
      ctx.shadowBlur = 0;
      const rule = Math.min(maxTextWidth * 0.3, size * 2.2);
      ctx.fillStyle = rgba(brand.accent, 0.9);
      ctx.fillRect(w / 2 - rule / 2, titleY + size * 0.62, rule, Math.max(2, h * 0.012));
      if (sub) drawFittedText(ctx, sub.toUpperCase(), w / 2, h * 0.8, maxTextWidth * 0.8, h * 0.13, 600, rgba(ink, 0.8), 0.22);
      break;
    }
    case "painted": {
      // Matte board with a stencilled wordmark: grain, rough double strokes, a tracked caption.
      const panel = mixHex(brand.primary, "#000000", 0.1);
      ctx.fillStyle = panel;
      ctx.fillRect(0, 0, w, h);
      const wash = ctx.createLinearGradient(0, 0, w, h);
      wash.addColorStop(0, "rgba(255,255,255,0.06)");
      wash.addColorStop(1, "rgba(0,0,0,0.08)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);
      grain(ctx, w, h, hashString(key), 0.08, 0.07);
      const ink = inkOn(panel, brand);
      ctx.strokeStyle = rgba(ink, 0.75);
      ctx.lineWidth = Math.max(2, h * 0.018);
      roundRect(ctx, pad * 0.4, pad * 0.4, w - pad * 0.8, h - pad * 0.8, h * 0.02);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, h * 0.006);
      roundRect(ctx, pad * 0.62, pad * 0.62, w - pad * 1.24, h - pad * 1.24, h * 0.015);
      ctx.stroke();
      const titleY = sub ? h * 0.44 : h * 0.5;
      const maxSize = h * (sub ? 0.4 : 0.48);
      // Stencil edge: two faint offset passes under the real pass.
      ctx.globalAlpha = 0.28;
      drawFittedText(ctx, shown, w / 2 + h * 0.012, titleY + h * 0.012, maxTextWidth * 0.86, maxSize, type.weight, mixHex(ink, "#000000", 0.5), type.tracking);
      drawFittedText(ctx, shown, w / 2 - h * 0.008, titleY - h * 0.006, maxTextWidth * 0.86, maxSize, type.weight, mixHex(ink, "#ffffff", 0.3), type.tracking);
      ctx.globalAlpha = 0.94;
      const size = drawFittedText(ctx, shown, w / 2, titleY, maxTextWidth * 0.86, maxSize, type.weight, ink, type.tracking);
      ctx.globalAlpha = 1;
      // Stencil bridges: thin panel-coloured slits through the heaviest strokes.
      ctx.fillStyle = rgba(panel, 0.85);
      const slitY = titleY - size * 0.08;
      ctx.fillRect(pad * 0.9, slitY, w - pad * 1.8, Math.max(1, size * 0.028));
      if (sub) {
        drawFittedText(ctx, sub.toUpperCase(), w / 2, h * 0.79, maxTextWidth * 0.7, h * 0.11, 600, rgba(ink, 0.82), 0.26);
      } else {
        const rule = Math.min(maxTextWidth * 0.42, w * 0.36);
        ctx.fillStyle = rgba(ink, 0.8);
        ctx.fillRect(w / 2 - rule / 2, h * 0.79, rule, Math.max(1, h * 0.01));
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.79 + h * 0.005, h * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "marquee": {
      ctx.fillStyle = brand.primary;
      ctx.fillRect(0, 0, w, h);
      const inner = mixHex(brand.primary, "#000000", 0.3);
      ctx.fillStyle = inner;
      roundRect(ctx, pad * 0.95, pad * 0.95, w - pad * 1.9, h - pad * 1.9, h * 0.05);
      ctx.fill();
      // Faint chase-light wash across the inner panel.
      const wash = ctx.createLinearGradient(0, pad, 0, h - pad);
      wash.addColorStop(0, "rgba(255,210,140,0.12)");
      wash.addColorStop(1, "rgba(0,0,0,0.0)");
      ctx.fillStyle = wash;
      roundRect(ctx, pad * 0.95, pad * 0.95, w - pad * 1.9, h - pad * 1.9, h * 0.05);
      ctx.fill();
      const ink = inkOn(inner, brand);
      ctx.shadowColor = rgba(ink, 0.5);
      ctx.shadowBlur = h * 0.06;
      drawFittedText(ctx, shown, w / 2, h / 2 + h * 0.02, maxTextWidth * 0.8, h * 0.44, type.weight, ink, type.tracking);
      ctx.shadowBlur = 0;
      // Bulb row around the perimeter, alternating bright/dim like a running chase.
      const r = h * 0.034;
      const step = r * 3.1;
      const bulb = (x: number, y: number, bright: boolean) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.1);
        g.addColorStop(0, bright ? "#fff8e0" : "#ffd89a");
        g.addColorStop(0.35, bright ? "#ffd27a" : "#e2a24e");
        g.addColorStop(1, "rgba(255,180,80,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(40,30,20,0.6)";
        ctx.beginPath();
        ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
        ctx.stroke();
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

/**
 * A soft radial glow in one colour on a transparent canvas; drawn as an additive plane behind
 * neon and LED signage so the light appears to bleed onto the façade. Tiny and shared per colour.
 */
export function makeGlowTexture(color: string, size = 128): THREE.CanvasTexture {
  const key = `glow|${color}|${size}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size, size);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 0.9));
  g.addColorStop(0.35, rgba(color, 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
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
  /** Letter spacing in em for the main line (uppercase plates). */
  tracking?: number;
  /** Font weight of the main line (default 700). */
  weight?: number;
}

/** A compact tag: name tags, price cards, lot signs, door plates. */
export function makeLabelTexture(text: string, opts: LabelTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 160;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const key = `label|${text}|${opts.subtext ?? ""}|${opts.bg}|${opts.fg}|${opts.accent ?? ""}|${opts.radius ?? ""}|${opts.tracking ?? ""}|${opts.weight ?? ""}|${w}x${h}`;
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
  const weight = opts.weight ?? 700;
  if (opts.subtext) {
    drawFittedText(ctx, text, w / 2, h * 0.38, w - pad * 2, h * 0.42, weight, opts.fg, opts.tracking ?? 0);
    drawFittedText(ctx, opts.subtext, w / 2, h * 0.76, w - pad * 2, h * 0.24, 500, rgba(opts.fg, 0.75));
  } else {
    drawFittedText(ctx, text, w / 2, h / 2 + h * 0.02, w - pad * 2, h * 0.56, weight, opts.fg, opts.tracking ?? 0);
  }
  return finishTexture(key, canvas);
}

export interface OpenSignOptions {
  /** "Open" | "Opens 11:30 AM" | "Closed" */
  label: string;
  open: boolean;
  brand: BrandPalette;
  maxTextureSize?: number;
}

/** The small window sign: a neon "OPEN" in the brand glow, or a dim board when closed. */
export function makeOpenSignTexture(opts: OpenSignOptions): THREE.CanvasTexture {
  const [w, h] = cappedSize(512, 192, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const key = `open|${opts.label}|${opts.open}|${brand.accent}|${brand.secondary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  ctx.fillStyle = "#07080c";
  roundRect(ctx, 0, 0, w, h, h * 0.12);
  ctx.fill();
  const tube = opts.open ? glowColor(brand) : "#8d8a84";
  const text = opts.label.toUpperCase();
  const size = fitFontSize(measurer(ctx, 700, 0.12), text, w * 0.8, h * 0.5);
  ctx.font = font(700, size);
  setTracking(ctx, size * 0.12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const cx = w / 2 + size * 0.06;
  if (opts.open) {
    ctx.shadowColor = tube;
    ctx.shadowBlur = h * 0.3;
    ctx.strokeStyle = rgba(tube, 0.9);
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeText(text, cx, h / 2);
    ctx.shadowBlur = h * 0.05;
    ctx.strokeStyle = mixHex(tube, "#ffffff", 0.75);
    ctx.lineWidth = Math.max(1.5, size * 0.04);
    ctx.strokeText(text, cx, h / 2);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = rgba(tube, 0.55);
    ctx.fillText(text, cx, h / 2);
  }
  setTracking(ctx, 0);
  ctx.strokeStyle = rgba(opts.open ? tube : "#ffffff", opts.open ? 0.35 : 0.12);
  ctx.lineWidth = Math.max(1, h * 0.012);
  roundRect(ctx, h * 0.1, h * 0.1, w - h * 0.2, h - h * 0.2, h * 0.08);
  ctx.stroke();
  return finishTexture(key, canvas);
}

export interface PosterTextureOptions {
  title: string;
  subtitle?: string;
  brand: BrandPalette;
  /** Small caption in the corner (e.g. "EVENT SQUARE"). */
  eyebrow?: string;
  /** Bottom line (e.g. "Opens tonight · 8:00 PM"). */
  footer?: string;
  width?: number;
  height?: number;
  maxTextureSize?: number;
}

/** A billboard or venue-screen poster: brand gradient, big title, subtitle, eyebrow, footer. */
export function makePosterTexture(opts: PosterTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 1024;
  const height = opts.height ?? 512;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const key = `poster|${opts.title}|${opts.subtitle ?? ""}|${opts.eyebrow ?? ""}|${opts.footer ?? ""}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, brand.primary);
  g.addColorStop(1, mixHex(brand.primary, brand.secondary, 0.7));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft glow blob in the accent colour plus a diagonal sweep: print-like depth, not flat fill.
  const glow = ctx.createRadialGradient(w * 0.82, h * 0.2, 0, w * 0.82, h * 0.2, w * 0.45);
  glow.addColorStop(0, rgba(brand.accent, 0.38));
  glow.addColorStop(1, rgba(brand.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const sweep = ctx.createLinearGradient(0, h, w * 0.6, 0);
  sweep.addColorStop(0, "rgba(0,0,0,0.25)");
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, hashString(key), 0.02, 0.05);
  const pad = w * 0.07;
  const fg = inkOn(brand.primary, brand);
  const short = Math.min(w, h);
  if (opts.eyebrow) {
    ctx.font = font(700, short * 0.05);
    setTracking(ctx, short * 0.05 * 0.2);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = brand.accent;
    ctx.fillText(opts.eyebrow.toUpperCase(), pad, pad * 0.9);
    setTracking(ctx, 0);
    ctx.fillRect(pad, pad * 0.9 + short * 0.07, w * 0.08, Math.max(2, short * 0.008));
  }
  const titleSize = Math.min(h * 0.19, w * 0.13);
  ctx.font = font(800, titleSize);
  const lines = wrapLines(ctx, opts.title, w - pad * 2, 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fg;
  const baseY = h * (opts.subtitle ? 0.58 : opts.footer ? 0.6 : 0.66);
  lines.forEach((line, i) => {
    const size = fitFontSize(measurer(ctx, 800), line, w - pad * 2, titleSize);
    ctx.font = font(800, size);
    ctx.fillText(line, pad, baseY + (i - (lines.length - 1)) * titleSize * 1.05);
  });
  if (opts.subtitle) {
    const subSize = fitFontSize(measurer(ctx, 500), opts.subtitle, w - pad * 2, short * 0.085);
    ctx.font = font(500, subSize);
    ctx.fillStyle = rgba(fg, 0.85);
    ctx.fillText(opts.subtitle, pad, h * 0.76);
  }
  if (opts.footer) {
    const footSize = fitFontSize(measurer(ctx, 700, 0.12), opts.footer.toUpperCase(), w - pad * 2, short * 0.06);
    ctx.font = font(700, footSize);
    setTracking(ctx, footSize * 0.12);
    ctx.fillStyle = brand.accent;
    ctx.fillText(opts.footer.toUpperCase(), pad, h - pad * 0.9);
    setTracking(ctx, 0);
  }
  return finishTexture(key, canvas);
}

export interface MenuTextureOptions {
  title: string;
  /** Up to ~7 lines; each may be `[label, price]`. */
  lines: Array<[string, string] | string>;
  brand: BrandPalette;
  /** Small line under the title (e.g. "Open until 11 PM"). */
  note?: string;
  width?: number;
  height?: number;
  maxTextureSize?: number;
}

/** A lit menu board: brand panel, a bright header band, items with dotted leaders to prices. */
export function makeMenuTexture(opts: MenuTextureOptions): THREE.CanvasTexture {
  const width = opts.width ?? 512;
  const height = opts.height ?? 640;
  const [w, h] = cappedSize(width, height, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const flat = opts.lines.map((l) => (Array.isArray(l) ? l.join("=") : l)).join("|");
  const key = `menu|${opts.title}|${opts.note ?? ""}|${flat}|${brand.primary}|${brand.secondary}|${brand.accent}|${brand.onPrimary}|${w}x${h}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(w, h);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const panel = mixHex(brand.primary, "#000000", 0.22);
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
  const lit = ctx.createLinearGradient(0, 0, 0, h);
  lit.addColorStop(0, "rgba(255,255,255,0.1)");
  lit.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = lit;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, hashString(key), 0.03, 0.05);
  const fg = inkOn(panel, brand);
  const pad = w * 0.08;
  // Header band in the brand's secondary colour.
  const headerH = h * 0.14;
  ctx.fillStyle = brand.secondary;
  ctx.fillRect(0, 0, w, headerH);
  const headerInk = inkOn(brand.secondary, brand);
  drawFittedText(ctx, opts.title.toUpperCase(), w / 2, headerH * 0.5, w - pad * 2, headerH * 0.42, 800, headerInk, 0.16);
  ctx.strokeStyle = rgba(brand.accent, 0.5);
  ctx.lineWidth = Math.max(2, w * 0.006);
  roundRect(ctx, pad * 0.45, headerH + pad * 0.4, w - pad * 0.9, h - headerH - pad * 0.85, w * 0.015);
  ctx.stroke();
  let top = headerH + pad * 0.9;
  if (opts.note) {
    drawFittedText(ctx, opts.note, w / 2, top + h * 0.025, w - pad * 2, h * 0.04, 500, rgba(fg, 0.7));
    top += h * 0.07;
  }
  const rows = opts.lines.slice(0, 7);
  const rowH = (h - top - pad) / Math.max(rows.length, 4);
  const lineSize = Math.min(rowH * 0.42, h * 0.05);
  rows.forEach((row, i) => {
    const y = top + rowH * i + rowH / 2;
    const label = Array.isArray(row) ? row[0] : row;
    const price = Array.isArray(row) ? row[1] : "";
    ctx.textBaseline = "middle";
    ctx.font = font(700, lineSize);
    const priceW = price ? ctx.measureText(price).width : 0;
    const labelMax = w - pad * 2 - priceW - (price ? w * 0.08 : 0);
    const size = fitFontSize(measurer(ctx, 500), label, labelMax, lineSize);
    ctx.font = font(500, size);
    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    ctx.fillText(label, pad, y);
    const labelW = ctx.measureText(label).width;
    if (price) {
      // Dotted leader between the item and its price.
      ctx.fillStyle = rgba(fg, 0.3);
      const dot = Math.max(1, w * 0.004);
      for (let x = pad + labelW + w * 0.025; x < w - pad - priceW - w * 0.02; x += dot * 3.2) ctx.fillRect(x, y + size * 0.3, dot, dot);
      ctx.font = font(700, lineSize);
      ctx.textAlign = "right";
      ctx.fillStyle = brand.accent;
      ctx.fillText(price, w - pad, y);
    }
  });
  return finishTexture(key, canvas);
}

export interface InitialTextureOptions {
  /** Name whose initials become the mark. */
  label: string;
  brand: BrandPalette;
  size?: number;
  maxTextureSize?: number;
  /** Small caption under the mark (e.g. a product title). */
  caption?: string;
  /** Letters in the mark (default 2: "Ember & Oak" → "EO"). */
  letters?: number;
}

/**
 * Branded fallback card: brand gradient with a centred monogram ring, mirroring the UI's
 * ProductImage fallback. Used for missing logos and product images that fail to load.
 */
export function makeInitialTexture(opts: InitialTextureOptions): THREE.CanvasTexture {
  const size = Math.min(opts.size ?? 256, opts.maxTextureSize ?? 1024);
  const { brand } = opts;
  const mark = monogram(opts.label, opts.letters ?? 2);
  const key = `initial|${mark}|${opts.caption ?? ""}|${brand.primary}|${brand.secondary}|${brand.accent}|${size}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = createSurface(size, size);
  if (!surface) return finishTexture(key, null);
  const { canvas, ctx } = surface;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, brand.primary);
  g.addColorStop(1, mixHex(brand.primary, brand.secondary, 0.65));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.5);
  glow.addColorStop(0, rgba(brand.accent, 0.22));
  glow.addColorStop(1, rgba(brand.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const ink = inkOn(brand.primary, brand);
  const cy = opts.caption ? size * 0.44 : size * 0.5;
  ctx.strokeStyle = rgba(brand.accent, 0.9);
  ctx.lineWidth = Math.max(2, size * 0.014);
  ctx.beginPath();
  ctx.arc(size / 2, cy, size * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  drawFittedText(ctx, mark, size / 2, cy + size * 0.01, size * 0.46, size * 0.3, 800, ink, 0.02);
  if (opts.caption) {
    drawFittedText(ctx, opts.caption, size / 2, size * 0.86, size * 0.82, size * 0.075, 600, rgba(ink, 0.85));
  }
  return finishTexture(key, canvas);
}

/** Frees every cached canvas texture (used when the WebGL context is torn down). */
export function disposeSignageCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
