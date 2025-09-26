import { useMemo } from 'react';
import type { LifecycleMetricsSnapshot } from '../types';
import { findMetricValue, parsePrometheusMetrics, sumMetricValues } from '../utils';

interface MetricsSummaryProps {
  lifecycleMetrics: LifecycleMetricsSnapshot | null;
  metricsText: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatRate(success: number, failure: number): string {
  const total = success + failure;
  if (total === 0) {
    return 'n/a';
  }
  return `${Math.round((success / total) * 100)}% success`;
}

function formatDuration(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'n/a';
  }
  if (!Number.isFinite(value)) {
    return `${value}`;
  }
  if (value >= 1) {
    return `${value.toFixed(2)} s`;
  }
  return `${(value * 1000).toFixed(0)} ms`;
}

export function MetricsSummary({ lifecycleMetrics, metricsText, loading, error, onRefresh }: MetricsSummaryProps) {
  const derived = useMemo(() => {
    if (!metricsText) {
      return null;
    }
    const parsed = parsePrometheusMetrics(metricsText);
    const ingestSuccess = sumMetricValues(parsed, 'timestore_ingest_requests_total', { result: 'success' });
    const ingestFailure = sumMetricValues(parsed, 'timestore_ingest_requests_total', { result: 'failure' });
    const ingestQueueWaiting = findMetricValue(parsed, 'timestore_ingest_queue_jobs', { state: 'waiting' }) ?? 0;
    const lifecycleQueueWaiting = findMetricValue(parsed, 'timestore_lifecycle_queue_jobs', { state: 'waiting' }) ?? 0;

    const queryDurationSum = sumMetricValues(parsed, 'timestore_query_duration_seconds_sum');
    const queryDurationCount = sumMetricValues(parsed, 'timestore_query_duration_seconds_count');
    const queryAverage = queryDurationCount > 0 ? queryDurationSum / queryDurationCount : null;
    const ingestDurationSum = sumMetricValues(parsed, 'timestore_ingest_duration_seconds_sum');
    const ingestDurationCount = sumMetricValues(parsed, 'timestore_ingest_duration_seconds_count');
    const ingestAverage = ingestDurationCount > 0 ? ingestDurationSum / ingestDurationCount : null;
    const queryTotal = sumMetricValues(parsed, 'timestore_query_requests_total');

    return {
      ingestSuccess,
      ingestFailure,
      ingestQueueWaiting,
      lifecycleQueueWaiting,
      queryAverage,
      ingestAverage,
      queryTotal
    };
  }, [metricsText]);

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Metrics</span>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">Operational snapshot</h4>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
        >
          Refresh
        </button>
      </header>
      {loading ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Loading metrics…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{error}</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <MetricCard
            title="Ingestion"
            primary={derived ? formatRate(derived.ingestSuccess, derived.ingestFailure) : 'n/a'}
            secondary={`Queue waiting: ${derived ? derived.ingestQueueWaiting : 'n/a'}`}
            tertiary={`Avg duration: ${formatDuration(derived?.ingestAverage ?? null)}`}
          />
          <MetricCard
            title="Queries"
            primary={`${derived ? derived.queryTotal : 'n/a'} total`}
            secondary={`Avg duration: ${formatDuration(derived?.queryAverage ?? null)}`}
            tertiary={`Lifecycle queue waiting: ${derived ? derived.lifecycleQueueWaiting : 'n/a'}`}
          />
          <MetricCard
            title="Lifecycle summary"
            primary={`Completed: ${lifecycleMetrics?.jobsCompleted ?? 0}`}
            secondary={`Failed: ${lifecycleMetrics?.jobsFailed ?? 0}`}
            tertiary={`Last run: ${formatInstant(lifecycleMetrics?.lastRunAt ?? null)}`}
          />
          <MetricCard
            title="Lifecycle operations"
            primary={`Compactions: ${lifecycleMetrics?.operationTotals.compaction.count ?? 0}`}
            secondary={`Retention: ${lifecycleMetrics?.operationTotals.retention.count ?? 0}`}
            tertiary={`Exports: ${lifecycleMetrics?.operationTotals.parquetExport.count ?? 0}`}
          />
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  primary: string;
  secondary: string;
  tertiary: string;
}

function MetricCard({ title, primary, secondary, tertiary }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
      <h5 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{title}</h5>
      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{primary}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{secondary}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{tertiary}</p>
    </div>
  );
}
