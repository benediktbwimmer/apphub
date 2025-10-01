import { useMemo } from 'react';
import type { LifecycleMetricsSnapshot } from '../types';
import { findMetricValue, formatInstant, parsePrometheusMetrics, sumMetricValues } from '../utils';
import {
  CARD_SURFACE_SOFT,
  PANEL_SURFACE_LARGE,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  STATUS_META
} from '../timestoreTokens';

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

const PANEL_SHADOW = 'shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]';

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
    <div className={`${PANEL_SURFACE_LARGE} ${PANEL_SHADOW}`}>
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent">Metrics</span>
          <h4 className="text-scale-base font-weight-semibold text-primary">Operational snapshot</h4>
        </div>
        <button type="button" onClick={onRefresh} className={SECONDARY_BUTTON_COMPACT}>
          Refresh
        </button>
      </header>
      {loading ? (
        <p className={`mt-4 ${STATUS_MESSAGE}`}>Loading metrics…</p>
      ) : error ? (
        <div className={`mt-4 ${STATUS_BANNER_DANGER}`}>{error}</div>
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
    <div className={`${CARD_SURFACE_SOFT} text-scale-sm`}>
      <h5 className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">{title}</h5>
      <p className="mt-2 text-scale-lg font-weight-semibold text-primary">{primary}</p>
      <p className={STATUS_META}>{secondary}</p>
      <p className={STATUS_META}>{tertiary}</p>
    </div>
  );
}
