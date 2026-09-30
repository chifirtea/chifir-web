import { buildSkyline, WINDOW_TILE, type SkylinePalette } from "./skyline";
import styles from "./landing.module.css";

/**
 * CSS/SVG-only dusk skyline of the actual seeded city. Each merchant is a building in its brand
 * colours with a lit sign; fillers sit between them. No WebGL on the landing page.
 */
export function Skyline({ palettes, className }: { palettes: SkylinePalette[]; className?: string }) {
  const sky = buildSkyline(palettes);
  const { width, height } = sky;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {sky.front.map((b) => (
          <pattern
            key={b.id}
            id={`w-${b.id}`}
            width={WINDOW_TILE.w}
            height={WINDOW_TILE.h}
            patternUnits="userSpaceOnUse"
            x={b.x + 4}
            y={height - b.h + 8}
          >
            <rect x={WINDOW_TILE.x} y={WINDOW_TILE.y} width={WINDOW_TILE.ww} height={WINDOW_TILE.wh} fill={b.window} opacity={b.windowOpacity} />
          </pattern>
        ))}
        <pattern id="w-back" width={WINDOW_TILE.w} height={WINDOW_TILE.h} patternUnits="userSpaceOnUse">
          <rect x={WINDOW_TILE.x} y={WINDOW_TILE.y} width={WINDOW_TILE.ww} height={WINDOW_TILE.wh} fill="#d8c8ac" />
        </pattern>
        <radialGradient id="lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffc46b" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#ffc46b" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ffc46b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="signglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* A slow light crossing the sky. */}
      <g className={styles.drift}>
        <circle cx="0" cy="44" r="1.8" fill="#ffffff" opacity="0.9" />
        <circle cx="10" cy="45" r="1.2" fill="#ff6b6b" opacity="0.8" />
      </g>

      {/* Back row */}
      {sky.back.map((b) => (
        <g key={b.id}>
          <rect x={b.x} y={height - b.h} width={b.w} height={b.h} fill={b.facade} />
          <rect x={b.x + 4} y={height - b.h + 10} width={b.w - 8} height={b.h - 10} fill="url(#w-back)" opacity={b.windowOpacity} />
        </g>
      ))}

      {/* Front row */}
      {sky.front.map((b) => {
        const top = height - b.h;
        return (
          <g key={b.id}>
            <rect x={b.x} y={top} width={b.w} height={b.h} fill={b.facade} />
            <rect x={b.x} y={top} width={b.w} height={3} fill="#ffffff" opacity="0.06" />
            <rect x={b.x + 4} y={top + 8} width={b.w - 8} height={b.h - 8} fill={`url(#w-${b.id})`} />
            {b.dark.map((d, i) => (
              <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h} fill={b.facade} />
            ))}
            {b.flicker ? (
              <rect className={styles.flicker} x={b.flicker.x} y={b.flicker.y} width={WINDOW_TILE.ww} height={WINDOW_TILE.wh} fill={b.window} />
            ) : null}
            {b.sign ? (
              <g>
                <ellipse
                  className={styles.signGlow}
                  cx={b.sign.x + b.sign.w / 2}
                  cy={b.sign.y + b.sign.h / 2}
                  rx={b.sign.w * 0.9}
                  ry={26}
                  fill={b.sign.color}
                  opacity="0.5"
                  style={{ mixBlendMode: "screen" }}
                />
                <rect x={b.sign.x} y={b.sign.y} width={b.sign.w} height={b.sign.h} rx={2} fill={b.sign.color} />
                <rect x={b.sign.x + 2} y={b.sign.y + 1.5} width={b.sign.w - 4} height={1.5} rx={1} fill="url(#signglow)" />
              </g>
            ) : null}
          </g>
        );
      })}

      {/* Street: a dark road strip and sodium lamps. */}
      <rect x="0" y={height - 12} width={width} height={12} fill="#0b0c10" />
      {sky.lamps.map((lx) => (
        <g key={lx}>
          <ellipse cx={lx} cy={height - 10} rx="70" ry="26" fill="url(#lamp)" />
          <rect x={lx - 1} y={height - 46} width={2} height={36} fill="#2a2d38" />
          <circle cx={lx} cy={height - 47} r="2.5" fill="#ffd9a0" />
        </g>
      ))}
    </svg>
  );
}
