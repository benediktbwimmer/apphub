import { useTheme } from '../theme';

/**
 * Returns whether the currently applied theme is dark.
 *
 * ThemeProvider manages the document classes and data attributes, so consumers
 * can rely on this hook instead of subscribing to `matchMedia` directly.
 */
export function useIsDarkMode(): boolean {
  const { scheme } = useTheme();
  return scheme === 'dark';
}
