import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeDefinition, ThemeScheme } from '@apphub/shared/designTokens';
import {
  createThemeDraft,
  draftToThemeDefinition,
  validateThemeDraft,
  type ThemeDraft,
  type ThemeDraftValidationResult
} from './themeDraft';

interface UseThemeDraftOptions {
  readonly existingIds: readonly string[];
  readonly originalId?: string;
}

type SemanticSectionKey = keyof ThemeDraft['semantics'];
type TypographySectionKey = keyof ThemeDraft['typography'];

function draftsMatch(a: ThemeDraft, b: ThemeDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coerceFontWeight(value: string): number {
  if (value.trim().length === 0) {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export interface ThemeDraftController {
  readonly draft: ThemeDraft;
  readonly validation: ThemeDraftValidationResult;
  readonly isDirty: boolean;
  readonly setId: (id: string) => void;
  readonly setLabel: (label: string) => void;
  readonly setDescription: (description: string) => void;
  readonly setScheme: (scheme: ThemeScheme) => void;
  readonly setMetadataAuthor: (author: string) => void;
  readonly setMetadataVersion: (version: string) => void;
  readonly setMetadataTags: (tags: string) => void;
  readonly updateSemantic: (section: SemanticSectionKey, token: string, value: string) => void;
  readonly updateTypography: (section: TypographySectionKey, token: string, value: string) => void;
  readonly updateSpacing: (token: string, value: string) => void;
  readonly updateRadius: (token: string, value: string) => void;
  readonly updateShadow: (token: string, value: string) => void;
  readonly reset: (theme?: ThemeDefinition) => void;
  readonly toThemeDefinition: () => ThemeDefinition;
}

export function useThemeDraft(
  theme: ThemeDefinition,
  options: UseThemeDraftOptions
): ThemeDraftController {
  const { existingIds, originalId } = options;

  const [draft, setDraft] = useState<ThemeDraft>(() => createThemeDraft(theme));
  const originalRef = useRef<ThemeDraft>(createThemeDraft(theme));

  useEffect(() => {
    const nextDraft = createThemeDraft(theme);
    setDraft(nextDraft);
    originalRef.current = nextDraft;
  }, [theme]);

  const validation = useMemo(
    () => validateThemeDraft(draft, { existingIds, originalId }),
    [draft, existingIds, originalId]
  );

  const isDirty = useMemo(() => !draftsMatch(draft, originalRef.current), [draft]);

  const setId = useCallback((id: string) => {
    setDraft((current) => ({ ...current, id }));
  }, []);

  const setLabel = useCallback((label: string) => {
    setDraft((current) => ({ ...current, label }));
  }, []);

  const setDescription = useCallback((description: string) => {
    setDraft((current) => ({ ...current, description }));
  }, []);

  const setScheme = useCallback((scheme: ThemeScheme) => {
    setDraft((current) => ({ ...current, scheme }));
  }, []);

  const setMetadataAuthor = useCallback((author: string) => {
    setDraft((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        author
      }
    }));
  }, []);

  const setMetadataVersion = useCallback((version: string) => {
    setDraft((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        version
      }
    }));
  }, []);

  const setMetadataTags = useCallback((value: string) => {
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    setDraft((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        tags
      }
    }));
  }, []);

  const updateSemantic = useCallback((section: SemanticSectionKey, token: string, value: string) => {
    setDraft((current) => ({
      ...current,
      semantics: {
        ...current.semantics,
        [section]: {
          ...current.semantics[section],
          [token]: value
        }
      }
    }));
  }, []);

  const updateTypography = useCallback(
    (section: TypographySectionKey, token: string, rawValue: string) => {
      setDraft((current) => {
        const existingSection = current.typography[section] as Record<string, unknown>;
        const nextSection: Record<string, unknown> = { ...existingSection };

        if (section === 'fontWeight') {
          nextSection[token] = coerceFontWeight(rawValue);
        } else {
          nextSection[token] = rawValue;
        }

        return {
          ...current,
          typography: {
            ...current.typography,
            [section]: nextSection
          }
        };
      });
    },
    []
  );

  const updateSpacing = useCallback((token: string, value: string) => {
    setDraft((current) => ({
      ...current,
      spacing: {
        ...current.spacing,
        [token]: value
      }
    }));
  }, []);

  const updateRadius = useCallback((token: string, value: string) => {
    setDraft((current) => ({
      ...current,
      radius: {
        ...current.radius,
        [token]: value
      }
    }));
  }, []);

  const updateShadow = useCallback((token: string, value: string) => {
    setDraft((current) => ({
      ...current,
      shadow: {
        ...current.shadow,
        [token]: value
      }
    }));
  }, []);

  const reset = useCallback((nextTheme?: ThemeDefinition) => {
    const target = nextTheme ?? theme;
    const nextDraft = createThemeDraft(target);
    setDraft(nextDraft);
    originalRef.current = createThemeDraft(target);
  }, [theme]);

  const toThemeDefinition = useCallback(() => draftToThemeDefinition(draft), [draft]);

  return {
    draft,
    validation,
    isDirty,
    setId,
    setLabel,
    setDescription,
    setScheme,
    setMetadataAuthor,
    setMetadataVersion,
    setMetadataTags,
    updateSemantic,
    updateTypography,
    updateSpacing,
    updateRadius,
    updateShadow,
    reset,
    toThemeDefinition
  } satisfies ThemeDraftController;
}
