import * as THREE from "three";
import type { BrandPalette, StorefrontConfig } from "@/types/domain";
import { mulberry32, hashString } from "@/engine/environment/prng";
import { getDuskEnvMap } from "@/engine/environment/atmosphere";
import { mixHex, rgba } from "./signage";

/**
 * Façade materials per `storefrontConfig.facade`, tinted by the brand palette and cached by key
 * so every building with the same look shares one material and one small procedural texture.
 * Each texture represents a fixed physical square (`FACADE_TILE_M`), and building shells scale
 * their UVs to match (`tiledBox`), so bricks and panels stay life-size on any building.
 */
export type Facade = StorefrontConfig["facade"];

/** Metres covered by one repeat of each façade texture. */
export const FACADE_TILE_M: Record<Facade, number> = {
  brick: 3.0,
  plaster: 4.0,
  glass: 3.6,
  concrete: 4.8,
  wood: 2.7,
  tile: 2.4,
};

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
    // 3 m tile: 14 stretchers of ~0.21 m across, 40 courses of ~0.075 m up.
    const cols = 14;
    const rows = 40;
    const bw = s / cols;
    const bh = s / rows;
    const joint = Math.max(1, s * 0.004);
    ctx.fillStyle = mixHex(base, "#d9cfc3", 0.55); // light mortar
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : bw / 2;
      for (let c = -1; c <= cols; c++) {
        const v = rand();
        const shade = (v - 0.5) * 0.3;
        // One brick in twelve is a darker flashed header; one in twenty is pale.
        const tone = v > 0.92 ? mixHex(base, "#2a1a14", 0.45) : v < 0.05 ? mixHex(base, "#e8d5c4", 0.35) : mixHex(base, shade > 0 ? "#ffffff" : "#000000", Math.abs(shade));
        ctx.fillStyle = tone;
        ctx.fillRect(c * bw + offset + joint, r * bh + joint, bw - joint * 2, bh - joint * 2);
        // Shadow line under each brick reads as relief even before the bump map.
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(c * bw + offset + joint, r * bh + bh - joint * 2.4, bw - joint * 2, joint * 1.2);
      }
    }
    // Damp stain creeping up from the bottom courses.
    const stain = ctx.createLinearGradient(0, s, 0, s * 0.72);
    stain.addColorStop(0, "rgba(20,14,10,0.28)");
    stain.addColorStop(1, "rgba(20,14,10,0)");
    ctx.fillStyle = stain;
    ctx.fillRect(0, s * 0.7, s, s * 0.3);
    noise(ctx, s, 7, 0.06, 0.06);
  });
}

