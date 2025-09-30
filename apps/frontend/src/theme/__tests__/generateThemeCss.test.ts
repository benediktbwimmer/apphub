import { describe, expect, it } from 'vitest';
import { foundation, defaultThemeRegistry } from '@apphub/shared/designTokens';
import { generateThemeCss } from '../generateThemeCss';

const css = generateThemeCss({
  foundation,
  themes: defaultThemeRegistry,
  options: { defaultThemeId: 'apphub-light' }
});

describe('generateThemeCss', () => {
  it('includes palette variables on :root', () => {
    expect(css).toContain('--palette-violet-500: #7c3aed;');
    expect(css).toContain('--font-family-sans: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;');
  });

  it('renders selectors for light and dark themes with color-scheme', () => {
    expect(css).toMatch(/:root\[data-theme="apphub-light"\][^}]*color-scheme: light;/);
    expect(css).toMatch(/:root\.dark[^}]*color-scheme: dark;/);
  });

  it('applies semantic color custom properties', () => {
    expect(css).toContain('--color-surface-canvas: #f5f3ff;');
    expect(css).toContain('--color-text-primary: #0f172a;');
    expect(css).toContain('--color-text-primary: #f8fafc;');
  });
});
