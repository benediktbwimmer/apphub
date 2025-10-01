import type {
  DesignTokenFoundation,
  ThemeDefinition,
  ThemeRegistry
} from '@apphub/shared/designTokens';

export interface GenerateThemeCssOptions {
  readonly defaultThemeId?: string;
}

export interface GenerateThemeCssInput {
  readonly foundation: DesignTokenFoundation;
  readonly themes: ThemeRegistry;
  readonly options?: GenerateThemeCssOptions;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function createPaletteSection(foundation: DesignTokenFoundation): string {
  const lines: string[] = [':root {'];

  const { palette, typography, spacing, radius, shadow } = foundation;

  for (const [paletteName, ramp] of Object.entries(palette)) {
    for (const [stop, value] of Object.entries(ramp)) {
      lines.push(`  --palette-${toKebabCase(paletteName)}-${stop}: ${value};`);
    }
  }

  for (const [token, value] of Object.entries(typography.fontFamily)) {
    lines.push(`  --font-family-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(typography.fontSize)) {
    lines.push(`  --font-size-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(typography.fontWeight)) {
    lines.push(`  --font-weight-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(typography.lineHeight)) {
    lines.push(`  --line-height-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(typography.letterSpacing)) {
    lines.push(`  --letter-spacing-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(spacing)) {
    lines.push(`  --space-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(radius)) {
    lines.push(`  --radius-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(shadow)) {
    lines.push(`  --shadow-${toKebabCase(token)}: ${value};`);
  }

  lines.push('}');

  return lines.join('\n');
}

function createThemeSelectors(theme: ThemeDefinition, includeRootFallback: boolean): string[] {
  const selectors = new Set<string>();

  if (includeRootFallback) {
    selectors.add(':root');
  }

  selectors.add(`:root[data-theme="${theme.id}"]`);
  selectors.add(`:root.theme-${toKebabCase(theme.id)}`);

  if (includeRootFallback) {
    if (theme.scheme === 'dark') {
      selectors.add(':root.theme-dark');
      selectors.add(':root.dark');
    } else {
      selectors.add(':root.theme-light');
    }
  }

  return Array.from(selectors);
}

function createThemeBlock(theme: ThemeDefinition, includeRootFallback: boolean): string {
  const selectors = createThemeSelectors(theme, includeRootFallback).join(',\n');
  const lines: string[] = [`${selectors} {`];

  lines.push(`  color-scheme: ${theme.scheme};`);
  lines.push(`  --theme-id: "${theme.id}";`);
  lines.push(`  --theme-label: "${theme.label}";`);
  lines.push(`  --theme-scale: ${theme.scale};`);

  for (const [token, value] of Object.entries(theme.typography.fontFamily)) {
    lines.push(`  --font-family-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.typography.fontSize)) {
    lines.push(`  --font-size-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.typography.fontWeight)) {
    lines.push(`  --font-weight-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.typography.lineHeight)) {
    lines.push(`  --line-height-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.typography.letterSpacing)) {
    lines.push(`  --letter-spacing-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.spacing)) {
    lines.push(`  --space-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.radius)) {
    lines.push(`  --radius-${toKebabCase(token)}: ${value};`);
  }

  for (const [token, value] of Object.entries(theme.shadow)) {
    lines.push(`  --shadow-${toKebabCase(token)}: ${value};`);
  }

  for (const [group, groupValues] of Object.entries(theme.semantics)) {
    for (const [token, value] of Object.entries(groupValues as Record<string, string>)) {
      lines.push(`  --color-${toKebabCase(group)}-${toKebabCase(token)}: ${value};`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}

export function generateThemeCss({
  foundation,
  themes,
  options
}: GenerateThemeCssInput): string {
  const themeList = Object.values(themes) as ThemeDefinition[];
  const defaultThemeId = options?.defaultThemeId;
  const defaultTheme =
    (defaultThemeId ? themes[defaultThemeId] : undefined) ?? themeList[0];

  if (!defaultTheme) {
    throw new Error('generateThemeCss: no themes provided');
  }

  const sections: string[] = [
    '/* Generated from @apphub/shared/designTokens. Do not edit directly. */',
    createPaletteSection(foundation)
  ];

  const seen = new Set<string>();

  sections.push(createThemeBlock(defaultTheme, true));
  seen.add(defaultTheme.id);

  for (const theme of themeList) {
    if (seen.has(theme.id)) {
      continue;
    }
    sections.push(createThemeBlock(theme, false));
    seen.add(theme.id);
  }

  return `${sections.join('\n\n')}\n`;
}