export function plasterTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`plaster|${base}|${size}`, size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 11, 0.14, 0.045);
    const rand = mulberry32(13);
    // Trowel sweeps.
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = s * 0.03;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(rand() * s, rand() * s);
      ctx.quadraticCurveTo(rand() * s, rand() * s, rand() * s, rand() * s);
      ctx.stroke();
    }
    // Soft weathering blotches and two hairline cracks.
    for (let i = 0; i < 5; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const r = s * (0.08 + rand() * 0.14);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(40,30,20,0.09)");
      g.addColorStop(1, "rgba(40,30,20,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = Math.max(1, s * 0.002);
    for (let i = 0; i < 2; i++) {
      let x = rand() * s;
      let y = rand() * s * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rand() - 0.5) * s * 0.08;
        y += rand() * s * 0.09;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function concreteTexture(base: string, size: number): THREE.CanvasTexture | null {
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

/**
 * Curtain wall at night: dark reflective panes in a mullion grid, a scatter of lit floors behind
 * them (warm and cool, seeded by the brand so a building is lit the same way every visit) and a
 * faint diagonal sky reflection. Used as both colour and emissive map.
 */
function glassTexture(base: string, accent: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`glass|${base}|${accent}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(hashString(base + accent));
    const cols = 4;
    const rows = 3;
    const pw = s / cols;
    const ph = s / rows;
    ctx.fillStyle = "#0a1119";
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = rand();
        // ~40% of panes are lit; most warm, some cool office light; the rest reflect the sky.
        let fill: string;
        if (v < 0.28) fill = mixHex("#f2c98a", base, 0.25 + rand() * 0.2);
        else if (v < 0.4) fill = mixHex("#9fc0ff", base, 0.35);
        else fill = mixHex("#0d1824", base, 0.15 + rand() * 0.2);
        ctx.fillStyle = fill;
        ctx.fillRect(c * pw + 2, r * ph + 2, pw - 4, ph - 4);
        if (v < 0.4) {
          // Silhouette of a ceiling line and something standing in the room.
          ctx.fillStyle = "rgba(0,0,0,0.28)";
          ctx.fillRect(c * pw + 2, r * ph + 2, pw - 4, ph * 0.12);
          ctx.fillRect(c * pw + pw * (0.2 + rand() * 0.5), r * ph + ph * 0.45, pw * 0.12, ph * 0.55);
        } else {
          const sheen = ctx.createLinearGradient(c * pw, r * ph + ph, c * pw + pw, r * ph);
          sheen.addColorStop(0, "rgba(255,255,255,0)");
          sheen.addColorStop(0.5, "rgba(255,255,255,0.06)");
          sheen.addColorStop(1, "rgba(255,255,255,0.14)");
          ctx.fillStyle = sheen;
          ctx.fillRect(c * pw + 2, r * ph + 2, pw - 4, ph - 4);
        }
      }
    }
    // Mullions and a thin accent spandrel band at each floor line.
    ctx.fillStyle = "#1c2129";
    for (let c = 0; c <= cols; c++) ctx.fillRect(c * pw - 2, 0, 4, s);
    for (let r = 0; r <= rows; r++) ctx.fillRect(0, r * ph - 3, s, 6);
    ctx.fillStyle = rgba(accent, 0.35);
    for (let r = 0; r <= rows; r++) ctx.fillRect(0, r * ph - 1, s, 2);
  });
}

/**
 * The colour map doubles as a bump map: mortar, grout and plank joints are darker than their
 * surfaces, so luminance is a usable height field. Skipped on the low tier (512 px textures).
 */
function relief(material: THREE.MeshStandardMaterial, scale: number, maxTextureSize: number): void {
  if (!material.map || maxTextureSize < 1024) return;
  material.bumpMap = material.map;
  material.bumpScale = scale;
}

/** Tinted, cached façade material. Texture size is capped by the quality tier. */
export function getFacadeMaterial(facade: Facade, brand: BrandPalette, maxTextureSize: number): THREE.MeshStandardMaterial {
  const size = Math.min(512, maxTextureSize);
  const key = `${facade}|${brand.primary}|${brand.secondary}|${brand.accent}|${size}|${maxTextureSize >= 1024 ? "r" : ""}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  let material: THREE.MeshStandardMaterial;
  switch (facade) {
    case "brick": {
      const base = mixHex("#8a4a38", brand.secondary, 0.18);
      material = new THREE.MeshStandardMaterial({ color: "#e4d6cc", map: brickTexture(base, size), roughness: 0.94, metalness: 0 });
      if (!material.map) material.color.set(base);
      relief(material, 0.03, maxTextureSize);
      break;
    }
    case "plaster": {
      const base = mixHex(brand.primary, "#d8cec1", 0.5);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: plasterTexture(base, size), roughness: 0.96, metalness: 0 });
      if (!material.map) material.color.set(base);
      relief(material, 0.012, maxTextureSize);
      break;
    }
    case "glass": {
      const map = glassTexture(brand.primary, brand.accent, size);
      material = new THREE.MeshStandardMaterial({
        color: map ? "#ffffff" : "#0c1622",
        map,
        emissiveMap: map,
        emissive: new THREE.Color(map ? "#ffffff" : "#3b2a16"),
        emissiveIntensity: map ? 0.55 : 0.45,
        roughness: 0.22,
        metalness: 0.65,
        envMap: getDuskEnvMap(),
        envMapIntensity: 0.8,
      });
      break;
    }
    case "concrete": {
      const base = mixHex("#8d9096", brand.primary, 0.12);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: concreteTexture(base, size), roughness: 0.88, metalness: 0.02 });
      if (!material.map) material.color.set(base);
      relief(material, 0.02, maxTextureSize);
      break;
    }
    case "wood": {
      const base = mixHex("#6e4628", brand.secondary, 0.12);
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: woodTexture(base, size), roughness: 0.7, metalness: 0 });
      if (!material.map) material.color.set(base);
      relief(material, 0.025, maxTextureSize);
      break;
    }
    case "tile": {
      const base = brand.secondary;
      material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tileTexture(base, size), roughness: 0.28, metalness: 0.08 });
      if (!material.map) material.color.set(base);
      relief(material, 0.02, maxTextureSize);
      break;
    }
  }
  materialCache.set(key, material);
  return material;
}

