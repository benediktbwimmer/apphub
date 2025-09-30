import { useMemo } from 'react';
import type { WorkflowRunMetricsSummary } from '../types';

const SECTION_CONTAINER = 'flex flex-col gap-4';
const SECTION_TITLE = 'text-scale-sm font-weight-semibold text-primary';
const SECTION_SUBTEXT = 'text-scale-xs text-secondary';
const CARD_CONTAINER = 'rounded-xl border border-subtle bg-surface-glass p-3 shadow-elevation-sm transition-colors';
const EMPTY_STATE_TEXT = 'flex h-32 items-center justify-center text-scale-sm text-secondary';
const HISTORY_CARD = 'rounded-lg border border-subtle bg-surface-muted p-3 text-scale-xs text-secondary';
const HISTORY_HEADING = 'mb-2 font-weight-semibold uppercase tracking-[0.3em] text-muted';

type WorkflowRunTrendsProps = {
  metrics: WorkflowRunMetricsSummary | null;
  history: WorkflowRunMetricsSummary[];
  selectedOutcomes: string[];
};

function buildSeriesPoints(
  metrics: WorkflowRunMetricsSummary | null,
  selectedOutcomes: string[]
) {
  if (!metrics || metrics.series.length === 0) {
    return [];
  }
  const lowered = selectedOutcomes.map((entry) => entry.toLowerCase());
  return metrics.series.map((point, index) => {
    const keys = lowered.length > 0 ? lowered : Object.keys(point.statusCounts);
    const total = keys.reduce((sum, key) => sum + (point.statusCounts[key] ?? 0), 0);
    return {
      index,
      count: total,
      duration: point.averageDurationMs ?? 0,
      label: new Date(point.bucketEnd).toLocaleTimeString()
    };
  });
}

function computeMax(values: number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

function formatBucket(bucket: WorkflowRunMetricsSummary['bucket']): string {
  if (!bucket) {
    return 'auto';
  }
  if (bucket.key === '15m') {
    return '15 minutes';
  }
  if (bucket.key === 'hour') {
    return 'Hourly';
  }
  if (bucket.key === 'day') {
    return 'Daily';
  }
  return bucket.interval;
}

function formatHistoryEntry(entry: WorkflowRunMetricsSummary): string {
  const last = entry.series[entry.series.length - 1];
  if (!last) {
    return `${new Date(entry.range.to).toLocaleString()}: no runs`;
  }
  return `${new Date(entry.range.to).toLocaleString()}: ${last.rollingSuccessCount} successes`;
}

export default function WorkflowRunTrends({ metrics, history, selectedOutcomes }: WorkflowRunTrendsProps) {
  const points = useMemo(() => buildSeriesPoints(metrics, selectedOutcomes), [
    metrics,
    selectedOutcomes
  ]);

  const counts = points.map((point) => point.count);
  const durations = points.map((point) => point.duration ?? 0);
  const maxCount = computeMax(counts) || 1;
  const maxDuration = computeMax(durations) || 1;
  const chartHeight = 80;

  const polylinePath = points
    .map((point, index) => {
      const x = points.length > 1 ? (index / (points.length - 1)) * 100 : 50;
      const y = chartHeight - (point.count / maxCount) * chartHeight;
      return `${x},${y}`;
    })
    .join(' ');

  const durationPath = points
    .map((point, index) => {
      const x = points.length > 1 ? (index / (points.length - 1)) * 100 : 50;
      const y = chartHeight - (point.duration / maxDuration) * chartHeight;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className={SECTION_CONTAINER}>
      <div>
        <h4 className={SECTION_TITLE}>Trend overview</h4>
        {metrics ? (
          <p className={SECTION_SUBTEXT}>
            Bucket: {formatBucket(metrics.bucket)} · Range: {new Date(metrics.range.from).toLocaleString()} –{' '}
            {new Date(metrics.range.to).toLocaleString()}
          </p>
        ) : (
          <p className={SECTION_SUBTEXT}>No trend data available.</p>
        )}
      </div>
      <div className={CARD_CONTAINER}>
        {points.length > 0 ? (
          <svg viewBox="0 0 100 80" className="h-36 w-full">
            <polyline
              fill="none"
              stroke="url(#count-gradient)"
              strokeWidth="2"
              points={polylinePath}
              strokeLinecap="round"
            />
            <polyline
              fill="none"
              stroke="color-mix(in srgb, var(--color-accent-default) 55%, transparent)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              points={durationPath}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="count-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-default)" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--color-accent-default) 20%, transparent)" />
              </linearGradient>
            </defs>
          </svg>
        ) : (
          <div className={EMPTY_STATE_TEXT}>
            No recent runs in this range.
          </div>
        )}
      </div>
      {history.length > 0 && (
        <div className={HISTORY_CARD}>
          <p className={HISTORY_HEADING}>Snapshots</p>
          <ul className="space-y-1">
            {history.slice(-3).map((entry, index) => (
              <li key={`${entry.range.to}-${index}`}>{formatHistoryEntry(entry)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
