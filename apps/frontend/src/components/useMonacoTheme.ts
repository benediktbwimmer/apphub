import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';

export type EditorTheme = 'vs-light' | 'vs-dark';

function prefersDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function hasDarkClass(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const element = document.documentElement;
  return element.classList.contains('dark') || element.classList.contains('theme-dark');
}

function resolveTheme(): EditorTheme {
  if (hasDarkClass() || prefersDarkMode()) {
    return 'vs-dark';
  }
  return 'vs-light';
}

let themesRegistered = false;

export function registerThemes(monaco: Monaco) {
  if (themesRegistered) {
    return;
  }
  monaco.editor.defineTheme('apphub-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0f172a',
      'editorLineNumber.foreground': '#64748b'
    }
  });
  monaco.editor.defineTheme('apphub-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editorLineNumber.foreground': '#94a3b8'
    }
  });
  themesRegistered = true;
}

export function useMonacoTheme(): EditorTheme {
  const [theme, setTheme] = useState<EditorTheme>(() => resolveTheme());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return () => {
        // noop for SSR
      };
    }

    const element = document.documentElement;

    const updateTheme = () => {
      setTheme(resolveTheme());
    };

    const observer = new MutationObserver(updateTheme);
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    let media: MediaQueryList | null = null;

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        media = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = updateTheme;
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', listener);
        } else if (typeof media.addListener === 'function') {
          media.addListener(listener);
        }
      } catch {
        media = null;
      }
    }

    updateTheme();

    return () => {
      observer.disconnect();
      if (media) {
        if (typeof media.removeEventListener === 'function') {
          media.removeEventListener('change', updateTheme);
        } else if (typeof media.removeListener === 'function') {
          media.removeListener(updateTheme);
        }
      }
    };
  }, []);

  return theme;
}

export function getAppliedTheme(theme: EditorTheme): 'apphub-dark' | 'apphub-light' {
  return theme === 'vs-dark' ? 'apphub-dark' : 'apphub-light';
}
