import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';

export type EditorTheme = 'vs-light' | 'vs-dark';

function resolveTheme(): EditorTheme {
  if (typeof document === 'undefined') {
    return 'vs-light';
  }
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs-light';
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
    const observer = new MutationObserver(() => {
      setTheme(resolveTheme());
    });
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export function getAppliedTheme(theme: EditorTheme): 'apphub-dark' | 'apphub-light' {
  return theme === 'vs-dark' ? 'apphub-dark' : 'apphub-light';
}

