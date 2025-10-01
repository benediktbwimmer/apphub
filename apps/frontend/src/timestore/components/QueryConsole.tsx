import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import { runDatasetQuery } from '../api';
import type { DatasetSchemaField, QueryResponse } from '../types';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { formatInstant } from '../utils';
import {
  BADGE_PILL,
  BADGE_PILL_ACCENT,
  BADGE_PILL_MUTED,
  CARD_SURFACE,
  CARD_SURFACE_SOFT,
  CHECKBOX_INPUT,
  FIELD_GROUP,
  FIELD_LABEL,
  FOCUS_RING,
  INPUT,
  PANEL_SURFACE_LARGE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

const PRESETS = [
  { id: '1h', label: 'Last 1 hour', ms: 60 * 60 * 1000 },
  { id: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'custom', label: 'Custom range', ms: 0 }
] as const;

const AGGREGATION_FUNCS = ['avg', 'min', 'max', 'sum', 'median', 'count', 'count_distinct', 'percentile'] as const;

type AggregationFn = (typeof AGGREGATION_FUNCS)[number];

const DEFAULT_LIMIT = '500';
const DEFAULT_PERCENTILE = '0.95';

const PANEL_SHADOW = 'shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]';
const FIELD_TYPE_HELPER = 'text-scale-2xs uppercase tracking-[0.2em] text-muted';
const TABLE_CONTAINER = 'overflow-auto rounded-2xl border border-subtle bg-surface-glass-soft';
const TABLE_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm text-secondary';
const TABLE_HEAD_CELL = 'bg-surface-muted text-scale-2xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

type AggregationRow = {
  id: string;
  fn: AggregationFn;
  column: string;
  alias: string;
  percentile: string;
};

function isNumericType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized === 'double' || normalized === 'integer' || normalized === 'number' || normalized === 'float' || normalized === 'decimal';
}

