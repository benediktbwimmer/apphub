import { useMemo } from 'react';
import type { Monaco } from '@monaco-editor/react';
import { useTheme } from '../theme';
import {
  createMonacoTheme,
  registerMonacoTheme,
  type MonacoThemeSpec
} from '../theme/integrations/monacoTheme';

export type { MonacoThemeSpec } from '../theme/integrations/monacoTheme';

export function useMonacoTheme(): MonacoThemeSpec {
  const { theme } = useTheme();
  return useMemo(() => createMonacoTheme(theme), [theme]);
}

export function applyMonacoTheme(monaco: Monaco, spec: MonacoThemeSpec): void {
  registerMonacoTheme(monaco, spec);
  monaco.editor.setTheme(spec.id);
}
