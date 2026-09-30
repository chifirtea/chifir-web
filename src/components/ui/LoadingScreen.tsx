"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import styles from "./LoadingScreen.module.css";

const TIPS = [
  "Walk into any store to see the menu",
  "Ask the concierge for anything under a budget",
  "Every promotion in the city is a real one",
  "Tonight's events are under Places",
];

const TIP_INTERVAL_MS = 3500;

export interface LoadingScreenProps {
  label?: string;
  /** 0–100. Leave undefined for an indeterminate shimmer. */
  progress?: number;
  /** Fades the screen out; unmount it after the transition. */
  hidden?: boolean;
}

/** Full-screen night sky with a silhouette of the city, the wordmark, and one rotating tip. */
export function LoadingScreen({
  label = "Loading the city",
  progress,
  hidden = false,
}: LoadingScreenProps) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), TIP_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);
  const pct = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));

  return (
    <div
      data-loading-screen=""
      data-hidden={hidden ? "true" : "false"}
      role="status"
      aria-live="polite"
      aria-hidden={hidden}
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-night text-fog transition-opacity duration-500 ease-out",
        hidden && "pointer-events-none opacity-0",
      )}
      style={{
        backgroundImage:
          "radial-gradient(90% 55% at 50% 100%, rgba(255,196,107,0.18), transparent 65%), linear-gradient(180deg, #0f1116 0%, #14172a 55%, #2a2136 100%)",
      }}
    >
      <Silhouette />
      <div className="relative z-10 flex flex-col items-center px-4 text-center">
        <div className="eyebrow">the city</div>
        <div className="font-display mt-1 text-5xl font-bold tracking-tight">Chifir</div>
        <div
          className="mt-7 h-[3px] w-56 overflow-hidden rounded-full bg-white/10"
          aria-hidden="true"
        >
          {pct === undefined ? (
            <div className={styles.shimmer} />
          ) : (
            <div
              className="h-full rounded-full bg-sodium transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <p className="mt-4 text-[14px] text-fog-2">
          {label}
          {pct !== undefined ? (
            <span className="tabular text-fog-3"> · {Math.round(pct)}%</span>
          ) : null}
        </p>
        <p key={tip} className={cn("mt-1 text-[13px] text-fog-3", styles.tip)}>
          {TIPS[tip]}
        </p>
      </div>
    </div>
  );
}

// A generic skyline (no merchant data): the landing page draws the real one.
const BUILDINGS: Array<[x: number, w: number, h: number]> = [
  [0, 90, 120],
  [96, 60, 180],
  [162, 110, 90],
  [280, 70, 220],
  [356, 120, 140],
  [484, 80, 260],
  [570, 100, 110],
  [678, 64, 190],
  [748, 140, 150],
  [896, 76, 240],
  [980, 110, 100],
  [1098, 90, 170],
  [1196, 130, 130],
  [1334, 106, 200],
];

function Silhouette() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] min-h-[180px] w-full"
      viewBox="0 0 1440 300"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <pattern id="ls-w" width="14" height="18" patternUnits="userSpaceOnUse">
          <rect x="4" y="5" width="5" height="7" fill="#ffc46b" opacity="0.5" />
        </pattern>
      </defs>
      <g className={styles.drift}>
        <circle cx="0" cy="40" r="1.8" fill="#fff" opacity="0.9" />
        <circle cx="9" cy="41" r="1.2" fill="#ff6b6b" opacity="0.8" />
      </g>
      {BUILDINGS.map(([x, w, h], i) => (
        <g key={i}>
          <rect x={x} y={300 - h} width={w} height={h} fill={i % 3 === 0 ? "#171a23" : "#1c2030"} />
          <rect
            x={x + 4}
            y={300 - h + 8}
            width={w - 8}
            height={h - 8}
            fill="url(#ls-w)"
            opacity={i % 2 ? 0.35 : 0.55}
          />
          {i % 4 === 1 ? (
            <rect
              x={x + 8}
              y={300 - h + 12}
              width={5}
              height={7}
              fill="#ffc46b"
              className={styles.flicker}
            />
          ) : null}
        </g>
      ))}
      <rect x="0" y="288" width="1440" height="12" fill="#0b0c10" />
    </svg>
  );
}
