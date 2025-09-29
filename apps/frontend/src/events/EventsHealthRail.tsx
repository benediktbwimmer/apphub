import { useMemo, useState } from 'react';
import type {
  EventRetryBacklogEntry,
  TriggerRetryBacklogEntry,
  WorkflowEventSchedulerHealth,
  WorkflowStepRetryBacklogEntry
} from '../workflows/types';
import { Spinner } from '../components/Spinner';

function formatMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  if (value < 1_000) {
    return `${value} ms`;
  }
  const seconds = value / 1_000;
  if (seconds < 60) {
    return `${Math.round(seconds * 10) / 10}s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${Math.round(minutes * 10) / 10}m`;
  }
  const hours = minutes / 60;
  return `${Math.round(hours * 10) / 10}h`;
}

function summarizeQueueCounts(counts?: Record<string, number>): string[] {
  if (!counts) {
    return ['No queue data'];
  }
  const entries: string[] = [];
  for (const key of ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']) {
    const value = counts[key];
    if (typeof value === 'number' && value > 0) {
      entries.push(`${key}: ${value}`);
    }
  }
  if (entries.length === 0) {
    entries.push('All clear');
  }
  return entries;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

type EventsHealthRailProps = {
  health: WorkflowEventSchedulerHealth | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  onRefresh: () => void;
};

function RetrySummaryRow({
  label,
  total,
  overdue,
  nextAttemptAt
}: {
  label: string;
  total: number;
  overdue: number;
  nextAttemptAt: string | null;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-100/70 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
      <div className="flex flex-col">
        <span className="font-semibold">{label}</span>
        <span>Next attempt: {nextAttemptAt ? formatTimestamp(nextAttemptAt) : '—'}</span>
      </div>
      <div className="text-right">
        <div>Total {total}</div>
        <div className={overdue > 0 ? 'text-rose-500 dark:text-rose-300' : ''}>Overdue {overdue}</div>
      </div>
    </div>
  );
}

function RetryEntryList<T extends { overdue: boolean; nextAttemptAt: string | null; updatedAt?: string }>(
  entries: T[],
  render: (entry: T) => string
) {
  if (entries.length === 0) {
    return null;
  }
  const limited = entries.slice(0, 3);
  return (
    <ul className="flex flex-col gap-2">
      {limited.map((entry, index) => (
        <li
          key={index}
          className={`rounded-lg border border-slate-200/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-700/60 dark:text-slate-300 ${
            entry.overdue ? 'bg-rose-50/70 dark:bg-rose-500/10' : 'bg-white/70 dark:bg-slate-900/40'
          }`}
        >
          <div className="font-semibold">{render(entry)}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            Next attempt: {formatTimestamp(entry.nextAttemptAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EventsHealthRail({ health, loading, refreshing, error, lastUpdatedAt, onRefresh }: EventsHealthRailProps) {
  const [collapsed, setCollapsed] = useState(false);

  const sortedSources = useMemo(() => {
    if (!health) {
      return [];
    }
    return Object.entries(health.sources)
      .map(([source, metrics]) => ({ source, metrics }))
      .sort((a, b) => (b.metrics.averageLagMs ?? 0) - (a.metrics.averageLagMs ?? 0));
  }, [health]);

  const eventRetries = health?.retries.events ?? null;
  const triggerRetries = health?.retries.triggers ?? null;
  const workflowStepRetries = health?.retries.workflowSteps ?? null;

  const renderEventRetry = (entry: EventRetryBacklogEntry) => `${entry.source} · attempts ${entry.attempts}`;
  const renderTriggerRetry = (entry: TriggerRetryBacklogEntry) =>
    `${entry.triggerName ?? entry.triggerId} · attempts ${entry.retryAttempts}`;
  const renderWorkflowRetry = (entry: WorkflowStepRetryBacklogEntry) =>
    `${entry.workflowSlug ?? entry.workflowDefinitionId} · ${entry.stepId}`;

  return (
    <aside className="w-full shrink-0 xl:w-80">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-5 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/70">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Scheduler health</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {lastUpdatedAt ? `Last updated ${formatTimestamp(lastUpdatedAt)}` : 'Awaiting snapshot…'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              type="button"
              onClick={() => {
                void onRefresh();
              }}
              className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-500/60"
              disabled={loading || refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        {collapsed ? null : (
          <div className="flex flex-col gap-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Spinner size="sm" /> Loading metrics…
              </div>
            ) : health ? (
              <>
                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Queues
                  </h3>
                  {(['Ingress queue', 'Trigger queue'] as const).map((label, index) => {
                    const queue = index === 0 ? health.queues.ingress : health.queues.triggers;
                    const countsSummary =
                      queue.mode === 'inline' ? ['Inline execution'] : summarizeQueueCounts(queue.counts);
                    return (
                      <div
                        key={label}
                        className="rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
                          <span className="text-slate-500 dark:text-slate-400">Mode {queue.mode}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {countsSummary.map((entry) => (
                            <span key={entry}>{entry}</span>
                          ))}
                        </div>
                        {queue.mode === 'queue' && queue.metrics ? (
                          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                            Avg wait {formatMs(queue.metrics.waitingAvgMs)} · Avg processing {formatMs(queue.metrics.processingAvgMs)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Sources
                  </h3>
                  {sortedSources.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No source metrics recorded yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {sortedSources.map(({ source, metrics }) => (
                        <li
                          key={source}
                          className="rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{source}</span>
                            <span className="text-slate-500 dark:text-slate-400">Avg lag {formatMs(metrics.averageLagMs)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3">
                            <span>Total {metrics.total}</span>
                            <span>Throttled {metrics.throttled}</span>
                            <span>Dropped {metrics.dropped}</span>
                            <span>Failures {metrics.failures}</span>
                            <span>Max lag {formatMs(metrics.maxLagMs)}</span>
                          </div>
                          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                            Last event {formatTimestamp(metrics.lastEventAt)} / Last lag {formatMs(metrics.lastLagMs)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Retry backlog
                  </h3>
                  {eventRetries ? (
                    <RetrySummaryRow
                      label="Ingress events"
                      total={eventRetries.summary.total}
                      overdue={eventRetries.summary.overdue}
                      nextAttemptAt={eventRetries.summary.nextAttemptAt}
                    />
                  ) : null}
                  {triggerRetries ? (
                    <RetrySummaryRow
                      label="Trigger deliveries"
                      total={triggerRetries.summary.total}
                      overdue={triggerRetries.summary.overdue}
                      nextAttemptAt={triggerRetries.summary.nextAttemptAt}
                    />
                  ) : null}
                  {workflowStepRetries ? (
                    <RetrySummaryRow
                      label="Workflow steps"
                      total={workflowStepRetries.summary.total}
                      overdue={workflowStepRetries.summary.overdue}
                      nextAttemptAt={workflowStepRetries.summary.nextAttemptAt}
                    />
                  ) : null}
                  {eventRetries && eventRetries.entries.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Event source backlog
                      </h4>
                      {RetryEntryList(eventRetries.entries, renderEventRetry)}
                    </div>
                  ) : null}
                  {triggerRetries && triggerRetries.entries.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Trigger backlog
                      </h4>
                      {RetryEntryList(triggerRetries.entries, renderTriggerRetry)}
                    </div>
                  ) : null}
                  {workflowStepRetries && workflowStepRetries.entries.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Workflow retry backlog
                      </h4>
                      {RetryEntryList(workflowStepRetries.entries, renderWorkflowRetry)}
                    </div>
                  ) : null}
                </section>

                {health.pausedSources.length > 0 || Object.keys(health.pausedTriggers).length > 0 ? (
                  <section className="flex flex-col gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Paused routing
                    </h3>
                    {health.pausedSources.length > 0 ? (
                      <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                        <strong>Sources paused:</strong>{' '}
                        {health.pausedSources
                          .map((entry) =>
                            entry.until ? `${entry.source} (until ${formatTimestamp(entry.until)})` : entry.source
                          )
                          .join(', ')}
                      </div>
                    ) : null}
                    {Object.keys(health.pausedTriggers).length > 0 ? (
                      <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                        <strong>Triggers paused:</strong>{' '}
                        {Object.entries(health.pausedTriggers)
                          .map(([triggerId, meta]) =>
                            meta.until ? `${triggerId} (until ${formatTimestamp(meta.until)})` : triggerId
                          )
                          .join(', ')}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400">No health snapshot available.</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export default EventsHealthRail;
