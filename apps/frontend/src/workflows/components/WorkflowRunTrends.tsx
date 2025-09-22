import { useMemo } from 'react';
import type { WorkflowRunMetricsSummary } from '../types';

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
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Trend overview</h4>
        {metrics ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Bucket: {formatBucket(metrics.bucket)} · Range: {new Date(metrics.range.from).toLocaleString()} –{' '}
            {new Date(metrics.range.to).toLocaleString()}
          </p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">No trend data available.</p>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700/40 dark:bg-slate-900/40">
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
              stroke="rgba(99,102,241,0.5)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              points={durationPath}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="count-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(79,70,229)" />
                <stop offset="100%" stopColor="rgba(79,70,229,0.2)" />
              </linearGradient>
            </defs>
          </svg>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            No recent runs in this range.
          </div>
        )}
      </div>
      {history.length > 0 && (
        <div className="rounded-lg bg-slate-100/70 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          <p className="mb-2 font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Snapshots</p>
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
