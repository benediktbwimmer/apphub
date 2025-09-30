import { foundation } from './foundation';
import { deepFreeze, mergeThemeObject } from './utils';
import type { CreateThemeOptions, ThemeDefinition, ThemeRegistry, ThemeOverride } from './types';

const { palette, typography, spacing, radius, shadow } = foundation;

const lightSemantics = {
  surface: {
    canvas: palette.violet[50],
    canvasMuted: palette.slate[100],
    raised: '#ffffff',
    sunken: palette.slate[50],
    accent: palette.violet[100],
    backdrop: 'rgba(15, 23, 42, 0.5)'
  },
  text: {
    primary: palette.slate[900],
    secondary: palette.slate[700],
    muted: palette.slate[600],
    inverse: palette.slate[50],
    accent: palette.violet[500],
    onAccent: palette.violet[50],
    success: palette.emerald[600],
    warning: palette.amber[700],
    danger: palette.rose[600]
  },
  border: {
    subtle: palette.slate[200],
    default: palette.slate[300],
    strong: palette.slate[400],
    accent: palette.violet[400],
    focus: 'rgba(139, 92, 246, 0.55)',
    inverse: 'rgba(248, 250, 252, 0.35)'
  },
  status: {
    info: palette.blue[500],
    infoOn: palette.slate[50],
    success: palette.emerald[500],
    successOn: palette.slate[50],
    warning: palette.amber[500],
    warningOn: palette.slate[900],
    danger: palette.rose[500],
    dangerOn: palette.slate[50],
    neutral: palette.slate[400],
    neutralOn: palette.slate[900]
  },
  overlay: {
    hover: 'rgba(124, 58, 237, 0.08)',
    pressed: 'rgba(124, 58, 237, 0.18)',
    scrim: 'rgba(15, 23, 42, 0.45)'
  },
  accent: {
    default: palette.violet[500],
    emphasis: palette.indigo[700],
    muted: palette.violet[100],
    onAccent: palette.violet[50]
  }
} as const;

const darkSemantics = {
  surface: {
    canvas: '#0f0a1a',
    canvasMuted: '#111827',
    raised: '#1f2937',
    sunken: '#05010d',
    accent: 'rgba(124, 58, 237, 0.18)',
    backdrop: 'rgba(5, 1, 13, 0.7)'
  },
  text: {
    primary: palette.slate[50],
    secondary: palette.slate[200],
    muted: palette.slate[400],
    inverse: palette.slate[900],
    accent: palette.violet[300],
    onAccent: palette.violet[900],
    success: palette.emerald[300],
    warning: palette.amber[300],
    danger: palette.rose[300]
  },
  border: {
    subtle: 'rgba(148, 163, 184, 0.24)',
    default: 'rgba(148, 163, 184, 0.32)',
    strong: 'rgba(148, 163, 184, 0.48)',
    accent: 'rgba(139, 92, 246, 0.65)',
    focus: 'rgba(139, 92, 246, 0.7)',
    inverse: 'rgba(15, 23, 42, 0.6)'
  },
  status: {
    info: palette.blue[400],
    infoOn: palette.slate[900],
    success: palette.emerald[400],
    successOn: palette.slate[900],
    warning: palette.amber[400],
    warningOn: palette.slate[900],
    danger: palette.rose[400],
    dangerOn: palette.slate[900],
    neutral: palette.slate[500],
    neutralOn: palette.slate[900]
  },
  overlay: {
    hover: 'rgba(148, 163, 184, 0.08)',
    pressed: 'rgba(148, 163, 184, 0.16)',
    scrim: 'rgba(5, 1, 13, 0.65)'
  },
  accent: {
    default: palette.violet[400],
    emphasis: palette.indigo[400],
    muted: 'rgba(124, 58, 237, 0.3)',
    onAccent: palette.violet[900]
  }
} as const;

const lightTheme: ThemeDefinition = deepFreeze({
  id: 'apphub-light',
  label: 'AppHub Light',
  description: 'Default bright theme for AppHub surfaces.',
  scheme: 'light',
  semantics: lightSemantics,
  typography,
  spacing,
  radius,
  shadow,
  metadata: {
    source: 'system',
    version: '1.0.0',
    tags: ['default', 'accessible']
  }
} satisfies ThemeDefinition);

const darkTheme: ThemeDefinition = deepFreeze({
  id: 'apphub-dark',
  label: 'AppHub Dark',
  description: 'Midnight theme optimised for low-light environments.',
  scheme: 'dark',
  semantics: darkSemantics,
  typography,
  spacing,
  radius,
  shadow,
  metadata: {
    source: 'system',
    version: '1.0.0',
    tags: ['default', 'accessible']
  }
} satisfies ThemeDefinition);

export const defaultThemes = deepFreeze({
  light: lightTheme,
  dark: darkTheme
} as const);

export const defaultThemeRegistry: ThemeRegistry = deepFreeze({
  [lightTheme.id]: lightTheme,
  [darkTheme.id]: darkTheme
});

export function createTheme(options: CreateThemeOptions): ThemeDefinition {
  const { base, id, label, description, scheme, overrides } = options;

  const semantics = mergeThemeObject(base.semantics, overrides?.semantics);
  const themeTypography = mergeThemeObject(base.typography, overrides?.typography);
  const themeSpacing = mergeThemeObject(base.spacing, overrides?.spacing);
  const themeRadius = mergeThemeObject(base.radius, overrides?.radius);
  const themeShadow = mergeThemeObject(base.shadow, overrides?.shadow);

  const metadata =
    base.metadata || overrides?.metadata
      ? mergeThemeObject(base.metadata ?? {}, overrides?.metadata)
      : undefined;

  const next: ThemeDefinition = {
    id,
    label: label ?? base.label,
    description: description ?? base.description,
    scheme: scheme ?? base.scheme,
    semantics,
    typography: themeTypography,
    spacing: themeSpacing,
    radius: themeRadius,
    shadow: themeShadow,
    metadata
  };

  return deepFreeze(next);
}

export type { ThemeDefinition } from './types';
