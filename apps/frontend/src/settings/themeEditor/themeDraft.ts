import {
  DEFAULT_THEME_SCALE,
  MAX_THEME_SCALE,
  MIN_THEME_SCALE,
  clampThemeScale
} from '@apphub/shared/designTokens';
import type {
  ThemeDefinition,
  ThemeScheme
} from '@apphub/shared/designTokens';

type AnyFunction = (...args: unknown[]) => unknown;

type Mutable<T> = T extends AnyFunction
  ? T
  : T extends ReadonlyArray<infer U>
    ? Mutable<U>[]
    : T extends Record<string, unknown>
      ? { -readonly [P in keyof T]: Mutable<T[P]> }
      : T;

type ThemeDraftSemantics = Mutable<ThemeDefinition['semantics']>;
type ThemeDraftTypography = Mutable<ThemeDefinition['typography']>;
type ThemeDraftSpacing = Mutable<ThemeDefinition['spacing']>;
type ThemeDraftRadius = Mutable<ThemeDefinition['radius']>;
type ThemeDraftShadow = Mutable<ThemeDefinition['shadow']>;

export interface ThemeDraftMetadata {
  readonly author: string;
  readonly version: string;
  readonly tags: string[];
}

export interface ThemeDraft {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scheme: ThemeScheme;
  readonly scale: number;
  readonly semantics: ThemeDraftSemantics;
  readonly typography: ThemeDraftTypography;
  readonly spacing: ThemeDraftSpacing;
  readonly radius: ThemeDraftRadius;
  readonly shadow: ThemeDraftShadow;
  readonly metadata: ThemeDraftMetadata;
}

export interface ThemeDraftValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ThemeDraftValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly ThemeDraftValidationError[];
}

export interface ValidateThemeDraftOptions {
  readonly existingIds?: readonly string[];
  readonly originalId?: string;
}

function clone<T>(value: T): Mutable<T> {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as unknown as Mutable<T>;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, entryValue]) => [key, clone(entryValue)]);
    return Object.fromEntries(entries) as Mutable<T>;
  }

  return value as Mutable<T>;
}

function normalizeId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const sanitized = trimmed.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'custom-theme';
}

const DEFAULT_METADATA: ThemeDraftMetadata = {
  author: '',
  version: '',
  tags: []
};

export function createThemeDraft(theme: ThemeDefinition): ThemeDraft {
  return {
    id: theme.id,
    label: theme.label,
    description: theme.description ?? '',
    scheme: theme.scheme,
    scale: theme.scale ?? DEFAULT_THEME_SCALE,
    semantics: clone(theme.semantics),
    typography: clone(theme.typography),
    spacing: clone(theme.spacing),
    radius: clone(theme.radius),
    shadow: clone(theme.shadow),
    metadata: {
      author: theme.metadata?.author ?? DEFAULT_METADATA.author,
      version: theme.metadata?.version ?? DEFAULT_METADATA.version,
      tags: theme.metadata?.tags ? [...theme.metadata.tags] : [...DEFAULT_METADATA.tags]
    }
  };
}

function normalizeMetadata(metadata: ThemeDraftMetadata) {
  const author = metadata.author.trim();
  const version = metadata.version.trim();
  const tags = metadata.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);

  if (!author && !version && tags.length === 0) {
    return { source: 'user' as const } satisfies ThemeDefinition['metadata'];
  }

  return {
    source: 'user' as const,
    author: author || undefined,
    version: version || undefined,
    tags: tags.length > 0 ? tags : undefined
  } satisfies ThemeDefinition['metadata'];
}

export function draftToThemeDefinition(draft: ThemeDraft): ThemeDefinition {
  const metadata = normalizeMetadata(draft.metadata);

  return {
    id: draft.id.trim(),
    label: draft.label.trim(),
    description: draft.description.trim() || undefined,
    scheme: draft.scheme,
    scale: clampThemeScale(draft.scale),
    semantics: clone(draft.semantics),
    typography: clone(draft.typography),
    spacing: clone(draft.spacing),
    radius: clone(draft.radius),
    shadow: clone(draft.shadow),
    metadata
  } satisfies ThemeDefinition;
}

export function validateThemeDraft(
  draft: ThemeDraft,
  options: ValidateThemeDraftOptions = {}
): ThemeDraftValidationResult {
  const errors: ThemeDraftValidationError[] = [];

  const trimmedId = draft.id.trim();
  if (trimmedId.length === 0) {
    errors.push({ path: 'id', message: 'Theme id is required.' });
  }

  if (trimmedId === 'system') {
    errors.push({ path: 'id', message: 'The id "system" is reserved.' });
  }

  if (!/^[a-z0-9-_]+$/i.test(trimmedId)) {
    errors.push({ path: 'id', message: 'Use only letters, numbers, hyphen, or underscore.' });
  }

  if (options.existingIds) {
    const duplicate = options.existingIds.some((existingId) => existingId === trimmedId && existingId !== options.originalId);
    if (duplicate) {
      errors.push({ path: 'id', message: 'Theme id must be unique.' });
    }
  }

  if (draft.label.trim().length === 0) {
    errors.push({ path: 'label', message: 'Theme label is required.' });
  }

  if (!Number.isFinite(draft.scale)) {
    errors.push({ path: 'scale', message: 'Provide a numeric scale.' });
  } else if (draft.scale < MIN_THEME_SCALE || draft.scale > MAX_THEME_SCALE) {
    errors.push({
      path: 'scale',
      message: `Scale must stay between ${MIN_THEME_SCALE} and ${MAX_THEME_SCALE}.`
    });
  }

  Object.entries(draft.semantics).forEach(([sectionKey, tokens]) => {
    Object.entries(tokens).forEach(([tokenKey, value]) => {
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push({ path: `semantics.${sectionKey}.${tokenKey}`, message: 'Provide a color value.' });
      }
    });
  });

  Object.entries(draft.spacing).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `spacing.${token}`, message: 'Spacing token cannot be empty.' });
    }
  });

  Object.entries(draft.radius).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `radius.${token}`, message: 'Radius token cannot be empty.' });
    }
  });

  Object.entries(draft.shadow).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `shadow.${token}`, message: 'Shadow token cannot be empty.' });
    }
  });

  Object.entries(draft.typography.fontFamily).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `typography.fontFamily.${token}`, message: 'Font family cannot be empty.' });
    }
  });

  Object.entries(draft.typography.fontSize).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `typography.fontSize.${token}`, message: 'Font size cannot be empty.' });
    }
  });

  Object.entries(draft.typography.lineHeight).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `typography.lineHeight.${token}`, message: 'Line-height cannot be empty.' });
    }
  });

  Object.entries(draft.typography.letterSpacing).forEach(([token, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({ path: `typography.letterSpacing.${token}`, message: 'Letter spacing cannot be empty.' });
    }
  });

  Object.entries(draft.typography.fontWeight).forEach(([token, value]) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({ path: `typography.fontWeight.${token}`, message: 'Font weight must be a number.' });
    }
  });

  return { isValid: errors.length === 0, errors };
}

export function generateThemeId(
  label: string,
  existingIds: readonly string[],
  fallback = 'custom-theme'
): string {
  const base = normalizeId(label || fallback);
  if (!existingIds.includes(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (existingIds.includes(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
