import { useEffect, useMemo, useState } from 'react';
import MonacoEditor, {
  type EditorProps as MonacoEditorProps,
  type Monaco,
  type OnChange,
  type OnMount
} from '@monaco-editor/react';

type BaseEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  readOnly?: boolean;
  ariaLabel?: string;
  options?: MonacoEditorProps['options'];
  className?: string;
};

export type EditorProps = BaseEditorProps;

type EditorTheme = 'vs-light' | 'vs-dark';

function resolveTheme(): EditorTheme {
  if (typeof document === 'undefined') {
    return 'vs-light';
  }
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs-light';
}

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

function noop() {
  // noop placeholder for SSR guards
}

export function Editor({
  value,
  onChange,
  language = 'plaintext',
  height = 280,
  readOnly = false,
  ariaLabel,
  options,
  className
}: BaseEditorProps) {
  const [theme, setTheme] = useState<EditorTheme>(() => resolveTheme());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return noop;
    }
    const element = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(resolveTheme());
    });
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const mergedOptions = useMemo(
    () => ({ ...BASE_OPTIONS, ...options, readOnly }),
    [options, readOnly]
  );

  const handleChange: OnChange = (nextValue) => {
    onChange(nextValue ?? '');
  };

  const handleMount: OnMount = (editor, monaco: Monaco) => {
    editor.updateOptions({ renderWhitespace: 'selection', tabSize: 2 });
    if (readOnly) {
      editor.updateOptions({ renderLineHighlight: 'none' });
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
    monaco.editor.setTheme(theme === 'vs-dark' ? 'apphub-dark' : 'apphub-light');
  };

  const appliedTheme = theme === 'vs-dark' ? 'apphub-dark' : 'apphub-light';

  return (
    <div className={className}>
      <MonacoEditor
        value={value}
        language={language}
        onChange={handleChange}
        height={height}
        theme={appliedTheme}
        options={mergedOptions}
        onMount={handleMount}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export default Editor;
