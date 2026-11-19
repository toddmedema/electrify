/** The surrounding banks grade down to the basin floor underneath both extremes. */
export const WATERSHED_LEVEL_OFFSETS = [-0.045, -0.0005] as const;
export const WATERSHED_BANK_DEPTH = -0.049;

export function waterLevelOffset(
  [empty, full]: readonly [number, number],
  level?: number,
): number {
  const fraction =
    level !== undefined && Number.isFinite(level)
      ? Math.min(1, Math.max(0, level))
      : 0.5;
  return empty + (full - empty) * fraction;
}
