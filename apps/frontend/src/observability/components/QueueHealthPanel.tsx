import classNames from 'classnames';
import type { QueueHealthSnapshot } from '../types';
import { QueueStateBar, QueueStateLegend } from './QueueStateBar';

const PANEL_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

export function QueueHealthPanel({
  snapshot,
  loading,
  error,
  onRefresh
}: {
  snapshot: QueueHealthSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className={PANEL_CLASSES}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-scale-base font-weight-semibold text-primary">Live queue health</h2>
          <span className="text-scale-xs text-muted">
            {snapshot?.generatedAt ? `Snapshot ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : 'Awaiting data…'}
          </span>
        </div>
        <button
          type="button"
          className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:bg-surface-glass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          onClick={() => {
            onRefresh();
          }}
          disabled={loading}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="mt-4 rounded-2xl border border-status-danger bg-status-danger-soft px-4 py-3 text-scale-xs text-status-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {snapshot?.queues.map((queue) => (
          <article key={queue.key} className="flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass-soft p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-scale-sm font-weight-semibold text-primary capitalize">{queue.label}</span>
                <span className="text-scale-xs text-muted">
                  {queue.mode === 'inline'
                    ? 'Inline mode'
                    : queue.mode === 'disabled'
                      ? 'Disabled'
                      : `${queue.queueName}`}
                </span>
              </div>
              <div className="flex flex-col text-right text-scale-xs text-muted">
                <span>Total jobs: {sumCounts(queue.counts)}</span>
                {queue.metrics ? (
                  <span>
                    Avg wait {formatMs(queue.metrics.waitingAvgMs)} · Avg processing {formatMs(queue.metrics.processingAvgMs)}
                  </span>
                ) : null}
              </div>
            </div>
            <QueueStateBar stats={queue} />
            <QueueStateLegend stats={queue} />
          </article>
        )) ?? (
          <div className={classNames('flex min-h-[140px] items-center justify-center rounded-2xl border border-dashed border-subtle text-scale-sm text-muted')}>
            {loading ? 'Loading queue metrics…' : 'No queue data available.'}
          </div>
        )}
      </div>
    </div>
  );
}

function sumCounts(counts: Record<string, number> | undefined) {
  if (!counts) {
    return 0;
  }
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)} m`;
  }
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}
