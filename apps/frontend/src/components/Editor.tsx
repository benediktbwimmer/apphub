import { useEffect, useMemo, useRef } from 'react';
import MonacoEditor, {
  type EditorProps as MonacoEditorProps,
  type OnChange,
  type OnMount
} from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { applyMonacoTheme, useMonacoTheme } from './useMonacoTheme';

type BaseEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  readOnly?: boolean;
  ariaLabel?: string;
  options?: MonacoEditorProps['options'];
  className?: string;
  onMount?: OnMount;
};

export type EditorProps = BaseEditorProps;

const BASE_OPTIONS: MonacoEditorProps['options'] = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  fontLigatures: true,
  wordWrap: 'on',
  wrappingIndent: 'same',
  smoothScrolling: true,
  renderLineHighlight: 'line',
  contextmenu: true,
  automaticLayout: true
};

export function Editor({
  value,
  onChange,
  language = 'plaintext',
  height = 280,
  readOnly = false,
  ariaLabel,
  options,
  className,
  onMount: userOnMount
}: BaseEditorProps) {
  const theme = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);

  const mergedOptions = useMemo(
    () => ({ ...BASE_OPTIONS, ...options, readOnly }),
    [options, readOnly]
  );

  const handleChange: OnChange = (nextValue) => {
    onChange(nextValue ?? '');
  };

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.updateOptions({ renderWhitespace: 'selection', tabSize: 2 });
    if (readOnly) {
      editor.updateOptions({ renderLineHighlight: 'none' });
    }
    applyMonacoTheme(monaco, theme);
    userOnMount?.(editor, monaco);
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) {
      return;
    }
    applyMonacoTheme(monaco, theme);
  }, [theme]);

  return (
    <div className={className}>
      <MonacoEditor
        value={value}
        language={language}
        onChange={handleChange}
        height={height}
        theme={theme.id}
        options={mergedOptions}
        onMount={handleMount}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export default Editor;
