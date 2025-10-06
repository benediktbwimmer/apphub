import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type { editor, languages, IDisposable } from 'monaco-editor';
import { Editor } from '../../components/Editor';
import { Spinner } from '../../components';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { useToastHelpers } from '../../components/toast';
import { usePollingResource } from '../../hooks/usePollingResource';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import {
  deleteSavedSqlQuery,
  executeSqlQuery,
  exportSqlQuery,
  fetchSavedSqlQuery,
  fetchSqlSchema,
  listSavedSqlQueries,
  upsertSavedSqlQuery,
  type SqlQueryRequest
} from '../api';
import type { SqlQueryResult, SqlSchemaResponse, SqlSchemaTable, TimestoreAiSqlSuggestion } from '../types';
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
import { TimestoreAiQueryDialog } from './TimestoreAiQueryDialog';
import { ROUTE_PATHS } from '../../routes/paths';
import {
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  FIELD_LABEL,
  INPUT,
  KBD_BADGE,
  PANEL_SHADOW_ELEVATED,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_COMPACT,
  SECONDARY_BUTTON_COMPACT,
  DANGER_SECONDARY_BUTTON,
  SEGMENTED_GROUP,
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE,
  STATUS_BANNER_DANGER,
  STATUS_BANNER_WARNING,
  STATUS_MESSAGE,
  STATUS_META,
  TABLE_CELL,
  TABLE_CELL_PRIMARY,
  TABLE_CONTAINER,
  TABLE_HEAD_ROW
} from '../timestoreTokens';

const DEFAULT_QUERY = 'SELECT\n  dataset_slug,\n  count(*) AS record_count\nFROM\n  timestore_runtime.datasets\nGROUP BY\n  1\nORDER BY\n  record_count DESC\nLIMIT 100;';

const COMPLETION_TRIGGER_CHARACTERS = [' ', '.', '\n'];

const PANEL_ELEVATED = `${PANEL_SURFACE_LARGE} ${PANEL_SHADOW_ELEVATED}`;
const SEGMENTED_BUTTON = (active: boolean) =>
  `${SEGMENTED_BUTTON_BASE} ${active ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE}`;

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

