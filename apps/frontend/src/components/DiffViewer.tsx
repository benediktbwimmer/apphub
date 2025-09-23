import { useMemo } from 'react';
import {
  DiffEditor as MonacoDiffEditor,
  type DiffEditorProps as MonacoDiffEditorProps,
  type DiffOnMount
} from '@monaco-editor/react';
import { getAppliedTheme, registerThemes, useMonacoTheme } from './useMonacoTheme';

type BaseDiffProps = {
  original: string;
  modified: string;
  language?: string;
  height?: string | number;
  ariaLabel?: string;
  options?: MonacoDiffEditorProps['options'];
  className?: string;
};

const BASE_OPTIONS: MonacoDiffEditorProps['options'] = {
  renderSideBySide: true,
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  fontLigatures: true,
  wordWrap: 'on',
  wrappingIndent: 'same',
  smoothScrolling: true
};

export type DiffViewerProps = BaseDiffProps;

export function DiffViewer({
  original,
  modified,
  language = 'plaintext',
  height = 320,
  ariaLabel,
  options,
  className
}: DiffViewerProps) {
  const theme = useMonacoTheme();

  const mergedOptions = useMemo(
    () => ({ ...BASE_OPTIONS, ...options }),
    [options]
  );

  const handleMount: DiffOnMount = (_editor, monaco) => {
    registerThemes(monaco);
    monaco.editor.setTheme(getAppliedTheme(theme));
  };

  const appliedTheme = getAppliedTheme(theme);

  return (
    <div className={className}>
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language={language}
        height={height}
        options={mergedOptions}
        onMount={handleMount}
        theme={appliedTheme}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export default DiffViewer;
