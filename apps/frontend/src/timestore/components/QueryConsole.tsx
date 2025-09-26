import { useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { useToastHelpers } from '../../components/toast';
import { runDatasetQuery } from '../api';
import type { QueryResponse } from '../types';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { formatInstant } from '../utils';

const PRESETS = [
  { id: '1h', label: 'Last 1 hour', ms: 60 * 60 * 1000 },
  { id: '6h', label: 'Last 6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'custom', label: 'Custom range', ms: 0 }
] as const;

const AGGREGATION_FUNCS = ['avg', 'min', 'max', 'sum', 'median', 'count', 'count_distinct', 'percentile'] as const;

type AggregationFn = (typeof AGGREGATION_FUNCS)[number];

interface QueryConsoleProps {
  datasetSlug: string | null;
  defaultTimestampColumn?: string;
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

export function QueryConsole({ datasetSlug, defaultTimestampColumn = 'timestamp', canQuery }: QueryConsoleProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError } = useToastHelpers();
  const [presetId, setPresetId] = useState<typeof PRESETS[number]['id']>('6h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [timestampColumn, setTimestampColumn] = useState(defaultTimestampColumn);
  const [columnsInput, setColumnsInput] = useState('');
  const [limitInput, setLimitInput] = useState('500');
  const [downsampleEnabled, setDownsampleEnabled] = useState(false);
  const [intervalSize, setIntervalSize] = useState('5');
  const [intervalUnit, setIntervalUnit] = useState<'minute' | 'hour' | 'day'>('minute');
  const [aggregationFn, setAggregationFn] = useState<AggregationFn>('avg');
  const [aggregationColumn, setAggregationColumn] = useState('value');
  const [aggregationAlias, setAggregationAlias] = useState('avg_value');
  const [aggregationPercentile, setAggregationPercentile] = useState('0.95');
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResultState | null>(null);

  useEffect(() => {
    setTimestampColumn(defaultTimestampColumn);
  }, [defaultTimestampColumn]);

  useEffect(() => {
    setResult(null);
    setQueryError(null);
  }, [datasetSlug]);

  const preset = useMemo(() => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0], [presetId]);

  const handleRunQuery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!datasetSlug) {
      setQueryError('Select a dataset before running queries.');
      return;
    }
    if (!canQuery) {
      setQueryError('timestore:read scope is required to execute queries.');
      return;
    }

    const { start, end } = deriveTimeRange(preset, customStart, customEnd);
    if (!start || !end) {
      setQueryError('Provide a valid start and end time.');
      return;
    }

    const limit = parseInt(limitInput, 10);
    const columns = columnsInput
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const requestBody: Record<string, unknown> = {
      timeRange: { start, end },
      timestampColumn: timestampColumn.trim() || 'timestamp'
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
        setQueryError('Downsample interval size must be greater than zero.');
        return;
      }
      const aggregation: Record<string, unknown> = {
        fn: aggregationFn,
        column: aggregationColumn.trim()
      };
      if (!aggregation.column) {
        setQueryError('Provide a column name for aggregation.');
        return;
      }
      if (aggregationFn === 'percentile') {
        const percentile = parseFloat(aggregationPercentile);
        if (Number.isNaN(percentile) || percentile <= 0 || percentile >= 1) {
          setQueryError('Percentile must be between 0 and 1.');
          return;
        }
        aggregation.percentile = percentile;
      }
      if (aggregationAlias.trim()) {
        aggregation.alias = aggregationAlias.trim();
      }
      requestBody.downsample = {
        intervalUnit,
        intervalSize: size,
        aggregations: [aggregation]
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
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Query</span>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ad-hoc query console</h4>
        </div>
      </header>
      <form className="mt-4 space-y-4" onSubmit={handleRunQuery}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Time range</span>
            <select
              value={presetId}
              onChange={(event) => setPresetId(event.target.value as typeof presetId)}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
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
              <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Start</span>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">End</span>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                />
              </label>
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Timestamp column</span>
            <input
              type="text"
              value={timestampColumn}
              onChange={(event) => setTimestampColumn(event.target.value)}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Columns (comma separated)</span>
            <input
              type="text"
              value={columnsInput}
              onChange={(event) => setColumnsInput(event.target.value)}
              placeholder="Leave blank for all"
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Row limit</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={limitInput}
              onChange={(event) => setLimitInput(event.target.value)}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
          </label>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={downsampleEnabled}
              onChange={(event) => setDownsampleEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            Enable downsampling
          </label>
          {downsampleEnabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={intervalSize}
                  onChange={(event) => setIntervalSize(event.target.value)}
                  className="w-20 rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                />
                <select
                  value={intervalUnit}
                  onChange={(event) => setIntervalUnit(event.target.value as typeof intervalUnit)}
                  className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                >
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aggregation</span>
                  <select
                    value={aggregationFn}
                    onChange={(event) => setAggregationFn(event.target.value as AggregationFn)}
                    className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                  >
                    {AGGREGATION_FUNCS.map((fn) => (
                      <option key={fn} value={fn}>
                        {fn}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Column</span>
                  <input
                    type="text"
                    value={aggregationColumn}
                    onChange={(event) => setAggregationColumn(event.target.value)}
                    className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Alias</span>
                  <input
                    type="text"
                    value={aggregationAlias}
                    onChange={(event) => setAggregationAlias(event.target.value)}
                    className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                  />
                </div>
                {aggregationFn === 'percentile' && (
                  <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Percentile</span>
                    <input
                      type="number"
                      min={0.01}
                      max={0.99}
                      step="0.01"
                      value={aggregationPercentile}
                      onChange={(event) => setAggregationPercentile(event.target.value)}
                      className="w-28 rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={queryLoading}
          className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run query
        </button>
      </form>

      {queryError && <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{queryError}</p>}

      {queryLoading && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Running query…</p>}

      {result && (
        <section className="mt-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              Returned {result.response.rows.length} rows ({result.response.mode})
            </span>
            <span>Requested {formatInstant(result.requestedAt)}</span>
          </div>
          <div className="overflow-auto rounded-2xl border border-slate-200/70 dark:border-slate-700/60">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-100/80 text-xs uppercase tracking-[0.2em] text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  {result.response.columns.map((column) => (
                    <th key={column} className="px-4 py-2 text-left font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsToRender.map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-white even:bg-slate-50/80 dark:odd:bg-slate-900/70 dark:even:bg-slate-800/70">
                    {result.response.columns.map((column) => (
                      <td key={`${rowIndex}-${column}`} className="px-4 py-2 text-slate-700 dark:text-slate-200">
                        {renderCellValue(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.response.rows.length > rowsToRender.length && (
              <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                Showing first {rowsToRender.length} rows.
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
            <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Response JSON</h5>
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