function quoteQualifiedName(name: string): string {
  return name
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(quoteIdentifier)
    .join('.');
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
    const qualifiedTable = quoteQualifiedName(label);
    tableItems.push({
      label,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: qualifiedTable,
      sortText: `1_${tableIndex.toString().padStart(3, '0')}`,
      detail: 'table',
      documentation: table.description ?? undefined
    });

    table.columns.forEach((column, columnIndex) => {
      const insertValue = `${qualifiedTable}.${quoteIdentifier(column.name)}`;
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
  const { showError, showSuccess, showWarning, showInfo } = useToastHelpers();
  const [searchParams] = useSearchParams();
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
  const [isExporting, setIsExporting] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const completionProviderRef = useRef<IDisposable | null>(null);
  const runQueryRef = useRef<() => void>(() => {});
  const schemaWarningsRef = useRef<string | null>(null);
  const savedQueriesLoadedRef = useRef(false);
  const hydratedQueryRef = useRef<string | null>(null);
  const lastRequestRef = useRef<SqlQueryRequest | null>(null);

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

  useEffect(() => {
    if (savedQueriesLoadedRef.current) {
      return;
    }
    savedQueriesLoadedRef.current = true;
    let cancelled = false;

    const loadSavedQueries = async () => {
      try {
        const { savedQueries } = await listSavedSqlQueries(authorizedFetch);
        if (cancelled || !savedQueries) {
          return;
        }
        setHistory((prev) => {
          let next = prev;
          savedQueries.forEach((saved) => {
            const entry = createHistoryEntry({
              id: saved.id,
              statement: saved.statement,
              label: saved.label ?? null,
              pinned: true,
              stats: saved.stats,
              createdAt: saved.updatedAt ?? saved.createdAt,
              updatedAt: saved.updatedAt ?? saved.createdAt
            });
            next = addHistoryEntry(next, entry, SQL_HISTORY_LIMIT);
          });
          return next;
        });
      } catch (error) {
        showError('Unable to load saved queries', error);
      }
    };

    void loadSavedQueries();

    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, showError, setHistory]);

  useEffect(() => {
    const queryId = searchParams.get('queryId');
    if (!queryId) {
      return;
    }
    if (hydratedQueryRef.current === queryId) {
      return;
    }

    const existing = history.find((entry) => entry.id === queryId);
    if (existing) {
      setStatement(existing.statement);
      hydratedQueryRef.current = queryId;
      return;
    }

    let cancelled = false;
    const hydrateQuery = async () => {
      try {
        const saved = await fetchSavedSqlQuery(authorizedFetch, queryId);
        if (cancelled) {
          return;
        }
        const entry = createHistoryEntry({
          id: saved.id,
          statement: saved.statement,
          label: saved.label ?? null,
          pinned: true,
          stats: saved.stats,
          createdAt: saved.updatedAt ?? saved.createdAt,
          updatedAt: saved.updatedAt ?? saved.createdAt
        });
        setHistory((prev) => addHistoryEntry(prev, entry, SQL_HISTORY_LIMIT));
        setStatement(saved.statement);
        showInfo('Saved query loaded', saved.label ?? 'SQL statement ready to run.');
        hydratedQueryRef.current = queryId;
      } catch (error) {
        if (!cancelled) {
          hydratedQueryRef.current = queryId;
          showError('Unable to load saved query', error);
        }
      }
    };

    hydratedQueryRef.current = queryId;
    void hydrateQuery();

    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, history, searchParams, showError, showInfo, setHistory]);

  const schemaTables = useMemo(() => schemaData?.tables ?? [], [schemaData]);
  const canUseAi = schemaTables.length > 0 && !schemaLoading;

  useEffect(() => {
    const warnings = schemaData?.warnings ?? [];
    if (warnings.length === 0) {
      schemaWarningsRef.current = null;
      return;
    }
    const fingerprint = warnings.join('|');
    if (schemaWarningsRef.current === fingerprint) {
      return;
    }
    schemaWarningsRef.current = fingerprint;
    warnings.forEach((warning) => {
      showWarning('SQL schema warning', warning);
    });
  }, [schemaData?.warnings, showWarning]);

  const copyToClipboard = useCallback(async (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('Clipboard is not available in this environment.');
    }
    await navigator.clipboard.writeText(text);
  }, []);

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

  const hasResults = useMemo(() => (result ? result.rows.length > 0 : false), [result]);
  const canExport = hasResults && !isExecuting && !isExporting;

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
      lastRequestRef.current = request;
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
            elapsedMs,
            updatedAt: new Date().toISOString()
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

  const handleCopyQuery = useCallback(async () => {
    const trimmed = statement.trim();
    if (!trimmed) {
      showWarning('Nothing to copy', 'Enter a SQL statement first.');
      return;
    }
    try {
      await copyToClipboard(trimmed);
      showSuccess('Query copied', 'The SQL statement is in your clipboard.');
    } catch (error) {
      showError('Unable to copy query', error);
    }
  }, [copyToClipboard, showError, showSuccess, showWarning, statement]);

  const handleCopyResults = useCallback(async () => {
    if (!result || result.rows.length === 0) {
      showWarning('No results to copy', 'Run a query before copying results.');
      return;
    }
    try {
      const serialized = JSON.stringify(result.rows, null, 2);
      await copyToClipboard(serialized);
      showSuccess('Results copied', 'Current result set copied to clipboard.');
    } catch (error) {
      showError('Unable to copy results', error);
    }
  }, [copyToClipboard, result, showError, showSuccess, showWarning]);

  const handleExportResults = useCallback(
    async (format: 'csv' | 'table', action: 'download' | 'open' = 'download') => {
      if (!lastRequestRef.current) {
        showWarning('No query to export', 'Run a query before exporting results.');
        return;
      }
      setIsExporting(true);
      try {
        const exported = await exportSqlQuery(authorizedFetch, lastRequestRef.current, format);
        const extension = format === 'csv' ? 'csv' : 'txt';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `timestore-query-${timestamp}.${extension}`;

        if (action === 'download') {
          const blobUrl = URL.createObjectURL(exported.blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          showSuccess('Export ready', `Downloaded ${filename}.`);
        } else {
          const blobUrl = URL.createObjectURL(exported.blob);
          const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
          if (!opened) {
            try {
              const fallback = await exported.blob.text();
              await copyToClipboard(fallback);
              showSuccess('Results copied', 'Pop-up blocked; results copied instead.');
            } catch (copyError) {
              showError('Unable to open results', copyError);
            }
          } else {
            showSuccess('Results opened', 'Plain text view opened in a new tab.');
          }
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
        }
      } catch (error) {
        showError('Export failed', error);
      } finally {
        setIsExporting(false);
      }
    },
    [authorizedFetch, copyToClipboard, showError, showSuccess, showWarning]
  );

  const handleShareHistoryEntry = useCallback(
    async (entry: SqlHistoryEntry) => {
      if (!entry.pinned) {
        showWarning('Pin query first', 'Only pinned queries get shareable links.');
        return;
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://apphub.local';
      const shareUrl = new URL(ROUTE_PATHS.servicesTimestoreSql, origin);
      shareUrl.searchParams.set('queryId', entry.id);
      try {
        await copyToClipboard(shareUrl.toString());
        showSuccess('Share link copied', entry.label ?? 'Send this link to load the query.');
      } catch (error) {
        showError('Unable to copy share link', error);
      }
    },
    [copyToClipboard, showError, showSuccess, showWarning]
  );

  const handleDeleteHistoryEntry = useCallback(
    async (id: string) => {
      const entry = history.find((item) => item.id === id);
      if (!entry) {
        return;
      }
      setHistory((prev) => removeHistoryEntry(prev, id));
      if (entry.pinned) {
        try {
          await deleteSavedSqlQuery(authorizedFetch, id);
          showSuccess('Saved query deleted', entry.label ?? 'Saved query removed.');
        } catch (error) {
          showError('Unable to delete saved query', error);
          setHistory((prev) => addHistoryEntry(prev, entry, SQL_HISTORY_LIMIT));
        }
      }
    },
    [authorizedFetch, history, showError, showSuccess]
  );

  const handleAiBusyChange = useCallback((value: boolean) => {
    setAiBusy(value);
  }, []);

  const handleAiResult = useCallback(
    (result: TimestoreAiSqlSuggestion) => {
      setStatement(result.sql);
      editorRef.current?.focus();
      showSuccess('AI query ready', 'Review the generated SQL before running it.');
      if (result.notes) {
        showInfo('AI notes', result.notes);
      }
      if (result.caveats) {
        showWarning('AI caveats', result.caveats);
      }
      result.warnings?.forEach((warning) => {
        if (warning && warning.trim().length > 0) {
          showWarning('AI context warning', warning);
        }
      });
      setAiDialogOpen(false);
    },
    [showInfo, showSuccess, showWarning]
  );

  const handleClearHistory = useCallback(() => {
    setHistory((prev) => clearUnpinnedHistory(prev));
  }, []);

  const handleTogglePin = useCallback(
    async (id: string) => {
      const entry = history.find((item) => item.id === id);
      if (!entry) {
        return;
      }
      const nextPinned = !entry.pinned;
      const optimisticTimestamp = new Date().toISOString();
      setHistory((prev) => updateHistoryEntry(prev, id, { pinned: nextPinned, updatedAt: optimisticTimestamp }));

      if (nextPinned) {
        try {
          const saved = await upsertSavedSqlQuery(authorizedFetch, {
            id,
            statement: entry.statement,
            label: entry.label ?? null,
            stats: entry.stats ?? null
          });
          setHistory((prev) =>
            updateHistoryEntry(prev, id, {
              pinned: true,
              label: saved.label ?? null,
              stats: saved.stats ?? entry.stats,
              updatedAt: saved.updatedAt ?? saved.createdAt
            })
          );
          showSuccess('Query pinned', 'Share link is ready to use.');
        } catch (error) {
          setHistory((prev) =>
            updateHistoryEntry(prev, id, {
              pinned: entry.pinned ?? false,
              updatedAt: entry.updatedAt ?? entry.createdAt
            })
          );
          showError('Unable to pin query', error);
        }
      } else {
        try {
          await deleteSavedSqlQuery(authorizedFetch, id);
          showSuccess('Query unpinned', entry.label ? `Removed ${entry.label} from saved.` : 'Saved query removed.');
        } catch (error) {
          setHistory((prev) =>
            updateHistoryEntry(prev, id, {
              pinned: true,
              updatedAt: entry.updatedAt ?? entry.createdAt
            })
          );
          showError('Unable to unpin query', error);
        }
      }
    },
    [authorizedFetch, history, showError, showSuccess]
  );

  const handleRenameHistoryEntry = useCallback(
    async (id: string) => {
      const entry = history.find((item) => item.id === id);
      if (!entry) {
        return;
      }
      const nextLabel = typeof window !== 'undefined'
        ? window.prompt('Set a label for this query', entry.label ?? '')
        : null;
      if (nextLabel === null) {
        return;
      }
      const sanitized = nextLabel.trim();
      const normalized = sanitized.length > 0 ? sanitized : null;
      const optimisticTimestamp = new Date().toISOString();
      setHistory((prev) => updateHistoryEntry(prev, id, { label: normalized, updatedAt: optimisticTimestamp }));

      if (!entry.pinned) {
        return;
      }

      try {
        const saved = await upsertSavedSqlQuery(authorizedFetch, {
          id,
          statement: entry.statement,
          label: normalized,
          stats: entry.stats ?? null
        });
        setHistory((prev) =>
          updateHistoryEntry(prev, id, {
            label: saved.label ?? null,
            stats: saved.stats ?? entry.stats,
            updatedAt: saved.updatedAt ?? saved.createdAt
          })
        );
        showSuccess('Saved query renamed', saved.label ?? 'Label cleared.');
      } catch (error) {
        setHistory((prev) =>
          updateHistoryEntry(prev, id, {
            label: entry.label ?? null,
            updatedAt: entry.updatedAt ?? entry.createdAt
          })
        );
        showError('Unable to rename query', error);
      }
    },
    [authorizedFetch, history, showError, showSuccess]
  );

  const canChart = useMemo(() => {
    if (!result || result.rows.length === 0) {
      return false;
    }
    const numericColumn = result.columns.find((column, index) => isNumericColumn(column, result.rows, index));
    return Boolean(numericColumn);
  }, [result]);

  const effectiveResultMode = canChart ? resultMode : resultMode === 'chart' ? 'table' : resultMode;

  return (
    <>
      <section className="flex flex-col gap-6">
        <header className={PANEL_ELEVATED}>
          <div className="flex flex-col gap-2">
            <h2 className="text-scale-lg font-weight-semibold text-primary">SQL Editor</h2>
            <p className={STATUS_MESSAGE}>
              Explore Timestore datasets with ad-hoc SQL. Use{' '}
              <kbd className={KBD_BADGE}>⌘/Ctrl + Enter</kbd> to run the current statement.
            </p>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <div className={PANEL_ELEVATED}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => runQueryRef.current()}
                  disabled={isExecuting}
                  className={PRIMARY_BUTTON}
                >
                  {isExecuting ? 'Running…' : 'Run query'}
                </button>
                <button
                  type="button"
                  onClick={() => setAiDialogOpen(true)}
                  disabled={!canUseAi || aiBusy}
                  className={PRIMARY_BUTTON_COMPACT}
                >
                  {aiBusy ? 'Preparing…' : 'Ask AI'}
                </button>
                <label className="flex items-center gap-2 text-scale-sm text-secondary">
                  <span className={FIELD_LABEL}>Max rows</span>
                  <input
                    type="number"
                    min={1}
                    value={maxRowsInput}
                    onChange={(event) => setMaxRowsInput(event.target.value)}
                    className={`${INPUT} w-24`}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 text-scale-xs text-muted">
                <button
                  type="button"
                  onClick={() => {
                    setStatement(DEFAULT_QUERY);
                    editorRef.current?.focus();
                  }}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Reset example
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyQuery();
                  }}
                  className={SECONDARY_BUTTON_COMPACT}
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
                options={{ renderValidationDecorations: 'off' }}
                onMount={handleEditorMount}
                ariaLabel="Timestore SQL editor"
              />
            </div>
            {queryError && (
              <div className={`mt-4 ${STATUS_BANNER_DANGER}`}>{queryError}</div>
            )}
          </div>

          <div className={PANEL_ELEVATED}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-scale-base font-weight-semibold text-primary">Results</h3>
                {result?.statistics && (
                  <p className={STATUS_META}>
                    {result.statistics.rowCount ?? result.rows.length} rows ·{' '}
                    {result.statistics.elapsedMs ? `${result.statistics.elapsedMs} ms` : 'runtime unknown'}
                  </p>
                )}
              </div>
              <div className={SEGMENTED_GROUP}>
                <button
                  type="button"
                  onClick={() => setResultMode('table')}
                  className={SEGMENTED_BUTTON(effectiveResultMode === 'table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setResultMode('json')}
                  className={SEGMENTED_BUTTON(effectiveResultMode === 'json')}
                >
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => setResultMode('chart')}
                  disabled={!canChart}
                  className={`${SEGMENTED_BUTTON(effectiveResultMode === 'chart')} ${!canChart ? 'opacity-50' : ''}`}
                >
                  Chart
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-scale-xs text-muted">
                <button
                  type="button"
                  onClick={() => {
                    void handleExportResults('csv', 'download');
                  }}
                  disabled={!canExport}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleExportResults('table', 'download');
                  }}
                  disabled={!canExport}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Download text
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleExportResults('table', 'open');
                  }}
                  disabled={!canExport}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Open in new tab
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyResults();
                  }}
                  disabled={!hasResults || isExecuting}
                  className={SECONDARY_BUTTON_COMPACT}
                >
                  Copy results
                </button>
              </div>
            </div>

            <div className="mt-4">
              {!result && !isExecuting && (
                <p className={STATUS_MESSAGE}>Run a query to see results here.</p>
              )}
              {isExecuting && (
                <div className={`flex items-center gap-3 ${STATUS_MESSAGE}`}>
                  <Spinner label="Executing query" />
                  <span>Executing query…</span>
                </div>
              )}
              {result && !isExecuting && effectiveResultMode === 'table' && (
                <div className={`${TABLE_CONTAINER} max-h-[420px] overflow-auto`}>
                  <table className="min-w-full divide-y divide-subtle text-left">
                    <thead className={TABLE_HEAD_ROW}>
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column.name} className={`${TABLE_CELL_PRIMARY} text-left font-weight-semibold`}>
                            {column.name}
                            {column.type && (
                              <span className={`ml-2 ${STATUS_META}`}>{column.type}</span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="transition-colors hover:bg-accent-soft/60">
                          {result.columns.map((column) => (
                            <td key={column.name} className={TABLE_CELL}>
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
                <div className={`${CARD_SURFACE_SOFT} overflow-x-auto`}>
                  <JsonSyntaxHighlighter value={result.rows} />
                </div>
              )}
              {result && !isExecuting && effectiveResultMode === 'chart' && canChart && (
                <SqlChart rows={result.rows} columns={result.columns} />
              )}
              {result?.warnings && result.warnings.length > 0 && (
                <div className={`mt-4 space-y-2 ${STATUS_BANNER_WARNING}`}>
                  <h4 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em]">Warnings</h4>
                  <ul className="list-disc space-y-1 pl-5 text-scale-sm">
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
          <div className={PANEL_ELEVATED}>
            <div className="flex items-center justify-between">
              <h3 className="text-scale-base font-weight-semibold text-primary">Schema</h3>
              <button
                type="button"
                onClick={() => void refetchSchema()}
                className={SECONDARY_BUTTON_COMPACT}
              >
                Refresh
              </button>
            </div>
            {schemaLoading && (
              <div className={`mt-4 flex items-center gap-2 ${STATUS_MESSAGE}`}>
                <Spinner label="Loading schema" />
                <span>Loading schema…</span>
              </div>
            )}
            {schemaErrorMessage ? (
              <div className={`mt-4 ${STATUS_BANNER_DANGER}`}>
                Failed to load schema: {schemaErrorMessage}
              </div>
            ) : null}
            {!schemaLoading && !schemaErrorMessage && (
              <div className="mt-4">
                <input
                  type="search"
                  value={schemaFilter}
                  onChange={(event) => setSchemaFilter(event.target.value)}
                  placeholder="Filter schema"
                  className={`${INPUT} w-full`}
                />
                <div className="mt-4 max-h-[320px] space-y-3 overflow-auto pr-1">
                  {filteredTables.map((table) => (
                    <details key={table.name} open className={`${CARD_SURFACE_SOFT}`}>
                      <summary className="flex items-center justify-between text-scale-sm font-weight-semibold text-primary">
                        <span>{table.name}</span>
                        {table.partitionKeys && table.partitionKeys.length > 0 && (
                          <span className={STATUS_META}>
                            partitions: {table.partitionKeys.join(', ')}
                          </span>
                        )}
                      </summary>
                      <ul className="mt-3 space-y-2 text-scale-sm text-secondary">
                        {table.columns.map((column) => (
                          <li key={column.name} className="flex flex-col">
                            <span className="font-mono text-scale-xs text-primary">{column.name}</span>
                            <span className={STATUS_META}>
                              {column.type ?? 'unknown'}
                              {column.nullable === false ? ' • not null' : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  {filteredTables.length === 0 && (
                    <p className={STATUS_MESSAGE}>
                      {schemaTables.length === 0
                        ? 'Schema metadata is not available yet.'
                        : 'No tables match the current filter.'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={PANEL_ELEVATED}>
            <div className="flex items-center justify-between">
              <h3 className="text-scale-base font-weight-semibold text-primary">History</h3>
              <button
                type="button"
                onClick={handleClearHistory}
                className={SECONDARY_BUTTON_COMPACT}
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
                className={`${INPUT} w-full`}
              />
            </div>
            <div className="mt-4 max-h-[320px] space-y-3 overflow-auto pr-1">
              {normalizedHistory.length === 0 && (
                <p className={STATUS_MESSAGE}>Recently executed queries will appear here.</p>
              )}
              {normalizedHistory.map((entry) => (
                <article
                  key={entry.id}
                  className={`${CARD_SURFACE} text-scale-sm transition-shadow ${entry.pinned ? 'border-accent bg-accent-soft shadow-elevation-md' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className={STATUS_META}>
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                      <pre className="whitespace-pre-wrap font-mono text-scale-xs text-primary">{entry.statement}</pre>
                    </div>
                    <div className={`flex flex-col items-end gap-1 ${STATUS_META}`}>
                      {entry.stats?.rowCount !== undefined && (
                        <span>{entry.stats.rowCount} rows</span>
                      )}
                      {entry.stats?.elapsedMs !== undefined && (
                        <span>{entry.stats.elapsedMs} ms</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-scale-xs">
                    <button
                      type="button"
                      onClick={() => handleRunHistoryEntry(entry)}
                      className={PRIMARY_BUTTON_COMPACT}
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadHistoryEntry(entry)}
                      className={SECONDARY_BUTTON_COMPACT}
                    >
                      Load
                    </button>
                    {entry.pinned && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleShareHistoryEntry(entry);
                        }}
                        className={SECONDARY_BUTTON_COMPACT}
                      >
                        Share
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void handleRenameHistoryEntry(entry.id);
                      }}
                      className={SECONDARY_BUTTON_COMPACT}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleTogglePin(entry.id);
                      }}
                      className={SECONDARY_BUTTON_COMPACT}
                    >
                      {entry.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteHistoryEntry(entry.id);
                      }}
                      className={DANGER_SECONDARY_BUTTON}
                    >
                      Delete
                    </button>
                  </div>
                  {entry.label && (
                    <p className={`mt-2 ${STATUS_META} font-weight-semibold uppercase tracking-[0.3em]`}>
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
      <TimestoreAiQueryDialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        schemaTables={schemaTables}
        authorizedFetch={authorizedFetch}
        onApply={handleAiResult}
        onBusyChange={handleAiBusyChange}
      />
    </>
  );
}

interface SqlChartProps {
  rows: Array<Record<string, unknown>>;
  columns: SqlQueryResult['columns'];
}

function SqlChart({ rows, columns }: SqlChartProps) {
  if (rows.length === 0) {
    return <p className={STATUS_MESSAGE}>No data to chart yet.</p>;
  }

  const numericColumn = columns.find((column, index) => isNumericColumn(column, rows, index));

  if (!numericColumn) {
    return <p className={STATUS_MESSAGE}>No numeric column available for charting.</p>;
  }

  const timeColumn = columns.find((column, index) => isTemporalColumn(column, rows, index));

  const values = rows
    .map((row, index) => ({
      xRaw: timeColumn ? row[timeColumn.name] : index,
      y: Number(row[numericColumn.name])
    }))
    .filter((point) => Number.isFinite(point.y));

  if (values.length === 0) {
    return <p className={STATUS_MESSAGE}>Unable to plot chart for the current result set.</p>;
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
            <stop offset="0%" stopColor="var(--color-accent-default)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent-default)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="var(--color-accent-default)"
          strokeWidth={2.5}
          points={points.join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className={STATUS_META}>
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
