/**
 * City level math. Mirrors `add_xp` in the migration and `levelForXp` in the static data source:
 *   level = 1 + floor(sqrt(xp / 100))
 * so level 2 starts at 100 XP, level 3 at 400, level 4 at 900, and the next level from `level`
 * is reached at 100 * level^2.
 */
export function levelForXp(xp: number): number {
  const safe = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  return Math.max(1, 1 + Math.floor(Math.sqrt(safe / 100)));
}

/** XP at which `level` begins. */
export function xpAtLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 100 * (l - 1) ** 2;
}

/** XP at which the level after `level` begins. */
export function xpForNextLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 100 * l ** 2;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at which the current level started. */
  levelStartXp: number;
  /** XP at which the next level starts. */
  nextLevelXp: number;
  /** XP still needed to reach the next level. */
  remainingXp: number;
  /** 0..1 progress through the current level. */
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const safe = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  const level = levelForXp(safe);
  const levelStartXp = xpAtLevel(level);
  const nextLevelXp = xpForNextLevel(level);
  const span = nextLevelXp - levelStartXp;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (safe - levelStartXp) / span)) : 0;
  return {
    level,
    xp: safe,
    levelStartXp,
    nextLevelXp,
    remainingXp: Math.max(0, nextLevelXp - safe),
    fraction,
  };
}
