import type { ReactNode } from "react";
import type { BrandPalette, InteriorTemplateId, StorefrontConfig, StorefrontTemplateId } from "@/types/domain";

/**
 * Colour-block thumbnails of the procedural templates, drawn from the proposal's brand and
 * storefront config. A reviewer's shorthand for "what shape and colour will this be", not a
 * render: the real thing is the city itself after publishing.
 */

const W = 96;
const H = 60;

export function StorefrontPreview({ template, brand, config }: { template: StorefrontTemplateId; brand: BrandPalette; config: StorefrontConfig }) {
  const shape = SHAPES[template];
  const floors = template === "kiosk" || template === "popup" ? 1 : config.floors;
  const bodyH = Math.min(H - 10, shape.base + (floors - 1) * 9);
  const top = H - 4 - bodyH;
  const x = (W - shape.width) / 2;
  const facade = FACADE_TINT[config.facade];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[60px] w-[96px] shrink-0 rounded-lg border border-line bg-night" role="img" aria-label={`${template} storefront preview`}>
      <rect x="0" y={H - 4} width={W} height="4" fill="#2a2e38" />
      <rect x={x} y={top} width={shape.width} height={bodyH} rx={template === "popup" ? 1 : 2} fill={brand.secondary} />
      <rect x={x} y={top} width={shape.width} height={bodyH} fill={facade} opacity="0.35" />
      {/* sign band */}
      <rect x={x + 3} y={top + 3} width={shape.width - 6} height="7" rx="1.5" fill={brand.primary} />
      <rect x={x + 7} y={top + 5.5} width={Math.max(8, shape.width - 22)} height="2" rx="1" fill={brand.onPrimary} opacity="0.9" />
      {config.accentLights ? <rect x={x} y={top + 11} width={shape.width} height="1.2" fill={brand.accent} /> : null}
      {/* windows */}
      {config.windowDisplay !== "none" ? (
        <>
          <rect x={x + 4} y={H - 4 - 16} width={shape.width / 2 - 9} height="11" rx="1" fill="#9fc3ff" opacity={template === "boutique" || template === "flagship" ? 0.55 : 0.35} />
          <rect x={x + shape.width / 2 + 5} y={H - 4 - 16} width={shape.width / 2 - 9} height="11" rx="1" fill="#9fc3ff" opacity={template === "boutique" || template === "flagship" ? 0.55 : 0.35} />
        </>
      ) : null}
      {/* door */}
      <rect x={W / 2 - 3.5} y={H - 4 - 13} width="7" height="13" rx="1" fill={brand.accent} />
      {/* awning */}
      {config.awning && shape.awning ? <path d={`M${x - 2} ${H - 4 - 18} h${shape.width + 4} l-3 5 h-${shape.width - 2} z`} fill={brand.primary} opacity="0.95" /> : null}
      {/* upper floors */}
      {Array.from({ length: Math.max(0, floors - 1) }, (_, i) => (
        <rect key={i} x={x + 6} y={top + 14 + i * 9} width={shape.width - 12} height="4" rx="1" fill="#ffe6b0" opacity="0.35" />
      ))}
    </svg>
  );
}

const SHAPES: Record<StorefrontTemplateId, { width: number; base: number; awning: boolean }> = {
  bistro: { width: 62, base: 30, awning: true },
  "fast-casual": { width: 70, base: 26, awning: true },
  cafe: { width: 54, base: 28, awning: true },
  boutique: { width: 58, base: 34, awning: false },
  flagship: { width: 84, base: 40, awning: false },
  kiosk: { width: 34, base: 22, awning: true },
  popup: { width: 64, base: 26, awning: false },
};

const FACADE_TINT: Record<StorefrontConfig["facade"], string> = {
  brick: "#8a3b2a",
  plaster: "#e9e1d3",
  glass: "#8fb8e8",
  concrete: "#9a9a98",
  wood: "#7a5634",
  tile: "#3d6b74",
};

export function InteriorPreview({ template, brand }: { template: InteriorTemplateId; brand: BrandPalette }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[60px] w-[96px] shrink-0 rounded-lg border border-line bg-night" role="img" aria-label={`${template} interior preview`}>
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="3" fill="#1d2129" stroke={brand.secondary} strokeWidth="1.5" />
      {INTERIOR_LAYOUT[template](brand)}
    </svg>
  );
}

const INTERIOR_LAYOUT: Record<InteriorTemplateId, (b: BrandPalette) => ReactNode> = {
  "restaurant-counter": (b) => (
    <>
      <rect x="12" y="12" width={W - 24} height="8" rx="2" fill={b.primary} />
      {[20, 36, 52, 68].map((x) => (
        <circle key={x} cx={x + 4} cy="28" r="3" fill={b.accent} />
      ))}
      <rect x="14" y="38" width="20" height="10" rx="2" fill={b.secondary} />
      <rect x="62" y="38" width="20" height="10" rx="2" fill={b.secondary} />
    </>
  ),
  "restaurant-dining": (b) => (
    <>
      {[16, 40, 64].flatMap((x) =>
        [16, 36].map((y) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="14" height="10" rx="2" fill={b.primary} />
            <circle cx={x + 7} cy={y + 5} r="2" fill={b.accent} />
          </g>
        )),
      )}
    </>
  ),
  "retail-racks": (b) => (
    <>
      {[14, 34, 54, 74].map((x) => (
        <rect key={x} x={x} y="14" width="8" height="32" rx="2" fill={b.primary} />
      ))}
      <rect x="40" y="42" width="16" height="6" rx="1.5" fill={b.accent} />
    </>
  ),
  "retail-gallery": (b) => (
    <>
      <rect x="10" y="10" width={W - 20} height="5" rx="1" fill={b.primary} />
      <rect x="10" y="10" width="5" height={H - 20} rx="1" fill={b.primary} />
      <rect x={W - 15} y="10" width="5" height={H - 20} rx="1" fill={b.primary} />
      <rect x="38" y="28" width="20" height="12" rx="2" fill={b.accent} />
    </>
  ),
  "popup-gallery": (b) => (
    <>
      <rect x="10" y="10" width={W - 20} height="5" rx="1" fill={b.accent} />
      {[22, 42, 62].map((x) => (
        <rect key={x} x={x} y="26" width="12" height="14" rx="2" fill={b.primary} />
      ))}
    </>
  ),
};
