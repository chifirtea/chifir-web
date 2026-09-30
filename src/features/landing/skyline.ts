import type { BrandPalette } from "@/types/domain";

/**
 * Deterministic dusk skyline built from the seeded merchants' brand palettes. Pure data so the
 * SVG is identical on every render (no hydration drift) and the whole thing costs no WebGL.
 */

export interface SkylinePalette {
  slug: string;
  name: string;
  brand: BrandPalette;
}

export interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Building {
  id: string;
  x: number;
  w: number;
  h: number;
  facade: string;
  window: string;
  windowOpacity: number;
  /** Unlit patches in absolute coordinates (window-grid aligned). */
  dark: Patch[];
  /** One window that flickers, absolute coordinates. */
  flicker?: { x: number; y: number };
  sign?: { color: string; x: number; y: number; w: number; h: number };
}

export interface Skyline {
  width: number;
  height: number;
  back: Building[];
  front: Building[];
  lamps: number[];
}

export const WINDOW_TILE = { w: 12, h: 16, x: 3, y: 4, ww: 5, wh: 7 } as const;
const NIGHT = "#0f1116";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes `a` toward `b` by `t` (0 = a, 1 = b). Falls back to `a` for non-hex input. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0.5;
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

const FILLER_WINDOWS = ["#ffc46b", "#ffd9a0", "#9fb8ff", "#ffe0b8"];
const FILLER_FACADES = ["#1a1d27", "#1e2130", "#171a22", "#22252f"];

export function buildSkyline(palettes: SkylinePalette[], width = 1440, height = 400): Skyline {
  const random = rng(hashString(palettes.map((p) => p.slug).join("|") || "chifir"));
  const front: Building[] = [];
  const back: Building[] = [];

  // Back row: tall, dim, sparse windows. Gives the front row something to stand against.
  let bx = -20;
  let i = 0;
  while (bx < width + 20) {
    const w = 70 + Math.floor(random() * 90);
    const h = 160 + Math.floor(random() * 140);
    back.push({
      id: `b${i}`,
      x: bx,
      w,
      h,
      facade: mixHex("#1b1e2a", NIGHT, 0.25 + random() * 0.3),
      window: "#c9b8a0",
      windowOpacity: 0.12 + random() * 0.12,
      dark: [],
    });
    bx += w + 2 + Math.floor(random() * 10);
    i += 1;
  }

  // Front row: merchants interleaved with fillers, merchants pulled toward the centre.
  const merchantOrder = [...palettes];
  const slots: Array<SkylinePalette | null> = [];
  const count = Math.max(merchantOrder.length * 2 + 3, 14);
  for (let s = 0; s < count; s++) slots.push(null);
  // Place merchants at alternating slots spreading outward from the middle.
  let offset = 0;
  for (const m of merchantOrder) {
    const idx = Math.floor(count / 2) + (offset % 2 === 0 ? 1 : -1) * Math.ceil(offset / 2) * 2;
    if (idx >= 0 && idx < count && !slots[idx]) slots[idx] = m;
    else {
      const free = slots.findIndex((s) => s === null);
      if (free >= 0) slots[free] = m;
    }
    offset += 1;
  }

  const totalGap = 8;
  const avgW = (width + 60) / count - totalGap;
  let x = -30;
  slots.forEach((slot, s) => {
    const w = Math.round(avgW * (0.7 + random() * 0.6));
    const merchant = slot;
    const h = merchant ? 120 + Math.floor(random() * 110) : 70 + Math.floor(random() * 150);
    const top = height - h;
    let facade: string;
    let window: string;
    let windowOpacity: number;
    if (merchant) {
      const lum = luminance(merchant.brand.primary);
      facade = mixHex(merchant.brand.primary, NIGHT, lum > 0.55 ? 0.7 : 0.35);
      window = merchant.brand.accent;
      windowOpacity = 0.75 + random() * 0.2;
    } else {
      facade = FILLER_FACADES[Math.floor(random() * FILLER_FACADES.length)]!;
      window = FILLER_WINDOWS[Math.floor(random() * FILLER_WINDOWS.length)]!;
      windowOpacity = 0.35 + random() * 0.4;
    }

    // Unlit patches: whole dark floors or columns, aligned to the window grid.
    const cols = Math.max(1, Math.floor((w - 8) / WINDOW_TILE.w));
    const rows = Math.max(1, Math.floor((h - 12) / WINDOW_TILE.h));
    const dark: Patch[] = [];
    const patches = 1 + Math.floor(random() * 3);
    for (let p = 0; p < patches; p++) {
      const vertical = random() < 0.4;
      if (vertical) {
        const c = Math.floor(random() * cols);
        const span = 1 + Math.floor(random() * 2);
        dark.push({
          x: x + 4 + c * WINDOW_TILE.w,
          y: top + 8,
          w: span * WINDOW_TILE.w,
          h: rows * WINDOW_TILE.h,
        });
      } else {
        const r = Math.floor(random() * rows);
        const span = 1 + Math.floor(random() * 2);
        dark.push({
          x: x + 4,
          y: top + 8 + r * WINDOW_TILE.h,
          w: cols * WINDOW_TILE.w,
          h: span * WINDOW_TILE.h,
        });
      }
    }

    const building: Building = {
      id: merchant ? merchant.slug : `f${s}`,
      x,
      w,
      h,
      facade,
      window,
      windowOpacity,
      dark,
    };
    if (random() < 0.45) {
      building.flicker = {
        x: x + 4 + Math.floor(random() * cols) * WINDOW_TILE.w + WINDOW_TILE.x,
        y: top + 8 + Math.floor(random() * rows) * WINDOW_TILE.h + WINDOW_TILE.y,
      };
    }
    if (merchant) {
      const signW = Math.min(w - 16, 24 + merchant.name.length * 5);
      building.sign = {
        color:
          luminance(merchant.brand.accent) > 0.35
            ? merchant.brand.accent
            : merchant.brand.secondary,
        x: x + Math.round((w - signW) / 2),
        y: top + 22,
        w: signW,
        h: 6,
      };
    }
    front.push(building);
    x += w + totalGap;
  });

  const lamps: number[] = [];
  for (let lx = 60; lx < width; lx += 180 + Math.floor(random() * 80)) lamps.push(lx);

  return { width, height, back, front, lamps };
}