function buildDefaultAlias(fn: AggregationFn, column: string): string {
  const normalizedColumn = column.trim();
  if (!normalizedColumn) {
    return fn;
  }
  return `${fn}_${normalizedColumn}`.replace(/[^a-z0-9_]+/gi, '_');
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface QueryConsoleProps {
  datasetSlug: string | null;
  defaultTimestampColumn?: string;
  schemaFields?: DatasetSchemaField[];
  canQuery: boolean;
}

interface QueryResultState {
  response: QueryResponse;
  requestedAt: string;
  requestBody: unknown;
}

function deriveTimeRange(preset: typeof PRESETS[number], customStart: string, customEnd: string): { start: string; end: string } {
  if (preset.id === 'custom') {
    return {
      start: customStart,
      end: customEnd
    };
  }
  const end = new Date();
  const start = new Date(end.getTime() - preset.ms);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export function QueryConsole({
  datasetSlug,
  defaultTimestampColumn = 'timestamp',
  schemaFields = [],
  canQuery
}: QueryConsoleProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError } = useToastHelpers();
  const [presetId, setPresetId] = useState<typeof PRESETS[number]['id']>('6h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [timestampColumn, setTimestampColumn] = useState(defaultTimestampColumn);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [customColumnInput, setCustomColumnInput] = useState('');
  const [limitInput, setLimitInput] = useState(DEFAULT_LIMIT);
  const [downsampleEnabled, setDownsampleEnabled] = useState(false);
  const [intervalSize, setIntervalSize] = useState('5');
  const [intervalUnit, setIntervalUnit] = useState<'minute' | 'hour' | 'day'>('minute');
  const [aggregations, setAggregations] = useState<AggregationRow[]>([]);
  const aggregationIdRef = useRef(0);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResultState | null>(null);

  useEffect(() => {
    setTimestampColumn(defaultTimestampColumn);
  }, [defaultTimestampColumn]);

  useEffect(() => {
    setResult(null);
    setQueryError(null);
    setSelectedColumns([]);
    setColumnSearch('');
    setCustomColumnInput('');
    setDownsampleEnabled(false);
  }, [datasetSlug]);

  const preset = useMemo(() => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0], [presetId]);

  const schemaFieldNames = useMemo(() => new Set(schemaFields.map((field) => field.name)), [schemaFields]);

  const numericSchemaFields = useMemo(
    () => schemaFields.filter((field) => isNumericType(field.type)),
    [schemaFields]
  );

  const defaultValueColumn = useMemo(() => {
    if (numericSchemaFields.length > 0) {
      return numericSchemaFields[0]?.name ?? 'value';
    }
    if (schemaFields.length > 0) {
      return schemaFields[0]?.name ?? 'value';
    }
    return 'value';
  }, [numericSchemaFields, schemaFields]);

  const columnDatalistId = useMemo(
    () => `timestore-query-console-columns-${datasetSlug ?? 'none'}`,
    [datasetSlug]
  );

  const filteredSchemaFields = useMemo(() => {
    const query = columnSearch.trim().toLowerCase();
    if (!query) {
      return schemaFields;
    }
    return schemaFields.filter((field) => {
      const haystack = `${field.name} ${field.type ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [columnSearch, schemaFields]);

  const createAggregationRow = useCallback(
    (overrides: Partial<Omit<AggregationRow, 'id'>> = {}) => {
      const fn = overrides.fn ?? 'avg';
      const column = overrides.column ?? defaultValueColumn;
      const alias = overrides.alias ?? buildDefaultAlias(fn, column);
      return {
        id: `agg-${aggregationIdRef.current++}`,
        fn,
        column,
        alias,
        percentile: overrides.percentile ?? DEFAULT_PERCENTILE
      } satisfies AggregationRow;
    },
    [defaultValueColumn]
  );

  useEffect(() => {
    aggregationIdRef.current = 0;
    setAggregations([createAggregationRow()]);
  }, [createAggregationRow, datasetSlug]);

  const handleValidationError = useCallback(
    (message: string) => {
      setQueryError(message);
      showError('Query validation failed', new Error(message));
    },
    [showError]
  );

  const handleToggleColumn = useCallback((column: string) => {
    setSelectedColumns((current) => {
      if (current.includes(column)) {
        return current.filter((item) => item !== column);
      }
      return [...current, column];
    });
  }, []);

  const handleRemoveColumn = useCallback((column: string) => {
    setSelectedColumns((current) => current.filter((item) => item !== column));
  }, []);

  const handleClearColumns = useCallback(() => {
    setSelectedColumns([]);
  }, []);

  const handleAddCustomColumn = useCallback(() => {
    const trimmed = customColumnInput.trim();
    if (!trimmed) {
      return;
    }
    setSelectedColumns((current) => {
      if (current.includes(trimmed)) {
        return current;
      }
      return [...current, trimmed];
    });
    setCustomColumnInput('');
  }, [customColumnInput]);

  const handleCustomColumnKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleAddCustomColumn();
      }
    },
    [handleAddCustomColumn]
  );

  const handleAggregationUpdate = useCallback(
    (id: string, patch: Partial<Omit<AggregationRow, 'id'>>) => {
      setAggregations((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
      );
    },
    []
  );

  const handleRemoveAggregation = useCallback((id: string) => {
    setAggregations((rows) => rows.filter((row) => row.id !== id));
  }, []);

  const handleAddAggregation = useCallback(() => {
    setAggregations((rows) => [...rows, createAggregationRow()]);
  }, [createAggregationRow]);

  const handleRunQuery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!datasetSlug) {
      handleValidationError('Select a dataset before running queries.');
      return;
    }
    if (!canQuery) {
      handleValidationError('timestore:read scope is required to execute queries.');
      return;
    }

    const { start, end } = deriveTimeRange(preset, customStart, customEnd);
    if (!start || !end) {
      handleValidationError('Provide a valid start and end time.');
      return;
    }

    const limit = parseInt(limitInput, 10);
    const normalizedTimestamp = timestampColumn.trim() || 'timestamp';

    if (schemaFieldNames.size > 0 && normalizedTimestamp && !schemaFieldNames.has(normalizedTimestamp)) {
      handleValidationError(`Timestamp column "${normalizedTimestamp}" is not present in the dataset schema.`);
      return;
    }

    const columns = uniqueList(
      selectedColumns
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    );

    if (schemaFieldNames.size > 0) {
      const invalidColumn = columns.find((column) => !schemaFieldNames.has(column));
      if (invalidColumn) {
        handleValidationError(`Column "${invalidColumn}" is not present in the dataset schema.`);
        return;
      }
    }

    const requestBody: Record<string, unknown> = {
      timeRange: { start, end },
      timestampColumn: normalizedTimestamp
    };

    if (!Number.isNaN(limit) && limit > 0) {
      requestBody.limit = limit;
    }

    if (columns.length > 0) {
      requestBody.columns = columns;
    }

    if (downsampleEnabled) {
      const size = parseInt(intervalSize, 10);
      if (Number.isNaN(size) || size <= 0) {
        handleValidationError('Downsample interval size must be greater than zero.');
        return;
      }
      if (aggregations.length === 0) {
        handleValidationError('Add at least one aggregation to downsample.');
        return;
      }
      const aggregationPayload: Array<Record<string, unknown>> = [];
      for (const row of aggregations) {
        const column = row.column.trim();
        if (!column) {
          handleValidationError('Provide a column name for each aggregation.');
          return;
        }
        if (schemaFieldNames.size > 0 && !schemaFieldNames.has(column)) {
          handleValidationError(`Aggregation column "${column}" is not present in the dataset schema.`);
          return;
        }
        const aggregationEntry: Record<string, unknown> = {
          fn: row.fn,
          column
        };
        if (row.fn === 'percentile') {
          const percentileValue = parseFloat(row.percentile);
          if (Number.isNaN(percentileValue) || percentileValue <= 0 || percentileValue >= 1) {
            handleValidationError('Percentile must be between 0 and 1 (exclusive).');
            return;
          }
          aggregationEntry.percentile = percentileValue;
        }
        if (row.alias.trim()) {
          aggregationEntry.alias = row.alias.trim();
        }
        aggregationPayload.push(aggregationEntry);
      }

      requestBody.downsample = {
        intervalUnit,
        intervalSize: size,
        aggregations: aggregationPayload
      };
    }

    setQueryLoading(true);
    setQueryError(null);
    try {
      const response = await runDatasetQuery(authorizedFetch, datasetSlug, requestBody);
      setResult({
        response,
        requestedAt: new Date().toISOString(),
        requestBody
      });
      showSuccess('Query succeeded', `${response.rows.length} rows returned.`);
    } catch (err) {
      setResult(null);
      setQueryError(err instanceof Error ? err.message : 'Failed to execute query');
      showError('Query failed', err);
    } finally {
      setQueryLoading(false);
    }
  };

  const rowsToRender = result ? result.response.rows.slice(0, 200) : [];

  return (
    <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW}`}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">Query</span>
          <h4 className="text-scale-base font-weight-semibold text-primary">Ad-hoc query console</h4>
        </div>
      </header>
  <form data-testid="query-console-form" className="mt-4 space-y-4" onSubmit={handleRunQuery}>
    <datalist id={columnDatalistId}>
      {schemaFields.map((field) => (
        <option key={field.name} value={field.name} label={`${field.name} (${field.type})`} />
      ))}
    </datalist>
    <div className="grid gap-4 md:grid-cols-2">
      <label className={FIELD_GROUP}>
        <span className={FIELD_LABEL}>Time range</span>
        <select
          value={presetId}
          onChange={(event) => setPresetId(event.target.value as typeof presetId)}
          className={INPUT}
        >
          {PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
              ))}
            </select>
          </label>
          {presetId === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD_GROUP}>
                <span className={FIELD_LABEL}>Start</span>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className={INPUT}
                />
              </label>
              <label className={FIELD_GROUP}>
                <span className={FIELD_LABEL}>End</span>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className={INPUT}
                />
              </label>
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Timestamp column</span>
            <input
              type="text"
              value={timestampColumn}
              onChange={(event) => setTimestampColumn(event.target.value)}
              list={columnDatalistId}
              className={INPUT}
            />
          </label>
          <div className="flex flex-col gap-2 text-scale-sm text-secondary">
            <span className={FIELD_LABEL}>Columns</span>
            {schemaFields.length > 0 ? (
              <>
                <input
                  type="text"
                  value={columnSearch}
                  onChange={(event) => setColumnSearch(event.target.value)}
                  placeholder="Filter columns"
                  className={INPUT}
                />
                <div className={`${CARD_SURFACE_SOFT} flex max-h-40 flex-wrap gap-2 overflow-auto`}> 
                  {filteredSchemaFields.length === 0 ? (
                    <span className={`text-scale-xs text-muted`}>No columns match your filter.</span>
                  ) : (
                    filteredSchemaFields.map((field) => {
                      const checked = selectedColumns.includes(field.name);
                      return (
                        <label
                          key={field.name}
                          className={`${checked ? BADGE_PILL_ACCENT : BADGE_PILL_MUTED} cursor-pointer gap-2 transition-colors`}
                        >
                          <input
                            type="checkbox"
                            className={CHECKBOX_INPUT}
                            checked={checked}
                            onChange={() => handleToggleColumn(field.name)}
                          />
                          <span className="text-scale-xs font-weight-semibold text-primary">{field.name}</span>
                          <span className={FIELD_TYPE_HELPER}>{field.type}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <p className={STATUS_MESSAGE}>
                Schema metadata unavailable. Add columns manually below or leave empty to select all.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {selectedColumns.length === 0 ? (
                <span className={STATUS_META}>All columns will be returned.</span>
              ) : (
                selectedColumns.map((column) => (
                  <span key={column} className={`${BADGE_PILL} gap-2`}>
                    {column}
                    <button
                      type="button"
                      onClick={() => handleRemoveColumn(column)}
                      className="text-muted transition-colors hover:text-status-danger"
                      aria-label={`Remove column ${column}`}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={customColumnInput}
                onChange={(event) => setCustomColumnInput(event.target.value)}
                onKeyDown={handleCustomColumnKeyDown}
                placeholder="Add column"
                list={columnDatalistId}
                className={`${INPUT} flex-1 min-w-[160px]`}
              />
              <button
                type="button"
                onClick={handleAddCustomColumn}
                className={SECONDARY_BUTTON_COMPACT}
              >
                Add
              </button>
              <button
                type="button"
                onClick={handleClearColumns}
                disabled={selectedColumns.length === 0}
                className={SECONDARY_BUTTON_COMPACT}
              >
                Clear
              </button>
            </div>
          </div>
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Row limit</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={limitInput}
              onChange={(event) => setLimitInput(event.target.value)}
              className={INPUT}
            />
          </label>
        </div>
        <div className={`${CARD_SURFACE_SOFT} space-y-3`}>
          <label className="inline-flex items-center gap-2 text-scale-sm text-secondary">
            <input
              type="checkbox"
              checked={downsampleEnabled}
              onChange={(event) => setDownsampleEnabled(event.target.checked)}
              className={CHECKBOX_INPUT}
            />
            Enable downsampling
          </label>
          {downsampleEnabled && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={intervalSize}
                  onChange={(event) => setIntervalSize(event.target.value)}
                  className={`${INPUT} w-24`}
                />
                <select
                  value={intervalUnit}
                  onChange={(event) => setIntervalUnit(event.target.value as typeof intervalUnit)}
                  className={INPUT}
                >
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
              <div className="space-y-3">
                {aggregations.map((row, index) => {
                  const field = schemaFields.find((item) => item.name === row.column);
                  const showRemove = aggregations.length > 1;
                  return (
                    <div
                      key={row.id}
                      className={`${CARD_SURFACE} flex flex-col gap-3 md:flex-row md:items-end`}
                    >
                      <label className={FIELD_GROUP}>
                        <span className={FIELD_LABEL}>Aggregation</span>
                        <select
                          value={row.fn}
                          onChange={(event) => handleAggregationUpdate(row.id, { fn: event.target.value as AggregationFn })}
                          className={INPUT}
                        >
                          {AGGREGATION_FUNCS.map((fn) => (
                            <option key={fn} value={fn}>
                              {fn}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={FIELD_GROUP}>
                        <span className={FIELD_LABEL}>Column</span>
                        <input
                          type="text"
                          value={row.column}
                          onChange={(event) => handleAggregationUpdate(row.id, { column: event.target.value })}
                          list={columnDatalistId}
                          placeholder="Column name"
                          className={INPUT}
                        />
                        {field ? <span className={FIELD_TYPE_HELPER}>{field.type}</span> : null}
                      </label>
                      <label className={FIELD_GROUP}>
                        <span className={FIELD_LABEL}>Alias</span>
                        <input
                          type="text"
                          value={row.alias}
                          onChange={(event) => handleAggregationUpdate(row.id, { alias: event.target.value })}
                          placeholder="Optional"
                          className={INPUT}
                        />
                      </label>
                      {row.fn === 'percentile' && (
                        <label className={FIELD_GROUP}>
                          <span className={FIELD_LABEL}>Percentile</span>
                          <input
                            type="number"
                            min={0.01}
                            max={0.99}
                            step="0.01"
                            value={row.percentile}
                            onChange={(event) => handleAggregationUpdate(row.id, { percentile: event.target.value })}
                            className={`${INPUT} w-32`}
                          />
                        </label>
                      )}
                      {showRemove && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAggregation(row.id)}
                          className={`self-start rounded-full border border-status-danger px-3 py-1 text-scale-xs font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft ${FOCUS_RING}`}
                        >
                          Remove
                        </button>
                      )}
                      <span className="sr-only">Aggregation row {index + 1}</span>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={handleAddAggregation}
                  className={`${SECONDARY_BUTTON_COMPACT} inline-flex items-center gap-2`}
                >
                  + Add aggregation
                </button>
              </div>
            </div>
          )}
        </div>
        <button type="submit" disabled={queryLoading} className={PRIMARY_BUTTON}>
          Run query
        </button>
      </form>

      {queryError && (
        <div role="alert" data-testid="query-console-error" className={`mt-4 ${STATUS_BANNER_DANGER}`}>
          {queryError}
        </div>
      )}

      {queryLoading && <p className={`mt-4 ${STATUS_MESSAGE}`}>Running query…</p>}

      {result && (
        <section className="mt-6 space-y-4">
          <div className={`flex items-center justify-between ${STATUS_META}`}>
            <span>
              Returned {result.response.rows.length} rows ({result.response.mode})
            </span>
            <span>Requested {formatInstant(result.requestedAt)}</span>
          </div>
          <div className={TABLE_CONTAINER}>
            <table className={TABLE_CLASSES}>
              <thead className="bg-surface-muted">
                <tr>
                  {result.response.columns.map((column) => (
                    <th key={column} className={`px-4 py-2 text-left ${TABLE_HEAD_CELL}`}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {rowsToRender.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {result.response.columns.map((column) => (
                      <td key={`${rowIndex}-${column}`} className="px-4 py-2 text-secondary">
                        {renderCellValue(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.response.rows.length > rowsToRender.length && (
              <div className={`px-4 py-2 ${STATUS_META}`}>
                Showing first {rowsToRender.length} rows.
              </div>
            )}
          </div>
          <div className={CARD_SURFACE_SOFT}>
            <h5 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
              Response JSON
            </h5>
            <div className="mt-2 overflow-x-auto">
              <JsonSyntaxHighlighter value={result.response} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : String(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