/**
 * Corrugated steel for pop-up containers: vertical ribs with a highlight and a shadow edge per
 * rib, tinted in the brand colour. 1 tile = 2 m.
 */
export function corrugatedTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`corrugated|${base}|${size}`, size, (ctx, s) => {
    const ribs = 10;
    const w = s / ribs;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < ribs; i++) {
      const x = i * w;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "rgba(0,0,0,0.38)");
      g.addColorStop(0.3, "rgba(255,255,255,0.14)");
      g.addColorStop(0.55, "rgba(255,255,255,0.02)");
      g.addColorStop(0.8, "rgba(0,0,0,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, s);
    }
    noise(ctx, s, 61, 0.05, 0.05);
    // Scuffs near the bottom edge.
    const scuff = ctx.createLinearGradient(0, s, 0, s * 0.8);
    scuff.addColorStop(0, "rgba(30,25,20,0.3)");
    scuff.addColorStop(1, "rgba(30,25,20,0)");
    ctx.fillStyle = scuff;
    ctx.fillRect(0, s * 0.78, s, s * 0.22);
  });
}

/** Cached corrugated-steel material in a brand colour. */
export function getCorrugatedMaterial(color: string, maxTextureSize: number): THREE.MeshStandardMaterial {
  const size = Math.min(512, maxTextureSize);
  const key = `corrugated|${color}|${size}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", map: corrugatedTexture(color, size), roughness: 0.55, metalness: 0.45 });
  if (!material.map) material.color.set(color);
  relief(material, 0.04, maxTextureSize);
  materialCache.set(key, material);
  return material;
}

/** Terrazzo: a pale ground with coloured chips, for premium retail floors. 1 tile = 2 m. */
export function terrazzoTexture(base: string, chip: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`terrazzo|${base}|${chip}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(hashString(base + chip));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 67, 0.08, 0.035);
    const palette = [chip, mixHex(chip, "#000000", 0.4), "#2a2622", mixHex(base, "#ffffff", 0.3), mixHex(chip, "#ffffff", 0.4)];
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = palette[Math.floor(rand() * palette.length)]!;
      const x = rand() * s;
      const y = rand() * s;
      const r = s * (0.004 + rand() * 0.012);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      for (let k = 1; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const rr = r * (0.6 + rand() * 0.6);
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Large matte tiles with thin grout, for restaurant floors. 1 tile = 2.4 m. */
export function floorTileTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`floortile|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(71);
    const n = 4;
    const t = s / n;
    ctx.fillStyle = mixHex(base, "#000000", 0.5);
    ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = (rand() - 0.5) * 0.1;
        ctx.fillStyle = mixHex(base, tone > 0 ? "#ffffff" : "#000000", Math.abs(tone));
        ctx.fillRect(c * t + 2, r * t + 2, t - 4, t - 4);
      }
    }
    noise(ctx, s, 73, 0.1, 0.04);
  });
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
    const dash = s / 2;
    for (let x = 0; x < s; x += dash) ctx.fillRect(x + dash * 0.1, s / 2 - s * 0.01, dash * 0.4, s * 0.02);
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

/** Horizontal floorboards for interiors. */
export function plankTexture(base: string, size: number): THREE.CanvasTexture | null {
  return patternTexture(`plank|${base}|${size}`, size, (ctx, s) => {
    const rand = mulberry32(59);
    const rows = 10;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const tone = (rand() - 0.5) * 0.26;
      ctx.fillStyle = mixHex(base, tone > 0 ? "#ffffff" : "#000000", Math.abs(tone));
      ctx.fillRect(0, r * h, s, h);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, r * h, s, 2);
      // Board ends at staggered positions.
      const cut = ((r * 0.37 + rand() * 0.2) % 1) * s;
      ctx.fillRect(cut, r * h, 2, h);
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {
        const y = r * h + 3 + rand() * (h - 6);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.33, y + (rand() - 0.5) * 4, s * 0.66, y + (rand() - 0.5) * 4, s, y + (rand() - 0.5) * 3);
        ctx.stroke();
      }
    }
  });
}
