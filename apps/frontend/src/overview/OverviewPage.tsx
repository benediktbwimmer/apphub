import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOverviewData } from './useOverviewData';
import { ROUTE_PATHS } from '../routes/paths';
import { Spinner } from '../components';
import type { AppRecord, StatusFacet } from '../core/types';
import type { ServiceSummary } from '../services/types';
import type { JobRunListItem, WorkflowActivityRunEntry } from '../runs/api';
import { getStatusToneClasses } from '../theme/statusTokens';

const BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.25em]';

const SECONDARY_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.2em]';

const CARD_CONTAINER_CLASSES =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const ACCENT_LINK_CLASSES =
  'rounded-full border border-accent-soft px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const EMPTY_STATE_CLASSES =
  'flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-subtle bg-surface-muted text-scale-sm text-muted';

function buildStatusBadge(status: string, baseClass = BADGE_BASE): string {
  return `${baseClass} ${getStatusToneClasses(status)}`;
}

function totalAppsFromFacets(facets: StatusFacet[]): number {
  return facets.reduce((sum, facet) => sum + (facet.count ?? 0), 0);
}

function sumFacets(facets: StatusFacet[], statuses: string[]): number {
  const statusSet = new Set(statuses);
  return facets
    .filter((facet) => statusSet.has(facet.status))
    .reduce((sum, facet) => sum + (facet.count ?? 0), 0);
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

function sortRecentApps(apps: AppRecord[]): AppRecord[] {
  return [...apps].sort((a, b) => {
    const left = Date.parse(b.updatedAt ?? '');
    const right = Date.parse(a.updatedAt ?? '');
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    }
    return left - right;
  });
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


export default function OverviewPage() {
  const { data, loading, error } = useOverviewData();

  const stats = useMemo(() => {
    const totalApps = totalAppsFromFacets(data.statusFacets);
    const readyApps = sumFacets(data.statusFacets, ['ready']);
    const failedApps = sumFacets(data.statusFacets, ['failed']);
    const buildingApps = sumFacets(data.statusFacets, ['pending', 'processing']);
    const healthyServices = countServicesByStatus(data.services, 'healthy');
    const degradedServices = countServicesByStatus(data.services, 'degraded');
    const totalServices = data.services.length;
    return {
      totalApps,
      readyApps,
      failedApps,
      buildingApps,
      totalServices,
      healthyServices,
      degradedServices,
      workflowRuns: data.workflowRuns.length,
      jobRuns: data.jobRuns.length
    };
  }, [data]);

  const recentApps = useMemo(() => sortRecentApps(data.apps).slice(0, 6), [data.apps]);
  const recentServices = useMemo(() => data.services.slice(0, 6), [data.services]);

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
        <StatCard label="Total apps" value={stats.totalApps} description={`${stats.readyApps} ready · ${stats.buildingApps} building`} loading={loading} />
        <StatCard label="Problem apps" value={stats.failedApps} description="Failed ingestion or builds" tone="warning" loading={loading} />
        <StatCard label="Services" value={stats.totalServices} description={`${stats.healthyServices} healthy · ${stats.degradedServices} degraded`} loading={loading} />
        <StatCard label="Recent runs" value={stats.workflowRuns + stats.jobRuns} description={`${stats.workflowRuns} workflows · ${stats.jobRuns} jobs`} loading={loading} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Recently updated apps" actionLabel="View core" actionHref={ROUTE_PATHS.core} loading={loading && recentApps.length === 0}>
          {recentApps.length === 0 ? (
            <EmptyState message="No apps available yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {recentApps.map((app) => (
                <li
                  key={app.id}
                  className="rounded-xl border border-subtle bg-surface-glass px-4 py-3 text-scale-sm shadow-elevation-md transition-colors hover:border-accent-soft hover:bg-accent-soft"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-weight-semibold text-primary">{app.name}</div>
                    <span className={buildStatusBadge(app.ingestStatus, SECONDARY_BADGE_BASE)}>{app.ingestStatus}</span>
                  </div>
                  {app.description && (
                    <p className="mt-1 line-clamp-2 text-scale-xs text-muted">{app.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.25em] text-muted">
                    <span>Updated {formatDateTime(app.updatedAt)}</span>
                    <Link
                      to={`${ROUTE_PATHS.core}?seed=${encodeURIComponent(app.id)}`}
                      className={ACCENT_LINK_CLASSES}
                    >
                      Inspect
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
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
  value: number;
  description?: string;
  tone?: 'default' | 'warning';
  loading?: boolean;
};

function StatCard({ label, value, description, tone = 'default', loading }: StatCardProps) {
  const toneClasses =
    tone === 'warning'
      ? 'border-status-danger bg-status-danger-soft text-status-danger'
      : 'border-subtle bg-surface-glass text-primary';

  return (
    <div className={`rounded-2xl border px-4 py-5 shadow-elevation-md transition-colors ${toneClasses}`}>
      <div className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">{label}</div>
      <div className="mt-2 text-scale-2xl font-weight-bold">{loading ? '—' : value.toLocaleString()}</div>
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
