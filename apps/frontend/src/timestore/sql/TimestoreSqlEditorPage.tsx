import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type { editor, languages, IDisposable } from 'monaco-editor';
import { Editor } from '../../components/Editor';
import { Spinner } from '../../components';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { useToastHelpers } from '../../components/toast';
import { usePollingResource } from '../../hooks/usePollingResource';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { executeSqlQuery, fetchSqlSchema, type SqlQueryRequest } from '../api';
import type { SqlQueryResult, SqlSchemaResponse, SqlSchemaTable } from '../types';
import {
  addHistoryEntry,
  clearUnpinnedHistory,
  createHistoryEntry,
  readHistoryFromStorage,
  removeHistoryEntry,
  SQL_HISTORY_LIMIT,
  updateHistoryEntry,
  writeHistoryToStorage
} from './sqlHistory';
import type { SqlHistoryEntry } from './sqlHistory';
import { SQL_KEYWORDS } from './sqlKeywords';

const DEFAULT_QUERY = 'SELECT\n  dataset_slug,\n  count(*) AS record_count\nFROM\n  timestore_runtime.datasets\nGROUP BY\n  1\nORDER BY\n  record_count DESC\nLIMIT 100;';

const COMPLETION_TRIGGER_CHARACTERS = [' ', '.', '\n'];

type CompletionSuggestion = Omit<languages.CompletionItem, 'range'>;

function getSuggestionLabel(suggestion: CompletionSuggestion): string {
  if (typeof suggestion.label === 'string') {
    return suggestion.label;
  }
  return suggestion.label.label ?? '';
}

