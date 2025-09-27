import { memo } from 'react';
import { Spinner } from '../../components';
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
  error: string | null;
  range: WorkflowTimelineRangeKey;
  statuses: WorkflowTimelineTriggerStatus[];
  onChangeRange: (range: WorkflowTimelineRangeKey) => void;
  onToggleStatus: (status: WorkflowTimelineTriggerStatus) => void;
  onResetStatuses: () => void;
  onRefresh: () => void;
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
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Run {run.id}
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
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
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Trigger delivery {delivery.id}
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {trigger ? `${trigger.name ?? trigger.id} (${trigger.eventType})` : 'Unknown trigger'}
          {event ? ` · Event ${event.type}` : ''}
          {delivery.workflowRunId ? ` · Linked run ${delivery.workflowRunId}` : ''}
        </p>
        {delivery.lastError && (
          <p className="text-xs text-rose-500 dark:text-rose-300">{delivery.lastError}</p>
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
        <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:border-amber-300/40 dark:text-amber-300">
          Scheduler
        </span>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
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
  error,
  range,
  statuses,
  onChangeRange,
  onToggleStatus,
  onResetStatuses,
  onRefresh
}: WorkflowEventTimelineProps) {
  const activeStatusSet = new Set(statuses);
  const entries = snapshot?.entries ?? [];

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Event Timeline</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Correlate workflow runs, trigger deliveries, and scheduler activity.
          </p>
          {meta && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {meta.counts.runs} runs · {meta.counts.triggerDeliveries} deliveries · {meta.counts.schedulerSignals} scheduler signals
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Range
            <select
              className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
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
            className="inline-flex items-center rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
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
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                active
                  ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:border-violet-400/60 dark:text-violet-200'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800'
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
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
        >
          Clear
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-600 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">
          <Spinner label="Loading timeline…" size="xs" />
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-300">No activity within the selected range.</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <ol className="mt-6 space-y-3">
          {entries.map((entry) => (
            <li
              key={`${entry.kind}-${entry.id}-${entry.timestamp}`}
              className="flex flex-wrap gap-4 rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm transition-colors dark:border-slate-700/60 dark:bg-slate-900/60"
            >
              <div className="w-36 shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {formatTimestamp(entry.timestamp)}
              </div>
              <div className="flex-1 min-w-[220px]">
                <EntryDetails entry={entry} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default memo(WorkflowEventTimeline);
