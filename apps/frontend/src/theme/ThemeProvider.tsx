import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  defaultThemeRegistry,
  type ThemeDefinition,
  type ThemeRegistry
} from '@apphub/shared/designTokens';

const THEME_STORAGE_KEY = 'apphub.theme-preference';
const CUSTOM_THEME_STORAGE_SUFFIX = 'custom-themes';

function createCustomThemesStorageKey(baseKey: string): string {
  return `${baseKey}::${CUSTOM_THEME_STORAGE_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopy(item)) as unknown as T;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, val]) => [key, deepCopy(val)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreeze(item));
    return Object.freeze(value);
  }

  if (isRecord(value)) {
    Object.values(value).forEach((val) => deepFreeze(val));
    return Object.freeze(value);
  }

  return value;
}

function sanitizeThemeDefinition(input: unknown): ThemeDefinition | null {
  if (!isRecord(input)) {
    return null;
  }

  const candidate = deepCopy(input) as Partial<ThemeDefinition>;

  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    return null;
  }

  if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) {
    return null;
  }

  if (candidate.scheme !== 'light' && candidate.scheme !== 'dark') {
    return null;
  }

  if (!isRecord(candidate.semantics)) {
    return null;
  }

  const semantics = candidate.semantics as Record<string, unknown>;
  const requiredSemanticSections: Array<keyof ThemeDefinition['semantics']> = [
    'surface',
    'text',
    'border',
    'status',
    'overlay',
    'accent'
  ];

  for (const section of requiredSemanticSections) {
    if (!isRecord(semantics[section])) {
      return null;
    }
  }

  if (!isRecord(candidate.typography) || !isRecord(candidate.spacing)) {
    return null;
  }

  if (!isRecord(candidate.radius) || !isRecord(candidate.shadow)) {
    return null;
  }

  if (candidate.description !== undefined && typeof candidate.description !== 'string') {
    return null;
  }

  if (candidate.metadata !== undefined && !isRecord(candidate.metadata)) {
    return null;
  }

  return deepFreeze(candidate as ThemeDefinition);
}

function readStoredCustomThemes(storageKey: string): ThemeDefinition[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const themes: ThemeDefinition[] = [];
    for (const entry of parsed) {
      const theme = sanitizeThemeDefinition(entry);
      if (theme) {
        themes.push(theme);
      }
    }

    return themes;
  } catch {
    return [];
  }
}

function mergeThemeLists(
  baseList: readonly ThemeDefinition[],
  customThemes: readonly ThemeDefinition[]
): ThemeDefinition[] {
  if (customThemes.length === 0) {
    return [...baseList];
  }

  const overriddenIds = new Set(customThemes.map((theme) => theme.id));
  const filteredBase = baseList.filter((theme) => !overriddenIds.has(theme.id));

  return [...filteredBase, ...customThemes];
}

function sortThemesByLabel(themes: readonly ThemeDefinition[]): ThemeDefinition[] {
  return [...themes].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export type ThemePreference = 'system' | ThemeDefinition['id'];

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly themes?: ThemeRegistry;
  readonly storageKey?: string;
}

interface ThemeContextValue {
  readonly availableThemes: readonly ThemeDefinition[];
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly theme: ThemeDefinition;
  readonly themeId: ThemeDefinition['id'];
  readonly scheme: ThemeDefinition['scheme'];
  readonly customThemes: readonly ThemeDefinition[];
  readonly saveCustomTheme: (theme: ThemeDefinition) => void;
  readonly deleteCustomTheme: (themeId: ThemeDefinition['id']) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const FALLBACK_PREFERENCE: ThemePreference = 'system';

function detectSystemScheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function createThemeList(themes: ThemeRegistry): ThemeDefinition[] {
  return Object.values(themes);
}

function createThemeMap(themeList: ThemeDefinition[]): Map<string, ThemeDefinition> {
  return new Map(themeList.map((theme) => [theme.id, theme]));
}

function resolveThemeFromPreference(
  preference: ThemePreference,
  themeMap: Map<string, ThemeDefinition>,
  themeList: ThemeDefinition[],
  systemScheme: 'light' | 'dark'
): ThemeDefinition {
  if (preference !== 'system') {
    const explicitTheme = themeMap.get(preference);
    if (explicitTheme) {
      return explicitTheme;
    }
  }

  const matchingScheme = themeList.find((theme) => theme.scheme === systemScheme);
  if (matchingScheme) {
    return matchingScheme;
  }

  const fallbackScheme = systemScheme === 'dark' ? 'light' : 'dark';
  const alternate = themeList.find((theme) => theme.scheme === fallbackScheme);
  if (alternate) {
    return alternate;
  }

  const first = themeList[0];
  if (!first) {
    throw new Error('ThemeProvider: no themes available to resolve.');
  }
  return first;
}

function readStoredPreference(
  storageKey: string,
  themeMap: Map<string, ThemeDefinition>
): ThemePreference {
  if (typeof window === 'undefined') {
    return FALLBACK_PREFERENCE;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return FALLBACK_PREFERENCE;
    }
    if (raw === 'system') {
      return 'system';
    }
    if (themeMap.has(raw)) {
      return raw as ThemePreference;
    }
    return FALLBACK_PREFERENCE;
  } catch {
    return FALLBACK_PREFERENCE;
  }
}

function applyThemeClasses(theme: ThemeDefinition, previousThemeId: string | null): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const themeClass = `theme-${toKebabCase(theme.id)}`;

  root.setAttribute('data-theme', theme.id);

  if (previousThemeId && previousThemeId !== theme.id) {
    root.classList.remove(`theme-${toKebabCase(previousThemeId)}`);
  }

  root.classList.add(themeClass);

  if (theme.scheme === 'dark') {
    root.classList.add('dark', 'theme-dark');
    root.classList.remove('theme-light');
  } else {
    root.classList.remove('dark', 'theme-dark');
    root.classList.add('theme-light');
  }
}

function applyThemeVariables(theme: ThemeDefinition): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const setVar = (name: string, value: string | number) => {
    root.style.setProperty(name, String(value));
  };

  setVar('color-scheme', theme.scheme);
  setVar('--theme-id', JSON.stringify(theme.id));
  setVar('--theme-label', JSON.stringify(theme.label));

  const { typography, spacing, radius, shadow, semantics } = theme;

  for (const [token, value] of Object.entries(typography.fontFamily)) {
    setVar(`--font-family-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(typography.fontSize)) {
    setVar(`--font-size-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(typography.fontWeight)) {
    setVar(`--font-weight-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(typography.lineHeight)) {
    setVar(`--line-height-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(typography.letterSpacing)) {
    setVar(`--letter-spacing-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(spacing)) {
    setVar(`--space-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(radius)) {
    setVar(`--radius-${toKebabCase(token)}`, value);
  }

  for (const [token, value] of Object.entries(shadow)) {
    setVar(`--shadow-${toKebabCase(token)}`, value);
  }

  for (const [group, groupValues] of Object.entries(semantics)) {
    for (const [token, value] of Object.entries(groupValues as Record<string, string>)) {
      setVar(`--color-${toKebabCase(group)}-${toKebabCase(token)}`, value);
    }
  }
}

export function ThemeProvider({
  children,
  themes = defaultThemeRegistry,
  storageKey = THEME_STORAGE_KEY
}: ThemeProviderProps) {
  const baseThemeList = useMemo(() => createThemeList(themes), [themes]);

  const customThemesStorageKey = createCustomThemesStorageKey(storageKey);
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(() =>
    readStoredCustomThemes(customThemesStorageKey)
  );

  useEffect(() => {
    setCustomThemes(readStoredCustomThemes(customThemesStorageKey));
  }, [customThemesStorageKey]);

  const themeList = useMemo(
    () => mergeThemeLists(baseThemeList, customThemes),
    [baseThemeList, customThemes]
  );
  const themeMap = useMemo(() => createThemeMap(themeList), [themeList]);

  if (themeList.length === 0) {
    throw new Error('ThemeProvider: expected at least one theme definition.');
  }

  const [systemScheme, setSystemScheme] = useState<'light' | 'dark'>(() => detectSystemScheme());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => {
        // noop
      };
    }

    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      media = null;
    }

    if (!media) {
      return () => {
        // noop
      };
    }

    const handler = (event: MediaQueryListEvent) => {
      setSystemScheme(event.matches ? 'dark' : 'light');
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler);
      return () => media?.removeEventListener('change', handler);
    }

    if (typeof media.addListener === 'function') {
      media.addListener(handler);
      return () => media?.removeListener(handler);
    }

    return () => {
      // noop
    };
  }, []);

  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(storageKey, themeMap)
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, preference);
    } catch {
      // ignore write failures (private browsing, etc.)
    }
  }, [preference, storageKey]);

  const activeTheme = useMemo(
    () => resolveThemeFromPreference(preference, themeMap, themeList, systemScheme),
    [preference, systemScheme, themeMap, themeList]
  );

  const previousThemeIdRef = useRef<string | null>(null);

  useEffect(() => {
    applyThemeClasses(activeTheme, previousThemeIdRef.current);
    applyThemeVariables(activeTheme);
    previousThemeIdRef.current = activeTheme.id;
  }, [activeTheme]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      if (next === 'system') {
        setPreferenceState('system');
        return;
      }
      if (themeMap.has(next)) {
        setPreferenceState(next);
        return;
      }
      // ignore attempts to set unknown theme ids
    },
    [themeMap]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      if (customThemes.length === 0) {
        window.localStorage.removeItem(customThemesStorageKey);
        return;
      }
      window.localStorage.setItem(customThemesStorageKey, JSON.stringify(customThemes));
    } catch {
      // ignore write failures (private browsing, etc.)
    }
  }, [customThemes, customThemesStorageKey]);

  useEffect(() => {
    if (preference !== 'system' && !themeMap.has(preference)) {
      setPreferenceState('system');
    }
  }, [preference, themeMap, setPreferenceState]);

  const saveCustomTheme = useCallback((definition: ThemeDefinition) => {
    const sanitized = sanitizeThemeDefinition(definition);
    if (!sanitized) {
      return;
    }

    setCustomThemes((current) => {
      const withoutTarget = current.filter((theme) => theme.id !== sanitized.id);
      return sortThemesByLabel([...withoutTarget, sanitized]);
    });
  }, []);

  const deleteCustomTheme = useCallback((themeId: ThemeDefinition['id']) => {
    setCustomThemes((current) => current.filter((theme) => theme.id !== themeId));
  }, []);

  const value: ThemeContextValue = useMemo(
    () => ({
      availableThemes: themeList,
      preference,
      setPreference,
      theme: activeTheme,
      themeId: activeTheme.id,
      scheme: activeTheme.scheme,
      customThemes,
      saveCustomTheme,
      deleteCustomTheme
    }),
    [activeTheme, customThemes, preference, saveCustomTheme, deleteCustomTheme, setPreference, themeList]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