function quoteIdentifier(identifier: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return identifier;
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildCompletionItems(monaco: Monaco, tables: SqlSchemaTable[]): CompletionSuggestion[] {
  const keywordItems: CompletionSuggestion[] = SQL_KEYWORDS.map((keyword, index) => ({
    label: keyword,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: keyword,
    sortText: `0_${index.toString().padStart(3, '0')}`,
    detail: 'keyword'
  }));

  const tableItems: CompletionSuggestion[] = [];
  const columnItems: CompletionSuggestion[] = [];

  tables.forEach((table, tableIndex) => {
    const label = table.name;
    tableItems.push({
      label,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: quoteIdentifier(label),
      sortText: `1_${tableIndex.toString().padStart(3, '0')}`,
      detail: 'table',
      documentation: table.description ?? undefined
    });

    table.columns.forEach((column, columnIndex) => {
      const insertValue = `${quoteIdentifier(label)}.${quoteIdentifier(column.name)}`;
      columnItems.push({
        label: column.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: insertValue,
        sortText: `2_${tableIndex.toString().padStart(3, '0')}_${columnIndex.toString().padStart(3, '0')}`,
        detail: column.type ?? 'column',
        documentation: column.description ?? undefined
      });
    });
  });

  return [...keywordItems, ...tableItems, ...columnItems];
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function useBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function TimestoreSqlEditorPage() {
  const authorizedFetch = useAuthorizedFetch();
  const { showError, showSuccess } = useToastHelpers();
  const storage = useBrowserStorage();

  const [statement, setStatement] = useState<string>(DEFAULT_QUERY);
  const [maxRowsInput, setMaxRowsInput] = useState<string>('500');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [resultMode, setResultMode] = useState<'table' | 'json' | 'chart'>('table');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [history, setHistory] = useState<SqlHistoryEntry[]>(() => readHistoryFromStorage(storage));
  const [isExecuting, setIsExecuting] = useState(false);

  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const completionProviderRef = useRef<IDisposable | null>(null);
  const runQueryRef = useRef<() => void>(() => {});

  const schemaFetcher = useCallback(
    async ({ authorizedFetch, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      return fetchSqlSchema(authorizedFetch, { signal });
    },
    []
  );

  const {
    data: schemaData,
    error: schemaError,
    loading: schemaLoading,
    refetch: refetchSchema
  } = usePollingResource<SqlSchemaResponse>({
    fetcher: schemaFetcher,
    intervalMs: 5 * 60 * 1000,
    immediate: true
  });

  const schemaErrorMessage = useMemo(() => {
    if (!schemaError) {
      return null;
    }
    if (schemaError instanceof Error) {
      return schemaError.message;
    }
    return String(schemaError);
  }, [schemaError]);

  useEffect(() => {
    writeHistoryToStorage(storage, history);
  }, [history, storage]);

  const schemaTables = useMemo(() => schemaData?.tables ?? [], [schemaData]);

  const filteredTables = useMemo(() => {
    const query = schemaFilter.trim().toLowerCase();
    if (!query) {
      return schemaTables;
    }
    return schemaTables.filter((table) => {
      const haystack = `${table.name} ${table.columns.map((column) => column.name).join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [schemaFilter, schemaTables]);

  const updateCompletionProvider = useCallback(() => {
    if (!monacoRef.current) {
      return;
    }
    completionProviderRef.current?.dispose();
    const monaco = monacoRef.current;
    const suggestions = buildCompletionItems(monaco, schemaTables);

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: COMPLETION_TRIGGER_CHARACTERS,
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );
        const prefix = word.word?.toLowerCase() ?? '';
        const matching = suggestions.filter((item) => {
          if (!prefix) {
            return true;
          }
          return getSuggestionLabel(item).toLowerCase().startsWith(prefix);
        });
        const activeSuggestions = matching.length > 0 ? matching : suggestions;
        return {
          suggestions: activeSuggestions.map((item) => ({
            ...item,
            range
          }))
        } satisfies languages.CompletionList;
      }
    });
  }, [schemaTables]);

  useEffect(() => {
    updateCompletionProvider();
    return () => {
      completionProviderRef.current?.dispose();
    };
  }, [updateCompletionProvider]);

  const normalizedHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) {
      return history;
    }
    return history.filter((entry) => {
      const haystack = `${entry.statement} ${entry.label ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [history, historySearch]);

  const runQuery = useCallback(async () => {
    const trimmed = statement.trim();
    if (!trimmed) {
      setQueryError('Enter a SQL statement to run.');
      return;
    }
    const parsedLimit = parseInt(maxRowsInput, 10);
    const maxRows = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

    const request: SqlQueryRequest = {
      statement: trimmed,
      maxRows
    };

    setIsExecuting(true);
    setQueryError(null);
    try {
      const response = await executeSqlQuery(authorizedFetch, request);
      setResult(response);
      setResultMode((current) => (current === 'chart' ? current : 'table'));
      const rowCount = response.statistics?.rowCount ?? response.rows.length;
      const elapsedMs = response.statistics?.elapsedMs;
      showSuccess('SQL query executed', `${rowCount} rows returned${elapsedMs ? ` in ${elapsedMs}ms` : ''}.`);
      setHistory((prev) =>
        addHistoryEntry(
          prev,
          createHistoryEntry({
            statement: trimmed,
            rowCount,
            elapsedMs
          }),
          SQL_HISTORY_LIMIT
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to execute SQL query.';
      setQueryError(message);
      showError('SQL execution failed', error);
    } finally {
      setIsExecuting(false);
    }
  }, [authorizedFetch, maxRowsInput, showError, showSuccess, statement]);

  runQueryRef.current = runQuery;

  const handleEditorMount = useCallback<OnMount>((editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;

    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runQueryRef.current();
    });

    updateCompletionProvider();
  }, [updateCompletionProvider]);

  const handleLoadHistoryEntry = useCallback((entry: SqlHistoryEntry) => {
    setStatement(entry.statement);
  }, []);

  const handleRunHistoryEntry = useCallback(
    (entry: SqlHistoryEntry) => {
      setStatement(entry.statement);
      setTimeout(() => {
        runQueryRef.current();
      }, 0);
    },
    []
  );

  const handleDeleteHistoryEntry = useCallback((id: string) => {
    setHistory((prev) => removeHistoryEntry(prev, id));
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory((prev) => clearUnpinnedHistory(prev));
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setHistory((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (!target) {
        return prev;
      }
      return updateHistoryEntry(prev, id, { pinned: !target.pinned });
    });
  }, []);

  const handleRenameHistoryEntry = useCallback((id: string) => {
    setHistory((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (!target) {
        return prev;
      }
      const nextLabel = typeof window !== 'undefined'
        ? window.prompt('Set a label for this query', target.label ?? '')
        : null;
      if (nextLabel === null) {
        return prev;
      }
      const sanitized = nextLabel.trim();
      return updateHistoryEntry(prev, id, { label: sanitized.length > 0 ? sanitized : null });
    });
  }, []);

  const canChart = useMemo(() => {
    if (!result || result.rows.length === 0) {
      return false;
    }
    const numericColumn = result.columns.find((column, index) => isNumericColumn(column, result.rows, index));
    return Boolean(numericColumn);
  }, [result]);

  const effectiveResultMode = canChart ? resultMode : resultMode === 'chart' ? 'table' : resultMode;

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">SQL Editor</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Explore Timestore datasets with ad-hoc SQL. Use <kbd className="rounded-md bg-slate-200 px-1 py-0.5 text-xs font-semibold text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-100">⌘/Ctrl + Enter</kbd> to run the current statement.
          </p>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => runQueryRef.current()}
                  disabled={isExecuting}
                  className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isExecuting ? 'Running…' : 'Run query'}
                </button>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Max rows</span>
                  <input
                    type="number"
                    min={1}
                    value={maxRowsInput}
                    onChange={(event) => setMaxRowsInput(event.target.value)}
                    className="w-24 rounded-full border border-slate-300/70 bg-white/80 px-3 py-1 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => {
                    setStatement(DEFAULT_QUERY);
                    editorRef.current?.focus();
                  }}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold hover:bg-slate-200/60 dark:border-slate-700/70 dark:hover:bg-slate-800/60"
                >
                  Reset example
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      void navigator.clipboard.writeText(statement).catch(() => {
                        showError('Unable to copy query', new Error('Copy command failed.'));
                      });
                    }
                  }}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold hover:bg-slate-200/60 dark:border-slate-700/70 dark:hover:bg-slate-800/60"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="mt-4">
              <Editor
                value={statement}
                onChange={setStatement}
                language="sql"
                height={360}
                onMount={handleEditorMount}
                ariaLabel="Timestore SQL editor"
              />
            </div>
            {queryError && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{queryError}</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Results</h3>
                {result?.statistics && (
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    {result.statistics.rowCount ?? result.rows.length} rows · {result.statistics.elapsedMs ? `${result.statistics.elapsedMs} ms` : 'runtime unknown'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setResultMode('table')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${effectiveResultMode === 'table' ? 'bg-violet-600 text-white dark:bg-violet-500' : 'border border-slate-300/70 text-slate-600 dark:border-slate-700/70 dark:text-slate-300'}`}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setResultMode('json')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${effectiveResultMode === 'json' ? 'bg-violet-600 text-white dark:bg-violet-500' : 'border border-slate-300/70 text-slate-600 dark:border-slate-700/70 dark:text-slate-300'}`}
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => setResultMode('chart')}
                  disabled={!canChart}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${effectiveResultMode === 'chart' ? 'bg-violet-600 text-white dark:bg-violet-500' : 'border border-slate-300/70 text-slate-600 dark:border-slate-700/70 dark:text-slate-300'} ${!canChart ? 'opacity-40' : ''}`}
                >
                  Chart
                </button>
              </div>
            </div>

            <div className="mt-4">
              {!result && !isExecuting && (
                <p className="text-sm text-slate-600 dark:text-slate-300">Run a query to see results here.</p>
              )}
              {isExecuting && (
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <Spinner label="Executing query" />
                  <span>Executing query…</span>
                </div>
              )}
              {result && !isExecuting && effectiveResultMode === 'table' && (
                <div className="max-h-[420px] overflow-auto rounded-2xl border border-slate-200/70 dark:border-slate-700/70">
                  <table className="min-w-full divide-y divide-slate-200/70 dark:divide-slate-700/70">
                    <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.25em] text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column.name} className="px-4 py-2 text-left font-semibold">
                            {column.name}
                            {column.type && (
                              <span className="ml-2 text-[11px] font-normal uppercase tracking-[0.2em] text-slate-400">
                                {column.type}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-violet-500/5">
                          {result.columns.map((column) => (
                            <td key={column.name} className="px-4 py-2 text-slate-700 dark:text-slate-200">
                              {formatCellValue(row[column.name])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result && !isExecuting && effectiveResultMode === 'json' && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/70">
                  <JsonSyntaxHighlighter value={result.rows} />
                </div>
              )}
              {result && !isExecuting && effectiveResultMode === 'chart' && canChart && (
                <SqlChart rows={result.rows} columns={result.columns} />
              )}
              {result?.warnings && result.warnings.length > 0 && (
                <div className="mt-4 space-y-2 rounded-2xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm text-amber-700 dark:border-amber-300/60 dark:bg-amber-400/10 dark:text-amber-200">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.3em]">Warnings</h4>
                  <ul className="list-disc space-y-1 pl-5">
                    {result.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Schema</h3>
              <button
                type="button"
                onClick={() => void refetchSchema()}
                className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Refresh
              </button>
            </div>
            {schemaLoading && (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Spinner label="Loading schema" />
                <span>Loading schema…</span>
              </div>
            )}
            {schemaErrorMessage ? (
              <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">
                Failed to load schema: {schemaErrorMessage}
              </p>
            ) : null}
            {!schemaLoading && !schemaErrorMessage && (
              <div className="mt-4">
              <input
                type="search"
                value={schemaFilter}
                onChange={(event) => setSchemaFilter(event.target.value)}
                placeholder="Filter schema"
                className="w-full rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
                <div className="mt-4 max-h-[320px] space-y-3 overflow-auto pr-1">
                  {filteredTables.map((table) => (
                    <details key={table.name} open className="rounded-2xl border border-slate-200/70 bg-slate-100/60 p-3 dark:border-slate-700/70 dark:bg-slate-800/60">
                      <summary className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <span>{table.name}</span>
                        {table.partitionKeys && table.partitionKeys.length > 0 && (
                          <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            partitions: {table.partitionKeys.join(', ')}
                          </span>
                        )}
                      </summary>
                      <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                        {table.columns.map((column) => (
                          <li key={column.name} className="flex flex-col">
                            <span className="font-mono text-[13px] text-slate-700 dark:text-slate-200">{column.name}</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                              {column.type ?? 'unknown'}
                              {column.nullable === false ? ' • not null' : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  {filteredTables.length === 0 && (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {schemaTables.length === 0
                        ? 'Schema metadata is not available yet.'
                        : 'No tables match the current filter.'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">History</h3>
              <button
                type="button"
                onClick={handleClearHistory}
                className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
              >
                Clear unpinned
              </button>
            </div>
            <div className="mt-4">
              <input
                type="search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search saved queries"
                className="w-full rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </div>
            <div className="mt-4 max-h-[320px] space-y-3 overflow-auto pr-1">
              {normalizedHistory.length === 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-300">Recently executed queries will appear here.</p>
              )}
              {normalizedHistory.map((entry) => (
                <article
                  key={entry.id}
                  className={`rounded-2xl border px-4 py-3 text-sm shadow-sm transition-shadow ${entry.pinned ? 'border-violet-400/80 bg-violet-50/70 dark:border-violet-400/50 dark:bg-violet-400/10' : 'border-slate-200/70 bg-white/70 dark:border-slate-700/70 dark:bg-slate-900/70'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                      <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700 dark:text-slate-200">{entry.statement}</pre>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {entry.stats?.rowCount !== undefined && (
                        <span>{entry.stats.rowCount} rows</span>
                      )}
                      {entry.stats?.elapsedMs !== undefined && (
                        <span>{entry.stats.elapsedMs} ms</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleRunHistoryEntry(entry)}
                      className="rounded-full bg-violet-600 px-3 py-1 font-semibold text-white hover:bg-violet-500 dark:bg-violet-500 dark:hover:bg-violet-400"
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadHistoryEntry(entry)}
                      className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRenameHistoryEntry(entry.id)}
                      className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(entry.id)}
                      className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    >
                      {entry.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryEntry(entry.id)}
                      className="rounded-full border border-rose-400/70 px-3 py-1 font-semibold text-rose-600 hover:bg-rose-500/10 dark:border-rose-400/60 dark:text-rose-300"
                    >
                      Delete
                    </button>
                  </div>
                  {entry.label && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                      {entry.label}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface SqlChartProps {
  rows: Array<Record<string, unknown>>;
  columns: SqlQueryResult['columns'];
}

function SqlChart({ rows, columns }: SqlChartProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-300">No data to chart yet.</p>;
  }

  const numericColumn = columns.find((column, index) => isNumericColumn(column, rows, index));

  if (!numericColumn) {
    return <p className="text-sm text-slate-600 dark:text-slate-300">No numeric column available for charting.</p>;
  }

  const timeColumn = columns.find((column, index) => isTemporalColumn(column, rows, index));

  const values = rows
    .map((row, index) => ({
      xRaw: timeColumn ? row[timeColumn.name] : index,
      y: Number(row[numericColumn.name])
    }))
    .filter((point) => Number.isFinite(point.y));

  if (values.length === 0) {
    return <p className="text-sm text-slate-600 dark:text-slate-300">Unable to plot chart for the current result set.</p>;
  }

  const width = 480;
  const height = 220;
  const padding = 32;

  const xs = values.map((point, index) => {
    if (point.xRaw instanceof Date) {
      return point.xRaw.getTime();
    }
    if (typeof point.xRaw === 'string' || typeof point.xRaw === 'number') {
      const parsed = new Date(point.xRaw as string);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }
    return index;
  });

  const ys = values.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const points = values.map((point, index) => {
    const xValue = xs[index];
    const x = padding + ((xValue - minX) / rangeX) * (width - padding * 2);
    const y = height - padding - ((point.y - minY) / rangeY) * (height - padding * 2);
    return `${x},${y}`;
  });

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Line chart for ${numericColumn.name}`}
        className="w-full"
      >
        <rect x={0} y={0} width={width} height={height} fill="url(#chartGradient)" rx={18} ry={18} opacity={0.15} />
        <defs>
          <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="#7c3aed"
          strokeWidth={2.5}
          points={points.join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold">y-axis:</span> {numericColumn.name}
        {timeColumn && (
          <span className="ml-4">
            <span className="font-semibold">x-axis:</span> {timeColumn.name}
          </span>
        )}
      </div>
    </div>
  );
}

function isNumericColumn(column: SqlQueryResult['columns'][number], rows: Array<Record<string, unknown>>, index: number): boolean {
  const type = column.type?.toLowerCase() ?? '';
  if (type.includes('int') || type.includes('double') || type.includes('float') || type.includes('numeric') || type.includes('decimal')) {
    return true;
  }
  for (const row of rows) {
    const value = row[column.name];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'number') {
      return true;
    }
    if (typeof value === 'string' && !Number.isNaN(Number(value))) {
      return true;
    }
    return false;
  }
  return index === 0 && rows.length > 0 && typeof rows[0][column.name] !== 'undefined' && !Number.isNaN(Number(rows[0][column.name] as unknown));
}

function isTemporalColumn(column: SqlQueryResult['columns'][number], rows: Array<Record<string, unknown>>, index: number): boolean {
  const type = column.type?.toLowerCase() ?? '';
  if (type.includes('time') || type.includes('date')) {
    return true;
  }
  for (const row of rows) {
    const value = row[column.name];
    if (value === null || value === undefined) {
      continue;
    }
    if (value instanceof Date) {
      return true;
    }
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      return true;
    }
    return false;
  }
  return index === 0 && rows.length > 0 && typeof rows[0][column.name] !== 'undefined' && !Number.isNaN(Date.parse(String(rows[0][column.name])));
}
