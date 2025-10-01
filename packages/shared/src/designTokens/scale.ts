export const DEFAULT_THEME_SCALE = 1;
export const MIN_THEME_SCALE = 0.7;
export const MAX_THEME_SCALE = 1;

export function clampThemeScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_THEME_SCALE;
  }

  return Math.min(MAX_THEME_SCALE, Math.max(MIN_THEME_SCALE, value));
}
