import { useEffect, useMemo, useRef } from 'react';
import MonacoEditor, {
  type EditorProps as MonacoEditorProps,
  type OnChange,
  type OnMount
} from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
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
  renderOverviewRuler: false,
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

function applySelectionStyles(
  target: HTMLElement | null,
  colors: MonacoEditorNS.IColors
): void {
  if (!target) {
    return;
  }
  const selectionStrong = colors['editor.selectionBackground'] ?? 'rgba(124, 58, 237, 0.32)';
  const selectionSoft = colors['editor.selectionHighlightBackground'] ?? 'rgba(124, 58, 237, 0.28)';
  const selectionInactive = colors['editor.inactiveSelectionBackground'] ?? selectionSoft;
  const wordHighlight = colors['editor.wordHighlightBackground'] ?? selectionSoft;
  const wordHighlightStrong = colors['editor.wordHighlightStrongBackground'] ?? selectionSoft;

  target.style.setProperty('--vscode-editor-selectionBackground', selectionStrong, 'important');
  target.style.setProperty('--vscode-editor-selectionHighlightBackground', selectionSoft, 'important');
  target.style.setProperty('--vscode-editor-inactiveSelectionBackground', selectionInactive, 'important');
  target.style.setProperty('--vscode-editor-wordHighlightBackground', wordHighlight, 'important');
  target.style.setProperty('--vscode-editor-wordHighlightStrongBackground', wordHighlightStrong, 'important');
}

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
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);

  const mergedOptions = useMemo(
    () => ({ ...BASE_OPTIONS, ...options, readOnly }),
    [options, readOnly]
  );

  const handleChange: OnChange = (nextValue) => {
    onChange(nextValue ?? '');
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.updateOptions({ renderWhitespace: 'selection', tabSize: 2 });
    if (readOnly) {
      editor.updateOptions({ renderLineHighlight: 'none' });
    }
    applyMonacoTheme(monaco, theme);
    applySelectionStyles(editor.getDomNode(), theme.definition.colors);
    userOnMount?.(editor, monaco);
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) {
      return;
    }
    applyMonacoTheme(monaco, theme);
    applySelectionStyles(editor.getDomNode(), theme.definition.colors);
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
