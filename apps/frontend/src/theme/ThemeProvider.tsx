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

export function ThemeProvider({
  children,
  themes = defaultThemeRegistry,
  storageKey = THEME_STORAGE_KEY
}: ThemeProviderProps) {
  const themeList = useMemo(() => createThemeList(themes), [themes]);
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

  const value: ThemeContextValue = useMemo(
    () => ({
      availableThemes: themeList,
      preference,
      setPreference,
      theme: activeTheme,
      themeId: activeTheme.id,
      scheme: activeTheme.scheme
    }),
    [activeTheme, preference, setPreference, themeList]
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
