import { useMemo, type ReactNode } from 'react';
import { useOverviewData } from './useOverviewData';
import { ROUTE_PATHS } from '../routes/paths';
import { Spinner } from '../components';
import type { ServiceSummary } from '../services/types';
import type { JobRunListItem, WorkflowActivityRunEntry } from '../runs/api';
import { getStatusToneClasses } from '../theme/statusTokens';
import type { WorkflowEventSchedulerHealth } from '../workflows/types';

const BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.25em]';

const SECONDARY_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.2em]';

const CARD_CONTAINER_CLASSES =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const EMPTY_STATE_CLASSES =
  'flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-subtle bg-surface-muted text-scale-sm text-muted';

function buildStatusBadge(status: string, baseClass = BADGE_BASE): string {
  return `${baseClass} ${getStatusToneClasses(status)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function getServiceStatusLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'unreachable':
      return 'Unreachable';
    case 'unknown':
      return 'Unknown';
    default:
      return status;
  }
}

function countServicesByStatus(services: ServiceSummary[], status: string): number {
  return services.filter((service) => service.status === status).length;
}

function runsTitle(run: WorkflowActivityRunEntry | JobRunListItem): string {
  if ('workflow' in run) {
    return run.workflow.name;
  }
  if ('job' in run) {
    return run.job.name;
  }
  return 'Unknown';
}

type QueueSummary = {
  mode: 'inline' | 'queue' | 'disabled';
  total: number | null;
  description: string;
  metricsDescription: string | null;
};

type RetrySummaryItem = {
  label: string;
  total: number;
  overdue: number;
  nextAttemptAt: string | null;
};

function formatDurationMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
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
  if (hours < 24) {
    return `${Math.round(hours * 10) / 10}h`;
  }
  const days = hours / 24;
  if (days < 7) {
    return `${Math.round(days * 10) / 10}d`;
  }
  const weeks = days / 7;
  return `${Math.round(weeks * 10) / 10}w`;
}

function describeQueueCounts(counts?: Record<string, number>): string {
  if (!counts) {
    return 'No queue data';
  }
  const entries: string[] = [];
  for (const key of ['waiting', 'active', 'failed', 'delayed', 'completed']) {
    const value = counts[key];
    if (typeof value === 'number' && value > 0) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      entries.push(`${label} ${value}`);
    }
  }
  return entries.length > 0 ? entries.join(' · ') : 'All clear';
}

function summarizeQueue(
  queue: WorkflowEventSchedulerHealth['queues']['ingress'] | undefined
): QueueSummary {
  if (!queue) {
    return {
      mode: 'disabled',
      total: null,
      description: 'No queue data',
      metricsDescription: null
    } satisfies QueueSummary;
  }
  if (queue.mode === 'inline') {
    return {
      mode: 'inline',
      total: null,
      description: 'Inline execution',
      metricsDescription: null
    } satisfies QueueSummary;
  }
  const counts = queue.counts ?? {};
  const total = Object.values(counts).reduce<number>((sum, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return sum;
    }
    return sum + value;
  }, 0);
  const metrics = queue.metrics ?? null;
  const metricParts: string[] = [];
  if (metrics && metrics.waitingAvgMs != null) {
    metricParts.push(`Avg wait ${formatDurationMs(metrics.waitingAvgMs)}`);
  }
  if (metrics && metrics.processingAvgMs != null) {
    metricParts.push(`Avg processing ${formatDurationMs(metrics.processingAvgMs)}`);
  }
  return {
    mode: queue.mode,
    total,
    description: describeQueueCounts(counts),
    metricsDescription: metricParts.length > 0 ? metricParts.join(' · ') : null
  } satisfies QueueSummary;
}

function summarizeQueues(health: WorkflowEventSchedulerHealth | null) {
  return {
    ingress: summarizeQueue(health?.queues.ingress),
    triggers: summarizeQueue(health?.queues.triggers)
  } as const;
}

function summarizeRetries(health: WorkflowEventSchedulerHealth | null) {
  const items: RetrySummaryItem[] = [];
  let total = 0;
  let overdue = 0;

  if (health?.retries.events) {
    const summary = health.retries.events.summary;
    items.push({
      label: 'Ingress events',
      total: summary.total,
      overdue: summary.overdue,
      nextAttemptAt: summary.nextAttemptAt
    });
    total += summary.total;
    overdue += summary.overdue;
  }

  if (health?.retries.triggers) {
    const summary = health.retries.triggers.summary;
    items.push({
      label: 'Trigger deliveries',
      total: summary.total,
      overdue: summary.overdue,
      nextAttemptAt: summary.nextAttemptAt
    });
    total += summary.total;
    overdue += summary.overdue;
  }

  if (health?.retries.workflowSteps) {
    const summary = health.retries.workflowSteps.summary;
    items.push({
      label: 'Workflow steps',
      total: summary.total,
      overdue: summary.overdue,
      nextAttemptAt: summary.nextAttemptAt
    });
    total += summary.total;
    overdue += summary.overdue;
  }

  return { items, total, overdue } as const;
}

function collectTopSources(health: WorkflowEventSchedulerHealth | null, limit = 5) {
  if (!health) {
    return [];
  }
  return Object.entries(health.sources)
    .map(([source, metrics]) => ({ source, metrics }))
    .sort((a, b) => (b.metrics.averageLagMs ?? 0) - (a.metrics.averageLagMs ?? 0))
    .slice(0, limit);
}


export default function OverviewPage() {
  const { data, loading, error } = useOverviewData();

  const queueStats = useMemo(() => summarizeQueues(data.eventHealth), [data.eventHealth]);
  const retryStats = useMemo(() => summarizeRetries(data.eventHealth), [data.eventHealth]);
  const pausedSummary = useMemo(
    () => ({
      sources: data.eventHealth?.pausedSources.length ?? 0,
      triggers: data.eventHealth ? Object.keys(data.eventHealth.pausedTriggers).length : 0
    }),
    [data.eventHealth]
  );
  const topSources = useMemo(() => collectTopSources(data.eventHealth, 3), [data.eventHealth]);
  const serviceStats = useMemo(() => {
    const healthyServices = countServicesByStatus(data.services, 'healthy');
    const degradedServices = countServicesByStatus(data.services, 'degraded');
    const totalServices = data.services.length;
    return { totalServices, healthyServices, degradedServices };
  }, [data.services]);
  const runStats = useMemo(
    () => ({
      workflowRuns: data.workflowRuns.length,
      jobRuns: data.jobRuns.length
    }),
    [data.workflowRuns, data.jobRuns]
  );
  const recentServices = useMemo(() => data.services.slice(0, 6), [data.services]);
  const snapshotGeneratedAt = data.eventHealth?.generatedAt ?? null;

  const retrySummaryDescription = useMemo(() => {
    if (retryStats.items.length === 0) {
      return 'All clear';
    }
    return retryStats.items
      .map((item) => {
        const shortLabel =
          item.label === 'Ingress events'
            ? 'Events'
            : item.label === 'Trigger deliveries'
              ? 'Triggers'
              : 'Steps';
        return `${shortLabel} ${item.total}`;
      })
      .join(' · ');
  }, [retryStats.items]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-scale-xl font-weight-semibold text-primary">Overview</h1>
        <p className="text-scale-sm text-secondary">
          Snapshot of core health, auxiliary services, and most recent runs.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-sm text-status-warning shadow-elevation-md">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ingress queue"
          value={queueStats.ingress.total}
          description={`${queueStats.ingress.description}${queueStats.ingress.mode === 'queue' ? '' : ` · Mode ${queueStats.ingress.mode}`}`}
          loading={loading}
        />
        <StatCard
          label="Retry backlog"
          value={retryStats.total}
          description={retrySummaryDescription}
          tone={retryStats.overdue > 0 ? 'warning' : 'default'}
          loading={loading}
        />
        <StatCard
          label="Services"
          value={serviceStats.totalServices}
          description={`${serviceStats.healthyServices} healthy · ${serviceStats.degradedServices} degraded`}
          loading={loading}
        />
        <StatCard
          label="Recent runs"
          value={runStats.workflowRuns + runStats.jobRuns}
          description={`${runStats.workflowRuns} workflows · ${runStats.jobRuns} jobs`}
          loading={loading}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card
          title="Event scheduler snapshot"
          actionLabel="View events"
          actionHref={ROUTE_PATHS.events}
          loading={loading && !data.eventHealth}
        >
          {data.eventHealth ? (
            <div className="flex flex-col gap-4">
              <div className="text-scale-xs text-muted">
                {snapshotGeneratedAt ? `Snapshot generated ${formatDateTime(snapshotGeneratedAt)}` : 'Snapshot timing unavailable'}
              </div>
              <section className="flex flex-col gap-3">
                <h3 className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">Queues</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['ingress', 'triggers'] as const).map((key) => {
                    const queue = queueStats[key];
                    const title = key === 'ingress' ? 'Ingress' : 'Triggers';
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-weight-semibold text-primary">{title}</span>
                          <span className="text-muted capitalize">Mode {queue.mode}</span>
                        </div>
                        <div className="mt-1">{queue.description}</div>
                        {queue.metricsDescription ? (
                          <div className="mt-1 text-[11px] text-muted">{queue.metricsDescription}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="flex flex-col gap-3">
                <h3 className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">Retry backlog</h3>
                {retryStats.items.length === 0 ? (
                  <p className="text-scale-xs text-muted">No retries waiting for attention.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {retryStats.items.map((item) => (
                      <li
                        key={item.label}
                        className="rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-weight-semibold text-primary">{item.label}</span>
                          <span>Total {item.total}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-muted">
                          <span>Overdue {item.overdue}</span>
                          <span>Next attempt {item.nextAttemptAt ? formatDateTime(item.nextAttemptAt) : '—'}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {(pausedSummary.sources > 0 || pausedSummary.triggers > 0) && (
                <div className="rounded-xl border border-status-warning bg-status-warning-soft px-3 py-2 text-scale-xs text-status-warning">
                  <strong>Paused routing:</strong> {pausedSummary.sources} sources · {pausedSummary.triggers} triggers
                </div>
              )}
              <section className="flex flex-col gap-3">
                <h3 className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">Top sources</h3>
                {topSources.length === 0 ? (
                  <p className="text-scale-xs text-muted">No source metrics recorded yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {topSources.map(({ source, metrics }) => (
                      <li
                        key={source}
                        className="rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-weight-semibold text-primary">{source}</span>
                          <span className="text-muted">Avg lag {formatDurationMs(metrics.averageLagMs)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-muted">
                          <span>Total {metrics.total}</span>
                          <span>Throttled {metrics.throttled ?? 0}</span>
                          <span>Dropped {metrics.dropped ?? 0}</span>
                          <span>Failures {metrics.failures ?? 0}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : (
            <EmptyState message="Scheduler metrics unavailable." />
          )}
        </Card>

        <Card title="Service health" actionLabel="View gallery" actionHref={ROUTE_PATHS.services} loading={loading && recentServices.length === 0}>
          {recentServices.length === 0 ? (
            <EmptyState message="No services registered." />
          ) : (
            <ul className="flex flex-col gap-3">
              {recentServices.map((service) => (
                <li key={service.id} className="rounded-xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm shadow-elevation-md">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-weight-semibold text-primary">{service.displayName || service.slug}</div>
                    <span className={buildStatusBadge(service.status, SECONDARY_BADGE_BASE)}>
                      {getServiceStatusLabel(service.status)}
                    </span>
                  </div>
                  {service.statusMessage && (
                    <p className="mt-1 text-scale-xs text-muted">{service.statusMessage}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Latest workflow runs" actionLabel="View runs" actionHref={ROUTE_PATHS.runs} loading={loading && data.workflowRuns.length === 0}>
          {data.workflowRuns.length === 0 ? (
            <EmptyState message="No workflow runs yet." />
          ) : (
            <RunList entries={data.workflowRuns} kind="workflow" />
          )}
        </Card>
        <Card title="Latest job runs" actionLabel="View runs" actionHref={ROUTE_PATHS.runs} loading={loading && data.jobRuns.length === 0}>
          {data.jobRuns.length === 0 ? (
            <EmptyState message="No job runs yet." />
          ) : (
            <RunList entries={data.jobRuns} kind="job" />
          )}
        </Card>
      </section>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: number | null;
  description?: string;
  tone?: 'default' | 'warning';
  loading?: boolean;
};

function StatCard({ label, value, description, tone = 'default', loading }: StatCardProps) {
  const toneClasses =
    tone === 'warning'
      ? 'border-status-danger bg-status-danger-soft text-status-danger'
      : 'border-subtle bg-surface-glass text-primary';

  const displayValue = loading || value === null ? '—' : value.toLocaleString();

  return (
    <div className={`rounded-2xl border px-4 py-5 shadow-elevation-md transition-colors ${toneClasses}`}>
      <div className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">{label}</div>
      <div className="mt-2 text-scale-2xl font-weight-bold">{displayValue}</div>
      {description && <div className="mt-1 text-scale-xs text-muted">{description}</div>}
    </div>
  );
}

type CardProps = {
  title: string;
  actionLabel: string;
  actionHref: string;
  children: ReactNode;
  loading?: boolean;
};

function Card({ title, actionLabel, actionHref, children, loading }: CardProps) {
  return (
    <div className={CARD_CONTAINER_CLASSES}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-scale-md font-weight-semibold text-primary">{title}</h2>
        <Link to={actionHref} className={ACCENT_LINK_CLASSES}>
          {actionLabel}
        </Link>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center text-scale-sm text-muted">
          <Spinner label="Loading…" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className={EMPTY_STATE_CLASSES}>{message}</div>;
}

type RunListProps = {
  entries: Array<WorkflowActivityRunEntry | JobRunListItem>;
  kind: 'workflow' | 'job';
};

function RunList({ entries, kind }: RunListProps) {
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => {
        const run = entry.run;
        return (
          <li key={run.id} className="rounded-xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm shadow-elevation-md">
            <div className="flex items-center justify-between gap-3">
              <div className="font-weight-semibold text-primary">{runsTitle(entry)}</div>
              <span className={buildStatusBadge(run.status, SECONDARY_BADGE_BASE)}>{run.status}</span>
            </div>
            <div className="mt-1 text-scale-xs text-muted">
              {kind === 'workflow' ? 'Workflow run' : 'Job run'} · Triggered {formatDateTime(run.startedAt ?? run.createdAt)}
            </div>
            {run.errorMessage && (
              <p className="mt-2 text-scale-xs font-weight-medium text-status-danger">{run.errorMessage}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
