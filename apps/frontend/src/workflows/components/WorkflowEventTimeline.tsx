import { memo } from 'react';
import { ScrollableListContainer, Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import StatusBadge from './StatusBadge';
import {
  WORKFLOW_TIMELINE_RANGE_KEYS,
  WORKFLOW_TIMELINE_TRIGGER_STATUSES,
  type WorkflowTimelineSnapshot,
  type WorkflowTimelineMeta,
  type WorkflowTimelineEntry,
  type WorkflowTimelineRangeKey,
  type WorkflowTimelineTriggerStatus
} from '../types';
import { formatTimestamp } from '../formatters';

const RANGE_LABELS: Record<WorkflowTimelineRangeKey, string> = {
  '1h': 'Last hour',
  '3h': 'Last 3 hours',
  '6h': 'Last 6 hours',
  '12h': 'Last 12 hours',
  '24h': 'Last 24 hours',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days'
};

type WorkflowEventTimelineProps = {
  snapshot: WorkflowTimelineSnapshot | null;
  meta: WorkflowTimelineMeta | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  range: WorkflowTimelineRangeKey;
  statuses: WorkflowTimelineTriggerStatus[];
  onChangeRange: (range: WorkflowTimelineRangeKey) => void;
  onToggleStatus: (status: WorkflowTimelineTriggerStatus) => void;
  onResetStatuses: () => void;
  onRefresh: () => void;
  onLoadMore: () => Promise<void> | void;
};

function timelineStatusLabel(status: WorkflowTimelineTriggerStatus): string {
  switch (status) {
    case 'matched':
      return 'Matched';
    case 'throttled':
      return 'Throttled';
    case 'launched':
      return 'Launched';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'pending':
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function EntryDetails({ entry }: { entry: WorkflowTimelineEntry }) {
  if (entry.kind === 'run') {
    const run = entry.run;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <p className="text-scale-sm font-weight-semibold text-primary">
          Run {run.id}
        </p>
      </div>
      <p className="text-scale-xs text-secondary">
        {run.triggeredBy ? `Triggered by ${run.triggeredBy}` : 'Triggered manually'} · Started {formatTimestamp(run.startedAt)}
      </p>
    </div>
  );
  }

  if (entry.kind === 'trigger') {
    const { delivery, trigger, event } = entry;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={delivery.status} />
          <p className="text-scale-sm font-weight-semibold text-primary">
            Trigger delivery {delivery.id}
          </p>
        </div>
        <p className="text-scale-xs text-secondary">
          {trigger ? `${trigger.name ?? trigger.id} (${trigger.eventType})` : 'Unknown trigger'}
          {event ? ` · Event ${event.type}` : ''}
          {delivery.workflowRunId ? ` · Linked run ${delivery.workflowRunId}` : ''}
        </p>
        {delivery.lastError && (
          <p className="text-scale-xs font-weight-semibold text-status-danger">{delivery.lastError}</p>
        )}
      </div>
    );
  }

  const { category, trigger, source, reason, failures, until } = entry;
  let title = 'Scheduler signal';
  if (category === 'trigger_failure') {
    title = trigger ? `Trigger failure · ${trigger.name ?? trigger.id}` : 'Trigger failure';
  } else if (category === 'trigger_paused') {
    title = trigger ? `Trigger paused · ${trigger.name ?? trigger.id}` : 'Trigger paused';
  } else if (category === 'source_paused') {
    title = source ? `Source paused · ${source}` : 'Source paused';
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.3em] ${getStatusToneClasses('warning')}`}>
          Scheduler
        </span>
        <p className="text-scale-sm font-weight-semibold text-primary">{title}</p>
      </div>
      <p className="text-scale-xs text-secondary">
        {reason ?? 'Recorded by scheduler.'}
        {typeof failures === 'number' ? ` · Failures: ${failures}` : ''}
        {until ? ` · Until ${formatTimestamp(until)}` : ''}
      </p>
    </div>
  );
}

function WorkflowEventTimeline({
  snapshot,
  meta,
  loading,
  loadingMore,
  hasMore,
  error,
  range,
  statuses,
  onChangeRange,
  onToggleStatus,
  onResetStatuses,
  onRefresh,
  onLoadMore
}: WorkflowEventTimelineProps) {
  const activeStatusSet = new Set(statuses);
  const entries = snapshot?.entries ?? [];
  const entryCount = entries.length;
  const showInitialLoading = loading && entryCount === 0;

  return (
    <section className="rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-scale-lg font-weight-semibold text-primary">Event Timeline</h2>
          <p className="text-scale-xs text-secondary">
            Correlate workflow runs, trigger deliveries, and scheduler activity.
          </p>
          {meta && (
            <p className="mt-1 text-scale-xs text-muted">
              {meta.counts.runs} runs · {meta.counts.triggerDeliveries} deliveries · {meta.counts.schedulerSignals} scheduler signals
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-scale-xs font-weight-semibold text-secondary">
            Range
            <select
              className="ml-2 rounded-2xl border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs text-primary shadow-elevation-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              value={range}
              onChange={(event) => onChangeRange(event.target.value as WorkflowTimelineRangeKey)}
            >
              {WORKFLOW_TIMELINE_RANGE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {RANGE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {WORKFLOW_TIMELINE_TRIGGER_STATUSES.map((status) => {
          const active = activeStatusSet.has(status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => onToggleStatus(status)}
              className={`rounded-full border px-3 py-1 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                active
                  ? 'border-accent bg-accent-soft text-accent-strong shadow-elevation-sm'
                  : 'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-surface-glass-soft'
              }`}
            >
              {timelineStatusLabel(status)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onResetStatuses}
          disabled={activeStatusSet.size === 0}
          className="rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-surface-glass-soft disabled:cursor-not-allowed disabled:text-muted"
        >
          Clear
        </button>
      </div>

      {error && (
        <div className={`mt-4 rounded-2xl border px-4 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses('danger')}`}>
          {error}
        </div>
      )}

      {showInitialLoading && (
        <div className="mt-6 text-scale-sm text-secondary">
          <Spinner label="Loading timeline…" size="xs" />
        </div>
      )}

      {!showInitialLoading && !error && entryCount === 0 && (
        <p className="mt-6 text-scale-sm text-secondary">No activity within the selected range.</p>
      )}

      {!error && entryCount > 0 && (
        <ScrollableListContainer
          className="mt-6 -mr-1 pr-1"
          height={360}
          hasMore={hasMore}
          isLoading={loadingMore}
          onLoadMore={onLoadMore}
          itemCount={entryCount}
          loaderLabel="Loading more timeline entries…"
        >
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li
                key={`${entry.kind}-${entry.id}-${entry.timestamp}`}
                className="flex flex-wrap gap-4 rounded-2xl border border-subtle bg-surface-glass p-4 text-scale-xs text-secondary shadow-elevation-sm transition-colors"
              >
                <div className="w-36 shrink-0 text-scale-xs font-weight-semibold text-muted">
                  {formatTimestamp(entry.timestamp)}
                </div>
                <div className="min-w-[220px] flex-1">
                  <EntryDetails entry={entry} />
                </div>
              </li>
            ))}
          </ol>
        </ScrollableListContainer>
      )}
    </section>
  );
}

export default memo(WorkflowEventTimeline);
