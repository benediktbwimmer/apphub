import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOverviewData } from './useOverviewData';
import { ROUTE_PATHS } from '../routes/paths';
import type { AppRecord, StatusFacet } from '../catalog/types';
import type { ServiceSummary } from '../services/types';
import type { JobRunListItem, WorkflowRunListItem } from '../runs/api';

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

function getAppStatusBadge(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'failed':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
    case 'processing':
    case 'pending':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300';
    default:
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200';
  }
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

function getServiceStatusBadge(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-200/80 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200';
    case 'degraded':
      return 'bg-amber-200/80 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200';
    case 'unreachable':
      return 'bg-rose-200/80 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200';
    default:
      return 'bg-slate-200/80 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200';
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

function runsTitle(run: WorkflowRunListItem | JobRunListItem): string {
  if ('workflow' in run) {
    return run.workflow.name;
  }
  if ('job' in run) {
    return run.job.name;
  }
  return 'Unknown';
}

function runStatusBadge(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'running':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300';
    case 'failed':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
    case 'pending':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200';
    default:
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200';
  }
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Overview</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Snapshot of catalog health, auxiliary services, and most recent runs.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-700 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
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
        <Card title="Recently updated apps" actionLabel="View catalog" actionHref={ROUTE_PATHS.catalog} loading={loading && recentApps.length === 0}>
          {recentApps.length === 0 ? (
            <EmptyState message="No apps available yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {recentApps.map((app) => (
                <li key={app.id} className="rounded-xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50/80 dark:border-slate-700/70 dark:bg-slate-900/60 dark:hover:border-slate-500">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{app.name}</div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${getAppStatusBadge(app.ingestStatus)}`}>
                      {app.ingestStatus}
                    </span>
                  </div>
                  {app.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{app.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                    <span>Updated {formatDateTime(app.updatedAt)}</span>
                    <Link
                      to={`${ROUTE_PATHS.catalog}?seed=${encodeURIComponent(app.id)}`}
                      className="rounded-full border border-violet-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-violet-700 transition-colors hover:bg-violet-500/10 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/60"
                    >
                      Inspect
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Service health" actionLabel="View gallery" actionHref={ROUTE_PATHS.apps} loading={loading && recentServices.length === 0}>
          {recentServices.length === 0 ? (
            <EmptyState message="No services registered." />
          ) : (
            <ul className="flex flex-col gap-3">
              {recentServices.map((service) => (
                <li key={service.id} className="rounded-xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      {service.displayName || service.slug}
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${getServiceStatusBadge(service.status)}`}>
                      {getServiceStatusLabel(service.status)}
                    </span>
                  </div>
                  {service.statusMessage && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{service.statusMessage}</p>
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
  const toneClasses = tone === 'warning'
    ? 'border-rose-300/70 bg-rose-50/70 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
    : 'border-slate-200/70 bg-white/80 text-slate-800 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-100';

  return (
    <div className={`rounded-2xl border px-4 py-5 shadow-sm ${toneClasses}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold">
        {loading ? '—' : value.toLocaleString()}
      </div>
      {description && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</div>
      )}
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
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
        <Link
          to={actionHref}
          className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
        >
          {actionLabel}
        </Link>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300/70 bg-slate-50/70 text-sm text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
      {message}
    </div>
  );
}

type RunListProps = {
  entries: Array<WorkflowRunListItem | JobRunListItem>;
  kind: 'workflow' | 'job';
};

function RunList({ entries, kind }: RunListProps) {
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => {
        const run = entry.run;
        return (
          <li key={run.id} className="rounded-xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-800 dark:text-slate-100">{runsTitle(entry)}</div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${runStatusBadge(run.status)}`}>
                {run.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {kind === 'workflow' ? 'Workflow run' : 'Job run'} · Triggered {formatDateTime(run.startedAt ?? run.createdAt)}
            </div>
            {run.errorMessage && (
              <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{run.errorMessage}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
