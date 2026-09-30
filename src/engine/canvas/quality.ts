export type QualityTier = "low" | "medium" | "high";

/**
 * Everything here can change at runtime without recreating the WebGL context. Context-creation
 * attributes (antialias, powerPreference) are decided once at Canvas mount from the initial tier
 * and form factor, and are deliberately not part of this type.
 */
export interface QualitySettings {
  tier: QualityTier;
  /** Device pixel ratio clamp [min, max]. */
  dpr: [number, number];
  shadows: boolean;
  /** Max shadow map size. */
  shadowMapSize: number;
  postProcessing: boolean;
  /** Distance multiplier for LOD switching (1 = template defaults). */
  lodScale: number;
  /** Ambient prop instance density multiplier. */
  propDensity: number;
  npcCount: number;
  maxTextureSize: 512 | 1024 | 2048;
}

const PRESETS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: "low",
    dpr: [0.75, 1],
    shadows: false,
    shadowMapSize: 512,
    postProcessing: false,
    lodScale: 0.6,
    propDensity: 0.5,
    npcCount: 4,
    maxTextureSize: 512,
  },
  medium: {
    tier: "medium",
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    postProcessing: false,
    lodScale: 1,
    propDensity: 0.8,
    npcCount: 10,
    maxTextureSize: 1024,
  },
  high: {
    tier: "high",
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    postProcessing: true,
    lodScale: 1.4,
    propDensity: 1,
    npcCount: 18,
    maxTextureSize: 2048,
  },
};

/** Preset for a tier, capped for phones (DPR ≤ 1.5, shadow maps ≤ 1024, textures ≤ 1024). */
export function resolvePreset(tier: QualityTier, opts: { mobile: boolean }): QualitySettings {
  const base = PRESETS[tier];
  if (!opts.mobile) return { ...base, dpr: [...base.dpr] as [number, number] };
  return {
    ...base,
    dpr: [Math.min(base.dpr[0], 1), Math.min(base.dpr[1], 1.5)],
    shadowMapSize: Math.min(base.shadowMapSize, 1024),
    maxTextureSize: base.maxTextureSize > 1024 ? 1024 : base.maxTextureSize,
    postProcessing: false,
  };
}

export const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];

export function lowerTier(tier: QualityTier): QualityTier {
  return tier === "high" ? "medium" : "low";
}

export function higherTier(tier: QualityTier): QualityTier {
  return tier === "low" ? "medium" : "high";
}
