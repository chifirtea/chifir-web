import * as THREE from "three";
import type { BrandPalette } from "@/types/domain";
import { luminance, signageFontFamily } from "@/engine/storefront/signage";
import type { ScreenMode } from "./eventStage";

/**
 * Canvas layers for the Event Square LED screen: a transparent overlay (chips, countdown, title)
 * redrawn at most once a second, and a scrolling ticker strip. The hero image or video sits on
 * its own plane behind the overlay so a 1 Hz redraw never re-uploads the picture.
 */

export const SCREEN_W = 1024;
export const SCREEN_H = 576;

export interface ScreenState {
  mode: ScreenMode;
  title: string;
  /** Who or where: merchant name for an event, district name when idle. */
  eyebrow: string;
  /** "00:14:59" during a countdown. */
  countdown: string;
  /** "Tonight · 8:00 PM" during a countdown, "until 10:00 PM" while live. */
  when: string;
  brand: BrandPalette;
  livestream: boolean;
  /** Idle copy under the district name. */
  tagline: string;
}

function font(weight: number, size: number): string {
  return `${weight} ${Math.round(size)}px ${signageFontFamily()}`;
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, maxSize: number, maxWidth: number): number {
  let size = maxSize;
  ctx.font = font(weight, size);
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = font(weight, size);
  }
  return size;
}

/** Draws the overlay for `state` onto a transparent canvas. */
export function drawScreenOverlay(ctx: CanvasRenderingContext2D, state: ScreenState): void {
  const w = SCREEN_W;
  const h = SCREEN_H;
  ctx.clearRect(0, 0, w, h);
  const pad = w * 0.045;
  const fg = luminance(state.brand.primary) > 0.5 ? state.brand.primary : "#ffffff";
  const accent = state.brand.accent;

  // Legibility scrims: a soft band at the top and a heavier one at the bottom.
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.35);
  top.addColorStop(0, "rgba(0,0,0,0.55)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.35);
  const bottom = ctx.createLinearGradient(0, h * 0.5, 0, h);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);

  ctx.textBaseline = "middle";
  if (state.mode === "idle") {
    ctx.textAlign = "center";
    ctx.fillStyle = accent;
    ctx.font = font(700, h * 0.05);
    ctx.fillText(state.eyebrow.toUpperCase(), w / 2, h * 0.4);
    ctx.fillStyle = fg;
    fitText(ctx, state.title, 800, h * 0.16, w * 0.8);
    ctx.fillText(state.title, w / 2, h * 0.53);
    ctx.fillStyle = rgba(fg, 0.75);
    fitText(ctx, state.tagline, 500, h * 0.055, w * 0.8);
    ctx.fillText(state.tagline, w / 2, h * 0.66);
    return;
  }

  // Top-left chip: "● LIVE" or the merchant eyebrow.
  ctx.textAlign = "left";
  if (state.mode === "live") {
    const chipW = w * 0.14;
    const chipH = h * 0.085;
    pill(ctx, pad, pad, chipW, chipH, "#e5263a");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(pad + chipH * 0.55, pad + chipH / 2, chipH * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font(800, chipH * 0.56);
    ctx.fillText("LIVE", pad + chipH * 0.95, pad + chipH / 2 + 1);
    ctx.fillStyle = rgba(fg, 0.9);
    ctx.font = font(700, h * 0.045);
    ctx.fillText(state.eyebrow.toUpperCase(), pad + chipW + pad * 0.6, pad + chipH / 2);
  } else {
    ctx.fillStyle = accent;
    ctx.font = font(700, h * 0.05);
    ctx.fillText(`${state.eyebrow.toUpperCase()}  ·  STARTS IN`, pad, pad + h * 0.03);
  }

  if (state.mode === "countdown") {
    // The countdown dominates: a translucent band with huge tabular digits.
    const bandH = h * 0.34;
    const bandY = h * 0.28;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, bandY, w, bandH);
    ctx.fillStyle = accent;
    ctx.fillRect(0, bandY, w * 0.012, bandH);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    const size = fitText(ctx, state.countdown, 800, h * 0.3, w * 0.86);
    ctx.font = font(800, size);
    ctx.fillText(state.countdown, w / 2, bandY + bandH / 2 + size * 0.04);
    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    fitText(ctx, state.title, 800, h * 0.1, w * 0.62);
    ctx.fillText(state.title, pad, h * 0.8);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(fg, 0.85);
    ctx.font = font(600, h * 0.05);
    ctx.fillText(state.when, w - pad, h * 0.8);
    return;
  }

  // Live: OPEN NOW, the title, and a livestream placeholder when a stream URL exists.
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, h * 0.17);
  ctx.fillText("OPEN NOW", pad, h * 0.6);
  ctx.fillStyle = fg;
  fitText(ctx, state.title, 700, h * 0.085, w * 0.6);
  ctx.fillText(state.title, pad, h * 0.75);
  ctx.textAlign = "right";
  ctx.fillStyle = rgba(fg, 0.85);
  ctx.font = font(600, h * 0.05);
  ctx.fillText(state.when, w - pad, h * 0.75);
  if (state.livestream) {
    const cx = w * 0.82;
    const cy = h * 0.42;
    const r = h * 0.11;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, h * 0.012);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.3, cy - r * 0.45);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = font(700, h * 0.04);
    ctx.fillText("LIVESTREAM", cx, cy + r + h * 0.05);
  }
}

/** A canvas-backed overlay texture sized for the screen; null without a document (SSR). */
export function createOverlay(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas, ctx, texture };
}

/** Repeating "LIVE · title · " strip for the scrolling ticker under the screen. */
export function tickerTexture(text: string, accent: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0b0a0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 4);
  ctx.textBaseline = "middle";
  ctx.font = font(800, 54);
  const unit = `  LIVE   ●   ${text.toUpperCase()}   ●`;
  const unitW = ctx.measureText(unit).width;
  const repeats = Math.max(1, Math.ceil(canvas.width / unitW));
  // Stretch the font slightly so a whole number of units fills the strip and the loop is seamless.
  const scale = canvas.width / (unitW * repeats);
  ctx.save();
  ctx.scale(scale, 1);
  for (let i = 0; i < repeats; i++) {
    const x = i * unitW;
    ctx.fillStyle = "#ff4d5e";
    ctx.fillText("  LIVE", x, canvas.height / 2);
    const liveW = ctx.measureText("  LIVE").width;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(unit.slice("  LIVE".length), x + liveW, canvas.height / 2);
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
