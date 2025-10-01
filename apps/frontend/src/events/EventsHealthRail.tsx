import { useMemo, useState } from 'react';
import type {
  EventRetryBacklogEntry,
  TriggerRetryBacklogEntry,
  WorkflowEventSchedulerHealth,
  WorkflowStepRetryBacklogEntry
} from '../workflows/types';
import { Spinner } from '../components/Spinner';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PANEL_CONTAINER = 'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-5 shadow-elevation-lg backdrop-blur-md';
const PANEL_TITLE = 'text-scale-sm font-weight-semibold text-primary';
const PANEL_SUBTITLE = 'text-scale-xs text-muted';
const SECONDARY_BUTTON = `rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:bg-surface-glass-soft ${FOCUS_RING}`;
const PRIMARY_BUTTON = `rounded-full bg-accent px-3 py-1 text-scale-xs font-weight-semibold text-on-accent shadow-elevation-sm transition-colors hover:bg-accent-strong ${FOCUS_RING}`;
const STATUS_DANGER_TEXT = 'text-status-danger';
const SECTION_HEADING = 'text-scale-xs font-weight-semibold uppercase tracking-wide text-muted';
const CARD_SURFACE = 'rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary';
const LIST_ITEM_BASE = 'rounded-lg border border-subtle px-3 py-2 text-scale-xs text-secondary';
const TAG_MUTED = 'text-[10px] text-muted';

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
    <div className="flex items-center justify-between rounded-lg bg-surface-glass-soft px-3 py-2 text-scale-xs text-secondary">
      <div className="flex flex-col">
        <span className="font-weight-semibold text-primary">{label}</span>
        <span>Next attempt: {nextAttemptAt ? formatTimestamp(nextAttemptAt) : '—'}</span>
      </div>
      <div className="text-right">
        <div>Total {total}</div>
        <div className={overdue > 0 ? STATUS_DANGER_TEXT : ''}>Overdue {overdue}</div>
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
          className={`${LIST_ITEM_BASE} ${
            entry.overdue
              ? 'border-status-danger bg-status-danger-soft text-status-danger'
              : 'bg-surface-glass-soft'
          }`}
        >
          <div className="font-weight-semibold text-primary">{render(entry)}</div>
          <div className={`${TAG_MUTED}`}>
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
      <div className={PANEL_CONTAINER}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className={PANEL_TITLE}>Scheduler health</h2>
            <span className={PANEL_SUBTITLE}>
              {lastUpdatedAt ? `Last updated ${formatTimestamp(lastUpdatedAt)}` : 'Awaiting snapshot…'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className={SECONDARY_BUTTON}
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              type="button"
              onClick={() => {
                void onRefresh();
              }}
              className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={loading || refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs font-weight-medium text-status-danger">
            {error}
          </div>
        ) : null}

        {collapsed ? null : (
          <div className="flex flex-col gap-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 text-scale-sm text-muted">
                <Spinner size="sm" /> Loading metrics…
              </div>
            ) : health ? (
              <>
                <section className="flex flex-col gap-3">
                  <h3 className={SECTION_HEADING}>
                    Queues
                  </h3>
                  {(['Ingress queue', 'Trigger queue'] as const).map((label, index) => {
                    const queue = index === 0 ? health.queues.ingress : health.queues.triggers;
                    const countsSummary =
                      queue.mode === 'inline' ? ['Inline execution'] : summarizeQueueCounts(queue.counts);
                    return (
                      <div
                        key={label}
                        className={CARD_SURFACE}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-weight-semibold text-primary">{label}</span>
                          <span className="text-muted">Mode {queue.mode}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-secondary">
                          {countsSummary.map((entry) => (
                            <span key={entry}>{entry}</span>
                          ))}
                        </div>
                        {queue.mode === 'queue' && queue.metrics ? (
                          <div className={TAG_MUTED}>
                            Avg wait {formatMs(queue.metrics.waitingAvgMs)} · Avg processing {formatMs(queue.metrics.processingAvgMs)}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className={SECTION_HEADING}>
                    Sources
                  </h3>
                  {sortedSources.length === 0 ? (
                    <p className="text-scale-xs text-muted">No source metrics recorded yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {sortedSources.map(({ source, metrics }) => (
                        <li
                          key={source}
                          className={CARD_SURFACE}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-weight-semibold text-primary">{source}</span>
                            <span className="text-muted">Avg lag {formatMs(metrics.averageLagMs)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-secondary">
                            <span>Total {metrics.total}</span>
                            <span>Throttled {metrics.throttled}</span>
                            <span>Dropped {metrics.dropped}</span>
                            <span>Failures {metrics.failures}</span>
                            <span>Max lag {formatMs(metrics.maxLagMs)}</span>
                          </div>
                          <div className={TAG_MUTED}>
                            Last event {formatTimestamp(metrics.lastEventAt)} / Last lag {formatMs(metrics.lastLagMs)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className={SECTION_HEADING}>
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
                      <h4 className="mb-2 text-[10px] font-weight-semibold uppercase tracking-wide text-muted">
                        Event source backlog
                      </h4>
                      {RetryEntryList(eventRetries.entries, renderEventRetry)}
                    </div>
                  ) : null}
                  {triggerRetries && triggerRetries.entries.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-[10px] font-weight-semibold uppercase tracking-wide text-muted">
                        Trigger backlog
                      </h4>
                      {RetryEntryList(triggerRetries.entries, renderTriggerRetry)}
                    </div>
                  ) : null}
                  {workflowStepRetries && workflowStepRetries.entries.length > 0 ? (
                    <div>
                      <h4 className="mb-2 text-[10px] font-weight-semibold uppercase tracking-wide text-muted">
                        Workflow retry backlog
                      </h4>
                      {RetryEntryList(workflowStepRetries.entries, renderWorkflowRetry)}
                    </div>
                  ) : null}
                </section>

                {health.pausedSources.length > 0 || Object.keys(health.pausedTriggers).length > 0 ? (
                  <section className="flex flex-col gap-3">
                    <h3 className={SECTION_HEADING}>
                      Paused routing
                    </h3>
                    {health.pausedSources.length > 0 ? (
                      <div className="rounded-lg border border-status-warning bg-status-warning-soft px-3 py-2 text-scale-xs text-status-warning">
                        <strong>Sources paused:</strong>{' '}
                        {health.pausedSources
                          .map((entry) =>
                            entry.until ? `${entry.source} (until ${formatTimestamp(entry.until)})` : entry.source
                          )
                          .join(', ')}
                      </div>
                    ) : null}
                    {Object.keys(health.pausedTriggers).length > 0 ? (
                      <div className="rounded-lg border border-status-warning bg-status-warning-soft px-3 py-2 text-scale-xs text-status-warning">
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
              <div className="text-scale-sm text-muted">No health snapshot available.</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export default EventsHealthRail;
