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

const coastalTheme = createTheme({
  base: lightTheme,
  id: 'apphub-coastal',
  label: 'Coastal Breeze',
  description: 'Seafoam-fresh palette that keeps long sessions feeling calm.',
  overrides: {
    semantics: {
      surface: {
        canvas: palette.cyan[50],
        canvasMuted: palette.blue[50],
        sunken: palette.cyan[100],
        accent: palette.cyan[100],
        backdrop: 'rgba(14, 116, 144, 0.45)'
      },
      text: {
        accent: palette.cyan[600],
        success: palette.teal[600]
      },
      border: {
        accent: 'rgba(14, 116, 144, 0.4)',
        focus: 'rgba(6, 182, 212, 0.55)'
      },
      overlay: {
        hover: 'rgba(14, 116, 144, 0.08)',
        pressed: 'rgba(14, 116, 144, 0.18)'
      },
      accent: {
        default: palette.cyan[500],
        emphasis: palette.blue[600],
        muted: palette.cyan[100],
        onAccent: palette.slate[50]
      }
    },
    metadata: {
      version: '1.1.0',
      source: 'system',
      tags: ['light', 'calm', 'teal']
    }
  }
});

const auroraTheme = createTheme({
  base: darkTheme,
  id: 'apphub-aurora',
  label: 'Aurora Midnight',
  description: 'Indigo and cyan accents inspired by after-hours dashboards.',
  overrides: {
    semantics: {
      surface: {
        canvas: '#060821',
        canvasMuted: '#11153a',
        raised: '#141b3a',
        sunken: '#030617',
        accent: 'rgba(99, 102, 241, 0.22)',
        backdrop: 'rgba(5, 8, 30, 0.8)'
      },
      text: {
        accent: palette.indigo[300],
        success: palette.emerald[300]
      },
      border: {
        accent: 'rgba(99, 102, 241, 0.48)',
        focus: 'rgba(129, 140, 248, 0.7)'
      },
      overlay: {
        hover: 'rgba(99, 102, 241, 0.1)',
        pressed: 'rgba(99, 102, 241, 0.2)'
      },
      accent: {
        default: palette.indigo[400],
        emphasis: palette.blue[400],
        muted: 'rgba(76, 29, 149, 0.38)',
        onAccent: palette.violet[50]
      }
    },
    metadata: {
      version: '1.1.0',
      source: 'system',
      tags: ['dark', 'vibrant', 'indigo']
    }
  }
});

const highContrastTheme = createTheme({
  base: lightTheme,
  id: 'apphub-high-contrast',
  label: 'High Contrast',
  description: 'Accessible, high-contrast preset for focused work sessions.',
  overrides: {
    semantics: {
      surface: {
        canvas: '#ffffff',
        canvasMuted: palette.slate[100],
        raised: '#ffffff',
        sunken: palette.slate[200],
        accent: palette.slate[900],
        backdrop: 'rgba(15, 23, 42, 0.75)'
      },
      text: {
        primary: '#0b1120',
        secondary: '#111827',
        muted: '#1f2937',
        accent: palette.amber[600],
        onAccent: '#0b1120',
        success: palette.emerald[700],
        warning: palette.amber[700],
        danger: palette.rose[700]
      },
      border: {
        accent: 'rgba(15, 23, 42, 0.65)',
        focus: 'rgba(245, 158, 11, 0.65)'
      },
      overlay: {
        hover: 'rgba(15, 23, 42, 0.08)',
        pressed: 'rgba(15, 23, 42, 0.18)'
      },
      accent: {
        default: palette.amber[500],
        emphasis: palette.rose[500],
        muted: palette.amber[100],
        onAccent: '#0b1120'
      }
    },
    metadata: {
      version: '1.1.0',
      source: 'system',
      tags: ['light', 'contrast', 'accessible']
    }
  }
});

export const defaultThemes = deepFreeze({
  light: lightTheme,
  dark: darkTheme
} as const);

export const defaultThemeRegistry: ThemeRegistry = deepFreeze({
  [lightTheme.id]: lightTheme,
  [darkTheme.id]: darkTheme,
  [coastalTheme.id]: coastalTheme,
  [auroraTheme.id]: auroraTheme,
  [highContrastTheme.id]: highContrastTheme
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
