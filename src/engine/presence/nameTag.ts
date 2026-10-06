import { CanvasTexture, SpriteMaterial, SRGBColorSpace } from "three";

/**
 * Name tags are canvas textures on sprites: cheap, always camera-facing, no DOM per peer. One
 * material per distinct (name, party) look, reference-counted so a busy evening does not leak
 * textures as people come and go.
 */

const WIDTH = 320;
const HEIGHT = 112;
/** Sprite size in metres for the full canvas; the pill itself is narrower. */
export const TAG_WIDTH_M = 1.6;
export const TAG_HEIGHT_M = (TAG_WIDTH_M * HEIGHT) / WIDTH;

const FOG = "#e9e6df";
const INK = "rgba(15, 17, 22, 0.78)";
export const PARTY_COLOR = "#ffc46b";
const NEUTRAL_CHEVRON = "rgba(233, 230, 223, 0.7)";

interface Entry {
  material: SpriteMaterial;
  refs: number;
}

const cache = new Map<string, Entry>();

function draw(name: string, party: boolean): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.font = `600 34px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textWidth = Math.min(WIDTH - 24, ctx.measureText(name).width);
  const pillW = textWidth + 40;
  const pillH = 56;
  const x = (WIDTH - pillW) / 2;
  const y = 8;
  // Pill.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(x, y, pillW, pillH, pillH / 2);
  ctx.fill();
  if (party) {
    ctx.strokeStyle = PARTY_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // Name, clipped to the pill.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 12, y, pillW - 24, pillH);
  ctx.clip();
  ctx.fillStyle = FOG;
  ctx.fillText(name, WIDTH / 2, y + pillH / 2 + 1);
  ctx.restore();
  // Chevron under the pill pointing at the head; party members get the sodium accent.
  ctx.fillStyle = party ? PARTY_COLOR : NEUTRAL_CHEVRON;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 14, y + pillH + 6);
  ctx.lineTo(WIDTH / 2 + 14, y + pillH + 6);
  ctx.lineTo(WIDTH / 2, y + pillH + 24);
  ctx.closePath();
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

export function acquireNameTag(name: string, party: boolean): SpriteMaterial | null {
  const key = `${party ? "p" : "n"}|${name}`;
  const hit = cache.get(key);
  if (hit) {
    hit.refs += 1;
    return hit.material;
  }
  const map = draw(name, party);
  if (!map) return null;
  const material = new SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  cache.set(key, { material, refs: 1 });
  return material;
}

export function releaseNameTag(name: string, party: boolean): void {
  const key = `${party ? "p" : "n"}|${name}`;
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  cache.delete(key);
  entry.material.map?.dispose();
  entry.material.dispose();
}
